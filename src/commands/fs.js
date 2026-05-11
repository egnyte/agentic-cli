'use strict';

const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const { URL }   = require('url');

const { resolveAuth }                    = require('../lib/auth');
const { parseJsonArg }                   = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { validatePath }                   = require('../lib/validation');
const { applyFields }                    = require('../lib/fields');
const { apiRequest, apiDownload,
        buildUrl, httpRequest }          = require('../lib/http');
const { buildMultipart }                 = require('../lib/multipart');
const { out, info, formatDryRun, printDryRun, CLIError,
        requireConfirmation }            = require('../lib/output');
const { CONFIG_DIR }                     = require('../lib/config');

const FS_API          = '/pubapi/v1/fs';
const FS_CONTENT_API  = '/pubapi/v1/fs-content';
const FS_CHUNKED_API  = '/pubapi/v1/fs-content-chunked';
const PROPS_API       = '/pubapi/v1/properties/namespace';
const FS_IDS_API      = '/pubapi/v1/fs/ids/file';

// ── Upload checkpoint helpers ─────────────────────────────────────────────────
//
// Checkpoint manifests are stored in ~/.config/egnyte-cli/uploads/ and let a
// failed chunked upload resume from the last committed chunk rather than
// restarting from zero.

const UPLOADS_DIR = path.join(CONFIG_DIR, 'uploads');

function manifestPath(remotePath) {
    const hash = crypto.createHash('sha256').update(remotePath).digest('hex').slice(0, 16);
    return path.join(UPLOADS_DIR, 'upload-' + hash + '.json');
}

function loadManifest(mPath) {
    try { return JSON.parse(fs.readFileSync(mPath, 'utf8')); } catch (_) { return null; }
}

function saveManifest(mPath, data) {
    try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(mPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
        info('Warning: could not save upload checkpoint (' + err.message + '). --resume will not work for this upload.');
    }
}

function deleteManifest(mPath) {
    try { fs.unlinkSync(mPath); } catch (_) {}
}

function emitTransferProgress(args, event) {
    if (args.progress) {
        if (event.type === 'start') {
            info('[transfer] started ' + event.operation + ': ' + event.label);
        } else if (event.type === 'progress') {
            info('[transfer] ' + event.operation + ' ' + event.label + ': ' + event.current + '/' + event.total + ' ' + event.unit);
        } else if (event.type === 'complete') {
            info('[transfer] completed ' + event.operation + ': ' + event.label);
        }
    }
    if (args['json-progress']) {
        process.stderr.write(JSON.stringify({
            type: 'transfer-' + event.type,
            operation: event.operation,
            label: event.label,
            current: event.current,
            total: event.total,
            unit: event.unit,
        }) + '\n');
    }
}

function buildFsActionBody(row) {
    const body = buildBodyFromRow(row, ['path', 'label']);
    if (!body.action) throw new CLIError('Bulk CSV row requires an "action" column or JSON body');
    return body;
}

// Resolve a file path to its entry_id via fs metadata.
async function resolveEntryId(domain, token, filePath) {
    const meta = await apiRequest({ domain, token, method: 'GET', apiPath: FS_API + filePath });
    const entryId = meta.entry_id || (meta.versions && meta.versions[0] && meta.versions[0].entry_id);
    if (!entryId) throw new CLIError('Could not resolve entry_id for: ' + filePath);
    return entryId;
}

// ── fs get ────────────────────────────────────────────────────────────────────

async function cmdFsGet(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];
    if (!p) throw new CLIError("Usage: egnyte fs get <path> [--json '{}'] [--fields name,path]");
    validatePath(p);

    const query  = parseJsonArg(args.json);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: FS_API + p, query });
    out(applyFields(result, args.fields));
}

// ── fs action ─────────────────────────────────────────────────────────────────

