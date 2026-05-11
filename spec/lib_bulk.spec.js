const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildBodyFromRow,
    getBulkFilePath,
    getParallelism,
    isBulkMode,
    loadBulkRows,
    parseCsv,
    parseScalar,
    runBulkOperation,
} = require('../src/lib/bulk');
const { CLIError } = require('../src/lib/output');

describe('bulk helpers', function() {
    describe('getBulkFilePath / isBulkMode', function() {
        it('prefers --bulk-file-path over --from-csv', function() {
            expect(getBulkFilePath({ 'bulk-file-path': 'a.csv', 'from-csv': 'b.csv' })).toBe('a.csv');
        });

        it('returns null when no bulk file is provided', function() {
            expect(getBulkFilePath({})).toBeNull();
            expect(isBulkMode({})).toBe(false);
        });

        it('detects bulk mode from --from-csv alias', function() {
            expect(isBulkMode({ 'from-csv': 'rows.csv' })).toBe(true);
        });
    });

    describe('getParallelism', function() {
        it('defaults to 2', function() {
            expect(getParallelism({})).toBe(2);
        });

        it('parses a valid positive integer', function() {
            expect(getParallelism({ parallelism: '5' })).toBe(5);
        });

        it('throws for invalid values', function() {
            expect(function() { getParallelism({ parallelism: '0' }); }).toThrowError(CLIError);
            expect(function() { getParallelism({ parallelism: 'abc' }); }).toThrowError(CLIError);
        });
    });

    describe('parseScalar', function() {
        it('coerces booleans, null, integers, floats, arrays, and objects', function() {
            expect(parseScalar('true')).toBe(true);
            expect(parseScalar('false')).toBe(false);
            expect(parseScalar('null')).toBeNull();
            expect(parseScalar('42')).toBe(42);
            expect(parseScalar('3.14')).toBe(3.14);
            expect(parseScalar('{"a":1}')).toEqual({ a: 1 });
            expect(parseScalar('[1,2]')).toEqual([1, 2]);
        });

        it('leaves plain strings untouched', function() {
            expect(parseScalar('hello')).toBe('hello');
            expect(parseScalar('')).toBe('');
        });

        it('falls back to the raw string for invalid json-like values', function() {
            expect(parseScalar('{oops')).toBe('{oops');
        });
    });

    describe('buildBodyFromRow', function() {
        it('builds request bodies from row values and json payloads', function() {
            const body = buildBodyFromRow({
                path: '/Shared/a.txt',
                json: { values: { status: 'signed' } },
                namespace: 'contract',
            }, ['path']);

            expect(body).toEqual({
                values: { status: 'signed' },
                namespace: 'contract',
            });
        });

        it('skips reserved keys and empty string values', function() {
            const body = buildBodyFromRow({
                path: '/Shared/a.txt',
                namespace: 'contract',
                optional: '',
                active: true,
            }, ['path']);

            expect(body).toEqual({
                namespace: 'contract',
                active: true,
            });
        });

        it('throws when json is not an object', function() {
            expect(function() {
                buildBodyFromRow({ json: ['bad'] }, []);
            }).toThrowError(CLIError);
        });
    });

    describe('parseCsv', function() {
        it('parses csv rows with headers', function() {
            const rows = parseCsv('path,to\n/Shared/a.txt,/Shared/b.txt\n');
            expect(rows).toEqual([
                ['path', 'to'],
                ['/Shared/a.txt', '/Shared/b.txt'],
            ]);
        });

        it('supports quoted commas, escaped quotes, and blank lines', function() {
            const rows = parseCsv('name,body\n"Report, Q1","Said ""hello"""\n\n');
            expect(rows).toEqual([
                ['name', 'body'],
                ['Report, Q1', 'Said "hello"'],
            ]);
        });

        it('throws for unterminated quotes', function() {
            expect(function() {
                parseCsv('name\n"unterminated\n');
            }).toThrowError(CLIError);
        });
    });

    describe('loadBulkRows', function() {
        let tmpFile;

        afterEach(function() {
            if (tmpFile) {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                tmpFile = null;
            }
        });

        it('loads rows from disk and coerces typed values', function() {
            tmpFile = path.join(os.tmpdir(), 'egnyte-bulk-' + Date.now() + '.csv');
            fs.writeFileSync(tmpFile, 'path,active,count,json\n/Shared/a.txt,true,2,"{""x"":1}"\n');

            const rows = loadBulkRows({ 'bulk-file-path': tmpFile });
            expect(rows).toEqual([
                {
                    rowNumber: 2,
                    values: {
                        path: '/Shared/a.txt',
                        active: true,
                        count: 2,
                        json: { x: 1 },
                    },
                },
            ]);
        });

        it('returns null when bulk mode is not active', function() {
            expect(loadBulkRows({})).toBeNull();
        });

        it('throws when the file is missing', function() {
            expect(function() {
                loadBulkRows({ 'bulk-file-path': '/tmp/does-not-exist-' + Date.now() + '.csv' });
            }).toThrowError(CLIError);
        });
    });

    describe('runBulkOperation', function() {
        let stdoutSpy;
        let stdoutChunks;
        let stderrChunks;
        let originalExitCode;

        beforeEach(function() {
            stdoutChunks = [];
            stderrChunks = [];
            originalExitCode = process.exitCode;
            process.exitCode = 0;
            stdoutSpy = spyOn(process.stdout, 'write').and.callFake(function(chunk) {
                stdoutChunks.push(String(chunk));
                return true;
            });
            spyOn(process.stderr, 'write').and.callFake(function(chunk) {
                stderrChunks.push(String(chunk));
                return true;
            });
        });

        afterEach(function() {
            process.exitCode = originalExitCode;
        });

        it('prints dry-run previews and returns undefined in dry-run mode', async function() {
            const result = await runBulkOperation({
                args: { 'dry-run': true },
                operation: 'fs.delete',
                rows: [{ rowNumber: 2, values: { path: '/Shared/a.txt' } }],
                createTask: function(values) { return { label: values.path, path: values.path }; },
                formatDryRun: function(task) { return 'curl DELETE ' + task.path; },
                executeTask: async function() { throw new Error('should not run'); },
            });

            expect(result).toBeUndefined();
            expect(stdoutSpy).toHaveBeenCalled();
            expect(stdoutChunks.join('')).toContain('# fs.delete row 2 (1/1)');
            expect(stdoutChunks.join('')).toContain('curl DELETE /Shared/a.txt');
            expect(stderrChunks.join('')).toBe('');
        });

        it('aggregates successes and failures and emits both human and json progress', async function() {
            const result = await runBulkOperation({
                args: { progress: true, 'json-progress': true, parallelism: '2' },
                operation: 'users.update',
                rows: [
                    { rowNumber: 2, values: { id: '1' } },
                    { rowNumber: 3, values: { id: '2' } },
                ],
                createTask: function(values, rowNumber) {
                    return { label: 'row-' + rowNumber, id: values.id };
                },
                formatDryRun: function() { return ''; },
                executeTask: async function(task) {
                    if (task.id === '2') throw new CLIError('boom');
                    return { ok: task.id };
                },
            });

            expect(result.status).toBe('completed_with_errors');
            expect(result.total).toBe(2);
            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(1);
            expect(result.results[0].status).toBe('succeeded');
            expect(result.results[1].status).toBe('failed');
            expect(result.results[1].error.error).toBe('boom');
            expect(process.exitCode).toBe(1);

            const stderr = stderrChunks.join('');
            expect(stderr).toContain('[bulk] starting 2 item(s) with parallelism 2');
            expect(stderr).toContain('"type":"bulk-start"');
            expect(stderr).toContain('"type":"item-failed"');
            expect(stderr).toContain('[bulk] completed 1/2 item(s) with 1 failure(s)');
        });

        it('leaves exit code at 0 when all bulk rows succeed', async function() {
            const result = await runBulkOperation({
                args: { parallelism: '2' },
                operation: 'users.update',
                rows: [
                    { rowNumber: 2, values: { id: '1' } },
                    { rowNumber: 3, values: { id: '2' } },
                ],
                createTask: function(values, rowNumber) {
                    return { label: 'row-' + rowNumber, id: values.id };
                },
                formatDryRun: function() { return ''; },
                executeTask: async function(task) {
                    return { ok: task.id };
                },
            });

            expect(result.status).toBe('completed');
            expect(result.failed).toBe(0);
            expect(process.exitCode).toBe(0);
        });

        it('throws when rows are empty', async function() {
            await expectAsync(runBulkOperation({
                args: {},
                operation: 'noop',
                rows: [],
                createTask: function() {},
                formatDryRun: function() { return ''; },
                executeTask: async function() {},
            })).toBeRejectedWithError(CLIError);
        });

        it('throws when createTask does not return an object', async function() {
            await expectAsync(runBulkOperation({
                args: {},
                operation: 'noop',
                rows: [{ rowNumber: 2, values: {} }],
                createTask: function() { return null; },
                formatDryRun: function() { return ''; },
                executeTask: async function() {},
            })).toBeRejectedWithError(CLIError);
        });

        it('respects --parallelism and never exceeds N concurrent tasks', async function() {
            var concurrent = 0;
            var maxConcurrent = 0;
            var rows = [2, 3, 4, 5, 6].map(function(n) { return { rowNumber: n, values: { path: '/p' + n } }; });

            await runBulkOperation({
                args: { yes: true, parallelism: '2' },
                operation: 'test.op',
                rows: rows,
                createTask: function(values) { return { label: values.path, path: values.path }; },
                formatDryRun: function(t) { return 'curl ' + t.path; },
                executeTask: function() {
                    concurrent++;
                    if (concurrent > maxConcurrent) maxConcurrent = concurrent;
                    return new Promise(function(resolve) {
                        setTimeout(function() { concurrent--; resolve({ status: 'ok' }); }, 10);
                    });
                },
            });

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });

        it('preserves result order regardless of completion order', async function() {
            var paths = ['/a', '/b', '/c'];
            var delays = { '/a': 30, '/b': 5, '/c': 15 };
            var rows = paths.map(function(p, i) { return { rowNumber: i + 2, values: { path: p } }; });

            var result = await runBulkOperation({
                args: { yes: true, parallelism: '3' },
                operation: 'test.op',
                rows: rows,
                createTask: function(values) { return { label: values.path, path: values.path }; },
                formatDryRun: function(t) { return 'curl ' + t.path; },
                executeTask: function(task) {
                    return new Promise(function(resolve) {
                        setTimeout(function() { resolve({ path: task.path }); }, delays[task.path]);
                    });
                },
            });

            expect(result.results[0].label).toBe('/a');
            expect(result.results[1].label).toBe('/b');
            expect(result.results[2].label).toBe('/c');
        });
    });

    describe('getParallelism edge cases', function() {
        it('throws on zero', function() {
            expect(function() { getParallelism({ parallelism: '0' }); }).toThrowError(CLIError);
        });

        it('throws on negative', function() {
            expect(function() { getParallelism({ parallelism: '-1' }); }).toThrowError(CLIError);
        });

        it('throws on non-numeric string', function() {
            expect(function() { getParallelism({ parallelism: 'abc' }); }).toThrowError(CLIError);
        });
    });

    describe('loadBulkRows edge cases', function() {
        it('throws when file is empty', function() {
            var p = path.join(os.tmpdir(), 'bulk-empty-' + Date.now() + '.csv');
            fs.writeFileSync(p, '', 'utf8');
            expect(function() { loadBulkRows({ 'bulk-file-path': p }); }).toThrowError(/empty/i);
        });

        it('returns zero rows when only header present', function() {
            var p = path.join(os.tmpdir(), 'bulk-header-' + Date.now() + '.csv');
            fs.writeFileSync(p, 'path\n', 'utf8');
            var rows = loadBulkRows({ 'bulk-file-path': p });
            expect(rows.length).toBe(0);
        });
    });
});
