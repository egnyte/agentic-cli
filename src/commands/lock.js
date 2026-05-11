'use strict';

const { resolveAuth }                = require('../lib/auth');
const { parseJsonArg }               = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }                = require('../lib/fields');
const { apiRequest, buildUrl }       = require('../lib/http');
const { validatePath }               = require('../lib/validation');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const FS_API = '/pubapi/v1/fs';

// ── lock lock ─────────────────────────────────────────────────────────────────

async function cmdLockLock(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'lock.lock',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                const payload = Object.assign({ action: 'lock' }, buildBodyFromRow(row, ['path', 'label']));
                return { label: p, path: p, payload: payload };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.payload, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.payload, bodyType: 'json' });
                return applyFields(result, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);

    if (!p) throw new CLIError("Usage: egnyte lock lock <path> [--json '{\"lock_token\":\"...\",\"lock_timeout\":60}'] [--dry-run]");
    validatePath(p);

    const apiPath = FS_API + p;
    const payload = Object.assign({ action: 'lock' }, body);

    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: payload, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body: payload, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── lock unlock ───────────────────────────────────────────────────────────────

async function cmdLockUnlock(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'lock.unlock',
            rows,
            createTask: function(row) {
                const p = row.path;
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                validatePath(p);
                const payload = Object.assign({ action: 'unlock' }, buildBodyFromRow(row, ['path', 'label']));
                return { label: p, path: p, payload: payload };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, FS_API + task.path), body: task.payload, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: FS_API + task.path, body: task.payload, bodyType: 'json' });
                return applyFields(result || { status: 'unlocked', path: task.path }, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);

    if (!p) throw new CLIError("Usage: egnyte lock unlock <path> [--json '{\"lock_token\":\"...\"}'] [--dry-run]");
    validatePath(p);

    const apiPath = FS_API + p;
    const payload = Object.assign({ action: 'unlock' }, body);

    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: payload, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body: payload, bodyType: 'json' });
    out(applyFields(result || { status: 'unlocked', path: p }, args.fields));
}

// ── lock get ──────────────────────────────────────────────────────────────────

async function cmdLockGet(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];

    if (!p) throw new CLIError('Usage: egnyte lock get <path> [--fields locked,lock_owner,lock_timeout]');
    validatePath(p);

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: FS_API + p });
    out(applyFields(result, args.fields));
}

module.exports = { cmdLockLock, cmdLockUnlock, cmdLockGet };