async function cmdFsAction(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.action',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                const body = buildFsActionBody(row);
                return { label: p, path: p, body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.body, bodyType: 'json' });
                return result || { status: 'ok', action: task.body.action, path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p = args._[2];
    if (!p) throw new CLIError("Usage: egnyte fs action <path> --json '{\"action\":\"...\"}'");
    validatePath(p);

    const body = parseJsonArg(args.json);
    if (!body.action) throw new CLIError('"action" is required in --json (add_folder | move | copy | rename)');

    const apiPath = FS_API + p;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(result || { status: 'ok', action: body.action, path: p });
}

// ── fs mkdir ──────────────────────────────────────────────────────────────────

async function cmdFsMkdir(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.mkdir',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                return { label: p, path: p, body: { action: 'add_folder' } };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.body, bodyType: 'json' });
                return { status: 'created', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p = args._[2];
    if (!p) throw new CLIError('Usage: egnyte fs mkdir <path> [--dry-run]');
    validatePath(p);

    const apiPath = FS_API + p;
    const body    = { action: 'add_folder' };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out({ status: 'created', path: p });
}

// ── fs rename ─────────────────────────────────────────────────────────────────
//
// Egnyte has no dedicated rename action — rename is a move to the same parent
// directory with a different name.

async function cmdFsRename(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.rename',
            rows,
            createTask: function(row) {
                const p = row.path;
                const name = row.name;
                if (!p || !name) throw new CLIError('Bulk CSV row requires "path" and "name" columns');
                validatePath(p);
                const parent = p.substring(0, p.lastIndexOf('/')) || '/';
                const destination = parent === '/' ? '/' + name : parent + '/' + name;
                return { label: p + ' -> ' + destination, path: p, destination: destination, body: { action: 'move', destination: destination } };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.body, bodyType: 'json' });
                return { status: 'renamed', from: task.path, to: task.destination };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const name = args.name;
    if (!p || !name) throw new CLIError('Usage: egnyte fs rename <path> --name <new-name> [--dry-run]');
    validatePath(p);

    // Build destination: same parent directory, new filename
    const parent      = p.substring(0, p.lastIndexOf('/')) || '/';
    const destination = parent === '/' ? '/' + name : parent + '/' + name;

    const apiPath = FS_API + p;
    const body    = { action: 'move', destination };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out({ status: 'renamed', from: p, to: destination });
}

// ── fs move ───────────────────────────────────────────────────────────────────

async function cmdFsMove(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.move',
            rows,
            createTask: function(row) {
                const p = row.path;
                const to = row.to;
                if (!p || !to) throw new CLIError('Bulk CSV row requires "path" and "to" columns');
                validatePath(p);
                validatePath(to);
                return { label: p + ' -> ' + to, path: p, to: to, body: { action: 'move', destination: to } };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.body, bodyType: 'json' });
                return { status: 'moved', from: task.path, to: task.to };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p  = args._[2];
    const to = args.to;
    if (!p || !to) throw new CLIError('Usage: egnyte fs move <path> --to <destination> [--dry-run]');
    validatePath(p);
    validatePath(to);

    const apiPath = FS_API + p;
    const body    = { action: 'move', destination: to };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out({ status: 'moved', from: p, to });
}

// ── fs copy ───────────────────────────────────────────────────────────────────

async function cmdFsCopy(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.copy',
            rows,
            createTask: function(row) {
                const p = row.path;
                const to = row.to;
                if (!p || !to) throw new CLIError('Bulk CSV row requires "path" and "to" columns');
                validatePath(p);
                validatePath(to);
                return { label: p + ' -> ' + to, path: p, to: to, body: { action: 'copy', destination: to } };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.body, bodyType: 'json' });
                return { status: 'copied', from: task.path, to: task.to };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p  = args._[2];
    const to = args.to;
    if (!p || !to) throw new CLIError('Usage: egnyte fs copy <path> --to <destination> [--dry-run]');
    validatePath(p);
    validatePath(to);

    const apiPath = FS_API + p;
    const body    = { action: 'copy', destination: to };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out({ status: 'copied', from: p, to });
}

