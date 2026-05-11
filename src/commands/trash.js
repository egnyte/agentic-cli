'use strict';

const { resolveAuth }                    = require('../lib/auth');
const { parseJsonArg }                   = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }                    = require('../lib/fields');
const { apiRequest, buildUrl }           = require('../lib/http');
const { out, formatDryRun, printDryRun, CLIError,
        requireConfirmation }            = require('../lib/output');

const TRASH_V1_API = '/pubapi/v1/fs/trash';
const TRASH_V2_API = '/pubapi/v2/fs/trash';

// ── trash list ────────────────────────────────────────────────────────────────
// Note: Uses v2 for better filtering and pagination features.

async function cmdTrashList(args) {
    const { token, domain } = await resolveAuth(args);
    const query  = parseJsonArg(args.json);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: TRASH_V2_API, query });
    out(applyFields(result, args.fields));
}

// ── trash restore ─────────────────────────────────────────────────────────────
// Note: Uses v1 for RESTORE action as per public API documentation.

async function cmdTrashRestore(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'trash.restore',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.ids || !Array.isArray(body.ids)) throw new CLIError('Bulk CSV row requires an "ids" array');
                body.action = 'RESTORE';
                return { label: body.ids.join(','), body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, TRASH_V1_API), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: TRASH_V1_API, body: task.body, bodyType: 'json' });
                return result || { status: 'restored', ids: task.body.ids };
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);
    
    // Validation before resolveAuth to ensure helpful error messages
    if (!body.ids || !Array.isArray(body.ids)) {
        throw new CLIError('"ids" array is required in --json (e.g. {"ids": ["item_id_1"]})');
    }

    // Set action unconditionally as it's encoded in the CLI command
    body.action = 'RESTORE';

    const apiPath = TRASH_V1_API;
    requireConfirmation(args);

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(result || { status: 'restored', ids: body.ids });
}

// ── trash delete ──────────────────────────────────────────────────────────────
// Note: Uses v1 for PURGE action as per public API documentation.

async function cmdTrashDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'trash.delete',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.ids || !Array.isArray(body.ids)) throw new CLIError('Bulk CSV row requires an "ids" array');
                body.action = 'PURGE';
                return { label: body.ids.join(','), body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, TRASH_V1_API), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: TRASH_V1_API, body: task.body, bodyType: 'json' });
                return result || { status: 'purged', ids: task.body.ids };
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);

    // Validation before resolveAuth to ensure helpful error messages
    if (!body.ids || !Array.isArray(body.ids)) {
        throw new CLIError('"ids" array is required in --json (e.g. {"ids": ["item_id_1"]})');
    }

    // Set action unconditionally as it's encoded in the CLI command
    body.action = 'PURGE';

    const apiPath = TRASH_V1_API;
    requireConfirmation(args);

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(result || { status: 'purged', ids: body.ids });
}

module.exports = { cmdTrashList, cmdTrashRestore, cmdTrashDelete };
