'use strict';

const fs = require('fs');
const { CLIError, serializeError } = require('./output');

function getBulkFilePath(args) {
    return args['bulk-file-path'] || args['from-csv'] || null;
}

function isBulkMode(args) {
    return !!getBulkFilePath(args);
}

function getParallelism(args) {
    if (args.parallelism === undefined) return 2;
    const parsed = parseInt(args.parallelism, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new CLIError('--parallelism must be a positive integer');
    }
    return parsed;
}

function parseScalar(raw) {
    if (raw === '') return '';
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
        try { return JSON.parse(raw); } catch (_) {}
    }
    return raw;
}

function buildBodyFromRow(row, reservedKeys) {
    const reserved = new Set(reservedKeys || []);
    let body = {};

    if (row.json !== undefined && row.json !== '') {
        if (!row.json || typeof row.json !== 'object' || Array.isArray(row.json)) {
            throw new CLIError('Bulk CSV "json" column must contain a JSON object');
        }
        body = Object.assign({}, row.json);
    }

    Object.keys(row).forEach(function(key) {
        if (reserved.has(key) || key === 'json' || row[key] === '') return;
        body[key] = row[key];
    });
    return body;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (ch !== '\r') {
            field += ch;
        }
    }

    if (inQuotes) throw new CLIError('Invalid CSV: unterminated quoted field');

    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter(function(item) {
        return item.some(function(cell) { return String(cell).trim() !== ''; });
    });
}

function loadBulkRows(args) {
    const filePath = getBulkFilePath(args);
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) throw new CLIError('Bulk CSV file not found: ' + filePath);

    const parsed = parseCsv(fs.readFileSync(filePath, 'utf8'));
    if (!parsed.length) throw new CLIError('Bulk CSV file is empty: ' + filePath);

    const headers = parsed[0].map(function(header) { return String(header || '').trim(); });
    if (!headers.length || headers.every(function(header) { return !header; })) {
        throw new CLIError('Bulk CSV must include a header row');
    }

    return parsed.slice(1).map(function(values, index) {
        const row = {};
        headers.forEach(function(header, headerIndex) {
            if (!header) return;
            row[header] = parseScalar(String(values[headerIndex] || '').trim());
        });
        return {
            rowNumber: index + 2,
            values: row,
        };
    });
}

function emitProgress(args, event) {
    if (args.progress) {
        process.stderr.write(formatHumanProgress(event) + '\n');
    }
    if (args['json-progress']) {
        process.stderr.write(JSON.stringify(event) + '\n');
    }
}

function formatHumanProgress(event) {
    if (event.type === 'bulk-start') {
        return '[bulk] starting ' + event.total + ' item(s) with parallelism ' + event.parallelism;
    }
    if (event.type === 'item-start') {
        return '[bulk] row ' + event.row + ' started: ' + event.label;
    }
    if (event.type === 'item-complete') {
        return '[bulk] row ' + event.row + ' succeeded (' + event.completed + '/' + event.total + '): ' + event.label;
    }
    if (event.type === 'item-failed') {
        return '[bulk] row ' + event.row + ' failed (' + event.completed + '/' + event.total + '): ' + event.label + ' — ' + event.error;
    }
    if (event.type === 'bulk-complete') {
        return '[bulk] completed ' + event.succeeded + '/' + event.total + ' item(s)' + (event.failed ? ' with ' + event.failed + ' failure(s)' : '');
    }
    return '[bulk] ' + event.type;
}

async function runBulkOperation(opts) {
    const {
        args,
        operation,
        rows,
        createTask,
        executeTask,
        formatDryRun,
    } = opts;

    const parallelism = getParallelism(args);
    if (!rows.length) throw new CLIError('Bulk CSV does not contain any data rows');

    const tasks = rows.map(function(row) {
        const task = createTask(row.values, row.rowNumber);
        if (!task || typeof task !== 'object') {
            throw new CLIError('Bulk row ' + row.rowNumber + ' did not produce a task');
        }
        task.row = row.rowNumber;
        task.label = task.label || ('row ' + row.rowNumber);
        return task;
    });

    if (args['dry-run']) {
        const previews = tasks.map(function(task, index) {
            return '# ' + operation + ' row ' + task.row + ' (' + (index + 1) + '/' + tasks.length + ')\n' + formatDryRun(task);
        });
        process.stdout.write(previews.join('\n\n') + '\n');
        return;
    }

    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const startedAt = Date.now();
    const results = new Array(tasks.length);

    emitProgress(args, {
        type: 'bulk-start',
        operation,
        total: tasks.length,
        parallelism,
    });

    async function worker() {
        while (true) {
            const index = cursor;
            cursor++;
            if (index >= tasks.length) return;

            const task = tasks[index];
            emitProgress(args, {
                type: 'item-start',
                operation,
                row: task.row,
                label: task.label,
                index: index + 1,
                total: tasks.length,
            });

            try {
                const result = await executeTask(task);
                completed++;
                succeeded++;
                results[index] = {
                    row: task.row,
                    label: task.label,
                    status: 'succeeded',
                    result,
                };
                emitProgress(args, {
                    type: 'item-complete',
                    operation,
                    row: task.row,
                    label: task.label,
                    completed,
                    succeeded,
                    failed,
                    total: tasks.length,
                });
            } catch (err) {
                completed++;
                failed++;
                results[index] = {
                    row: task.row,
                    label: task.label,
                    status: 'failed',
                    error: serializeError(err),
                };
                emitProgress(args, {
                    type: 'item-failed',
                    operation,
                    row: task.row,
                    label: task.label,
                    completed,
                    succeeded,
                    failed,
                    total: tasks.length,
                    error: (err && err.message) ? err.message : String(err),
                });
            }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(parallelism, tasks.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    emitProgress(args, {
        type: 'bulk-complete',
        operation,
        total: tasks.length,
        succeeded,
        failed,
        elapsed_ms: Date.now() - startedAt,
    });

    const summary = {
        status: failed ? 'completed_with_errors' : 'completed',
        operation,
        total: tasks.length,
        succeeded,
        failed,
        elapsed_ms: Date.now() - startedAt,
        results,
    };

    if (summary.failed > 0) process.exitCode = 1;
    return summary;
}

module.exports = {
    buildBodyFromRow,
    getBulkFilePath,
    getParallelism,
    isBulkMode,
    loadBulkRows,
    parseCsv,
    parseScalar,
    runBulkOperation,
};