// ── fs delete ─────────────────────────────────────────────────────────────────

async function cmdFsDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.delete',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                return { label: p, path: p };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, FS_API + task.path) });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'DELETE', apiPath: FS_API + task.path });
                return { status: 'deleted', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p = args._[2];
    if (!p) throw new CLIError('Usage: egnyte fs delete <path> [--dry-run]');
    validatePath(p);

    const apiPath = FS_API + p;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out({ status: 'deleted', path: p });
}

// ── fs upload ─────────────────────────────────────────────────────────────────

async function cmdFsUpload(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.upload',
            rows,
            createTask: function(row) {
                const p = row.path;
                const localFile = row.file;
                if (!p || !localFile) throw new CLIError('Bulk CSV row requires "path" and "file" columns');
                validatePath(p);
                if (!fs.existsSync(localFile)) throw new CLIError('File not found: ' + localFile);
                return { label: localFile + ' -> ' + p, path: p, localFile: localFile };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_CONTENT_API + task.path), bodyType: 'multipart', localFile: task.localFile });
            },
            executeTask: async function(task) {
                emitTransferProgress(args, { type: 'start', operation: 'upload', label: task.label });
                const multipart = buildMultipart(task.localFile);
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: FS_CONTENT_API + task.path, body: multipart, bodyType: 'multipart' });
                emitTransferProgress(args, { type: 'complete', operation: 'upload', label: task.label });
                return result || { status: 'uploaded', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p         = args._[2];
    const localFile = args.file;
    if (!p || !localFile) throw new CLIError('Usage: egnyte fs upload <path> --file <local-path> [--dry-run]');
    validatePath(p);
    if (!fs.existsSync(localFile)) throw new CLIError('File not found: ' + localFile);

    const apiPath = FS_CONTENT_API + p;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), bodyType: 'multipart', localFile });
        return;
    }

    emitTransferProgress(args, { type: 'start', operation: 'upload', label: localFile + ' -> ' + p });
    const multipart = buildMultipart(localFile);
    const result    = await apiRequest({ domain, token, method: 'POST', apiPath, body: multipart, bodyType: 'multipart' });
    emitTransferProgress(args, { type: 'complete', operation: 'upload', label: localFile + ' -> ' + p });
    out(result || { status: 'uploaded', path: p });
}

// ── fs download ───────────────────────────────────────────────────────────────

async function cmdFsDownload(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.download',
            rows,
            createTask: function(row) {
                const p = row.path;
                const outFile = row.out;
                const resume = row.resume === undefined ? !!args.resume : !!row.resume;
                if (!p || !outFile) throw new CLIError('Bulk CSV row requires "path" and "out" columns');
                validatePath(p);
                return { label: p + ' -> ' + outFile, path: p, outFile: outFile, resume: resume };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'GET', url: buildUrl(domain, FS_CONTENT_API + task.path) });
            },
            executeTask: async function(task) {
                emitTransferProgress(args, { type: 'start', operation: 'download', label: task.label });
                await apiDownload({
                    domain,
                    token,
                    apiPath: FS_CONTENT_API + task.path,
                    onProgress: function(progress) {
                        emitTransferProgress(args, {
                            type: 'progress',
                            operation: 'download',
                            label: task.label,
                            current: progress.transferred,
                            total: progress.total,
                            unit: 'bytes',
                        });
                    },
                }, task.outFile, task.resume);
                emitTransferProgress(args, { type: 'complete', operation: 'download', label: task.label });
                return { status: 'downloaded', path: task.path, saved_to: task.outFile };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p       = args._[2];
    const outFile = args.out;
    if (!p || !outFile) throw new CLIError('Usage: egnyte fs download <path> --out <local-path> [--resume]');
    validatePath(p);

    emitTransferProgress(args, { type: 'start', operation: 'download', label: p + ' -> ' + outFile });
    await apiDownload({
        domain,
        token,
        apiPath: FS_CONTENT_API + p,
        onProgress: function(progress) {
            emitTransferProgress(args, {
                type: 'progress',
                operation: 'download',
                label: p + ' -> ' + outFile,
                current: progress.transferred,
                total: progress.total,
                unit: 'bytes',
            });
        },
    }, outFile, args.resume);
    emitTransferProgress(args, { type: 'complete', operation: 'download', label: p + ' -> ' + outFile });
    out({ status: 'downloaded', path: p, saved_to: outFile });
}

// ── fs download-by-id ─────────────────────────────────────────────────────────

async function cmdFsDownloadById(args) {
    const { token, domain } = await resolveAuth(args);
    const id      = args._[2];
    const outFile = args.out;
    if (!id || !outFile) throw new CLIError('Usage: egnyte fs download-by-id <id> --out <local-path> [--resume]');

    emitTransferProgress(args, { type: 'start', operation: 'download-by-id', label: id + ' -> ' + outFile });
    await apiDownload({
        domain,
        token,
        apiPath: FS_CONTENT_API + '/ids/file/' + id,
        onProgress: function(progress) {
            emitTransferProgress(args, {
                type: 'progress',
                operation: 'download-by-id',
                label: id + ' -> ' + outFile,
                current: progress.transferred,
                total: progress.total,
                unit: 'bytes',
            });
        },
    }, outFile, args.resume);
    emitTransferProgress(args, { type: 'complete', operation: 'download-by-id', label: id + ' -> ' + outFile });
    out({ status: 'downloaded', id, saved_to: outFile });
}

// ── fs upload-chunked ─────────────────────────────────────────────────────────
//
// Implements the Egnyte chunked upload protocol for large files:
//   1. POST chunk 1  → no upload-id header  → response gives x-egnyte-upload-id
//   2. POST chunk 2+ → x-egnyte-upload-id + x-egnyte-chunk-num
//   3. POST last     → same + x-egnyte-last-chunk: true
//
// Files that fit in a single chunk fall back to the regular fs-content endpoint
// (the chunked API is only needed when more than one chunk is required).

const CHUNKED_DEFAULT_SIZE = 10 * 1024 * 1024; // 10 MB

// Core chunked upload — shared by single-command path and bulk executeTask.
// Returns the final result object { status, path, size, chunks }.
async function _doChunkedUpload(domain, token, p, localFile, chunkSize, resume, args) {
    const chunkedApiPath = FS_CHUNKED_API + p;
    const totalSize = fs.statSync(localFile).size;
    if (totalSize === 0) throw new CLIError('File is empty: ' + localFile);

    emitTransferProgress(args, { type: 'start', operation: 'upload-chunked', label: localFile + ' -> ' + p });

    const totalChunks = Math.ceil(totalSize / chunkSize);

    if (totalChunks === 1) {
        const multipart = buildMultipart(localFile);
        const result = await apiRequest({ domain, token, method: 'POST', apiPath: FS_CONTENT_API + p, body: multipart, bodyType: 'multipart' });
        emitTransferProgress(args, { type: 'complete', operation: 'upload-chunked', label: localFile + ' -> ' + p });
        return Object.assign({ status: 'uploaded', path: p, size: totalSize, chunks: 1 }, result || {});
    }

    const mPath = manifestPath(p);
    let uploadId = null;
    let startIndex = 0;

    if (resume) {
        const manifest = loadManifest(mPath);
        if (manifest && manifest.upload_id && manifest.local_file_size === totalSize &&
            manifest.chunk_size === chunkSize && manifest.total_chunks === totalChunks) {
            uploadId = manifest.upload_id;
            startIndex = manifest.next_chunk_index;
        } else if (manifest) {
            deleteManifest(mPath);
        }
    }

    const parsed = new URL(buildUrl(domain, chunkedApiPath));
    const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;
    const fd = fs.openSync(localFile, 'r');

    try {
        for (let i = startIndex; i < totalChunks; i++) {
            const offset = i * chunkSize;
            const size   = Math.min(chunkSize, totalSize - offset);
            const chunk  = Buffer.allocUnsafe(size);
            fs.readSync(fd, chunk, 0, size, offset);

            const isFirst = (i === 0);
            const isLast  = (i === totalChunks - 1);
            const headers = { Authorization: 'Bearer ' + token, 'Content-Length': chunk.length };
            if (!isFirst) { headers['x-egnyte-upload-id'] = uploadId; headers['x-egnyte-chunk-num'] = i + 1; }
            if (isLast)   { headers['x-egnyte-last-chunk'] = 'true'; }

            const resp = await httpRequest({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers }, chunk, CHUNK_TIMEOUT_MS);

            if (resp.status >= 400) {
                let msg = 'HTTP ' + resp.status + ' on chunk ' + (i + 1) + '/' + totalChunks;
                try { const b = JSON.parse(resp.body.toString()); msg = b.errorMessage || b.error || msg; } catch (_) {}
                throw new CLIError(msg);
            }

            if (isFirst) {
                uploadId = resp.headers['x-egnyte-upload-id'];
                if (!uploadId) throw new CLIError('Chunked upload failed — server did not return x-egnyte-upload-id for chunk 1');
            }

            saveManifest(mPath, { version: 1, remote_path: p, local_file: localFile, local_file_size: totalSize, chunk_size: chunkSize, total_chunks: totalChunks, upload_id: uploadId, next_chunk_index: i + 1 });
            emitTransferProgress(args, { type: 'progress', operation: 'upload-chunked', label: localFile + ' -> ' + p, current: i + 1, total: totalChunks, unit: 'chunks' });
        }
    } finally {
        fs.closeSync(fd);
    }

    deleteManifest(mPath);
    emitTransferProgress(args, { type: 'complete', operation: 'upload-chunked', label: localFile + ' -> ' + p });
    return { status: 'uploaded', path: p, size: totalSize, chunks: totalChunks };
}

async function cmdFsUploadChunked(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.upload-chunked',
            rows,
            createTask: function(row) {
                const p = row.path;
                const localFile = row.file;
                const chunkSize = parseInt(row['chunk-size'] || row.chunk_size || args['chunk-size'] || CHUNKED_DEFAULT_SIZE, 10);
                const resume = row.resume === undefined ? !!args.resume : !!row.resume;
                if (!p || !localFile) throw new CLIError('Bulk CSV row requires "path" and "file" columns');
                if (chunkSize < CHUNKED_DEFAULT_SIZE) throw new CLIError('--chunk-size must be at least 10 MB (10485760 bytes). Got: ' + chunkSize);
                validatePath(p);
                if (!fs.existsSync(localFile)) throw new CLIError('File not found: ' + localFile);
                return { label: localFile + ' -> ' + p, path: p, localFile: localFile, chunkSize: chunkSize, resume: resume };
            },
            formatDryRun: function(task) {
                const totalSize = fs.existsSync(task.localFile) ? fs.statSync(task.localFile).size : 0;
                const totalChunks = totalSize > 0 ? Math.ceil(totalSize / task.chunkSize) : 1;
                const url = buildUrl(domain, FS_CHUNKED_API + task.path);
                const lines = ['# Chunked upload: ' + task.localFile + ' (' + totalSize + ' bytes) -> ' + totalChunks + ' chunk(s) of ' + task.chunkSize + ' bytes'];
                for (let i = 0; i < totalChunks; i++) {
                    const isFirst = i === 0;
                    const isLast = i === totalChunks - 1;
                    const offset = i * task.chunkSize;
                    const size = Math.min(task.chunkSize, totalSize - offset);
                    lines.push('');
                    lines.push('# Chunk ' + (i + 1) + '/' + totalChunks);
                    lines.push('curl -X POST "' + url + '" \\');
                    lines.push('  -H "Authorization: ***" \\');
                    lines.push('  -H "Content-Length: ' + size + '" \\');
                    if (!isFirst) {
                        lines.push('  -H "x-egnyte-upload-id: <upload-id-from-chunk-1>" \\');
                        lines.push('  -H "x-egnyte-chunk-num: ' + (i + 1) + '" \\');
                    }
                    if (isLast) lines.push('  -H "x-egnyte-last-chunk: true" \\');
                    lines.push('  --data-binary @<chunk>');
                }
                return lines.join('\n');
            },
            executeTask: async function(task) {
                return _doChunkedUpload(domain, token, task.path, task.localFile, task.chunkSize, task.resume, args);
            },
        });
        if (summary) out(summary);
        return;
    }

    const p         = args._[2];
    const localFile = args.file;
    const chunkSize = parseInt(args['chunk-size']) || CHUNKED_DEFAULT_SIZE;

    if (!p || !localFile) throw new CLIError(
        'Usage: egnyte fs upload-chunked <path> --file <local-path> [--chunk-size <bytes>] [--resume] [--dry-run]'
    );
    if (chunkSize < CHUNKED_DEFAULT_SIZE) throw new CLIError(
        '--chunk-size must be at least 10 MB (10485760 bytes). Got: ' + chunkSize
    );
    validatePath(p);
    if (!fs.existsSync(localFile)) throw new CLIError('File not found: ' + localFile);

    const chunkedApiPath = FS_CHUNKED_API + p;
    requireConfirmation(args);

    if (args['dry-run']) {
        const totalSize   = fs.existsSync(localFile) ? fs.statSync(localFile).size : 0;
        const totalChunks = totalSize > 0 ? Math.ceil(totalSize / chunkSize) : 1;
        const url         = buildUrl(domain, chunkedApiPath);
        const lines = [];
        for (let i = 0; i < totalChunks; i++) {
            const isFirst  = i === 0;
            const isLast   = i === totalChunks - 1;
            const offset   = i * chunkSize;
            const size     = Math.min(chunkSize, totalSize - offset);
            lines.push(``);
            lines.push(`# Chunk ${i + 1}/${totalChunks}${isFirst ? ' — initiates upload, server returns x-egnyte-upload-id' : isLast ? ' — last chunk, finalises upload' : ''}`);
            lines.push(`curl -X POST "${url}" \\`);
            lines.push(`  -H "Authorization: ***" \\`);
            lines.push(`  -H "Content-Length: ${size}" \\`);
            if (!isFirst) {
                lines.push(`  -H "x-egnyte-upload-id: <upload-id-from-chunk-1>" \\`);
                lines.push(`  -H "x-egnyte-chunk-num: ${i + 1}" \\`);
            }
            if (isLast) lines.push(`  -H "x-egnyte-last-chunk: true" \\`);
            const byteRange = isFirst
                ? `head -c ${size} ${localFile}`
                : `tail -c +${offset + 1} ${localFile} | head -c ${size}`;
            lines.push(`  --data-binary @<(${byteRange})`);
        }
        lines.unshift(`# Chunked upload: ${localFile} (${totalSize} bytes) → ${totalChunks} chunk(s) of ${chunkSize} bytes`);

        process.stdout.write(lines.join('\n') + '\n');
        return;
    }

    const result = await _doChunkedUpload(domain, token, p, localFile, chunkSize, !!args.resume, args);
    out(result);
}

// ── fs get-content ────────────────────────────────────────────────────────────
//
// Fetch the text content of a file with pagination support.
// Distinct from `fs download` — returns the content as a JSON string (no disk write needed).
// Useful for reading docs, CSVs, or text files without downloading to disk.
//
// Usage: egnyte fs get-content <path> [--json '{"offset":0,"limit":5000}']

async function cmdFsGetContent(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];
    if (!p) throw new CLIError("Usage: egnyte fs get-content <path> [--json '{\"offset\":0,\"limit\":5000}']");
    validatePath(p);

    const query   = parseJsonArg(args.json);
    const apiPath = FS_CONTENT_API + p;

    const result = await apiRequest({ domain, token, method: 'GET', apiPath, query, raw: true });
    out(applyFields(result, args.fields));
}

// ── fs list-metadata-namespaces ───────────────────────────────────────────────
//
// Return all available custom metadata namespaces and their field definitions.
//
// Usage: egnyte fs list-metadata-namespaces [--fields namespace,fields]

async function cmdFsListMetadataNamespaces(args) {
    const { token, domain } = await resolveAuth(args);

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: PROPS_API });
    out(applyFields(result, args.fields));
}

// ── fs set-metadata ───────────────────────────────────────────────────────────
//
// Set custom metadata on a file. Requires --json with namespace and values.
//
// Usage: egnyte fs set-metadata <path> --json '{"namespace":"contract","values":{"status":"signed"}}' --dry-run
//        egnyte fs set-metadata <path> --json '{"namespace":"contract","values":{"status":"signed"}}' --yes

async function cmdFsSetMetadata(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'fs.set-metadata',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                const body = buildBodyFromRow(row, ['path', 'label']);
                const namespace = body.namespace;
                const values = body.values;
                if (!namespace) throw new CLIError('Bulk CSV row requires a "namespace" field');
                if (!values || typeof values !== 'object' || Array.isArray(values)) {
                    throw new CLIError('Bulk CSV row requires a "values" JSON object');
                }
                return { label: p + ' [' + namespace + ']', path: p, namespace: namespace, values: values };
            },
            formatDryRun: function(task) {
                return '# path: ' + task.path + ' (entry_id resolved at execution time)\n' +
                    formatDryRun({ method: 'PUT', url: buildUrl(domain, FS_IDS_API + '/<entry-id>/properties/' + task.namespace), body: task.values, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const entryId = await resolveEntryId(domain, token, task.path);
                const apiPath = FS_IDS_API + '/' + entryId + '/properties/' + task.namespace;
                const result = await apiRequest({ domain, token, method: 'PUT', apiPath: apiPath, body: task.values, bodyType: 'json' });
                return applyFields(result || { status: 'ok', path: task.path, namespace: task.namespace }, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const p = args._[2];
    if (!p) throw new CLIError(
        'Usage: egnyte fs set-metadata <path> --json \'{"namespace":"<ns>","values":{"field":"value"}}\' --dry-run'
    );
    validatePath(p);

    const body      = parseJsonArg(args.json);
    const namespace = body.namespace;
    const values    = body.values;
    if (!namespace) throw new CLIError('"namespace" is required in --json');
    if (!values)    throw new CLIError('"values" is required in --json');

    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'PUT', url: buildUrl(domain, FS_IDS_API + '/<entry-id>/properties/' + namespace), body: values, bodyType: 'json' });
        return;
    }

    const entryId = await resolveEntryId(domain, token, p);
    const apiPath = FS_IDS_API + '/' + entryId + '/properties/' + namespace;
    const result  = await apiRequest({ domain, token, method: 'PUT', apiPath, body: values, bodyType: 'json' });
    out(applyFields(result || { status: 'ok', path: p, namespace }, args.fields));
}

module.exports = {
    cmdFsGet,
    cmdFsAction,
    cmdFsDelete,
    cmdFsUpload,
    cmdFsDownload,
    cmdFsDownloadById,
    cmdFsUploadChunked,
    cmdFsMkdir,
    cmdFsRename,
    cmdFsMove,
    cmdFsCopy,
    cmdFsGetContent,
    cmdFsListMetadataNamespaces,
    cmdFsSetMetadata,
};
