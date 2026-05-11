'use strict';

const { resolveAuth }                = require('../lib/auth');
const { parseJsonArg }               = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }                = require('../lib/fields');
const { apiRequest, buildUrl }       = require('../lib/http');
const { validatePath }               = require('../lib/validation');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const NOTES_API = '/pubapi/v1/notes';

// ── notes add ─────────────────────────────────────────────────────────────────

async function cmdNotesAdd(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'notes.add',
            rows,
            createTask: function(row) {
                const p = row.path;
                const body = buildBodyFromRow(row, ['path', 'label']);
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                if (!body.body) throw new CLIError('Bulk CSV row requires a "body" field');
                validatePath(p);
                return { label: p, payload: { path: p, body: body.body } };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, NOTES_API), body: task.payload, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: NOTES_API, body: task.payload, bodyType: 'json' });
                return applyFields(result, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);

    if (!p)         throw new CLIError('Usage: egnyte notes add <path> --json \'{"body":"..."}\' [--dry-run]');
    if (!body.body) throw new CLIError('"body" is required in --json');
    validatePath(p);

    const apiPath = NOTES_API;
    const payload = { path: p, body: body.body };

    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: payload, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body: payload, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── notes list ────────────────────────────────────────────────────────────────

async function cmdNotesList(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];

    if (!p) throw new CLIError('Usage: egnyte notes list <path>');
    validatePath(p);

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: NOTES_API, query: { file: p } });
    out(applyFields(result, args.fields));
}

// ── notes get ─────────────────────────────────────────────────────────────────

async function cmdNotesGet(args) {
    const { token, domain } = await resolveAuth(args);
    const id = args._[2];

    if (!id) throw new CLIError('Usage: egnyte notes get <note-id>');

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: NOTES_API + '/' + id });
    out(applyFields(result, args.fields));
}

// ── notes delete ──────────────────────────────────────────────────────────────

async function cmdNotesDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'notes.delete',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                return { label: String(id), id: id };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, NOTES_API + '/' + task.id) });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'DELETE', apiPath: NOTES_API + '/' + task.id });
                return { status: 'deleted', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const id = args._[2];

    if (!id) throw new CLIError('Usage: egnyte notes delete <note-id> [--dry-run]');

    const apiPath = NOTES_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out({ status: 'deleted', id });
}

module.exports = { cmdNotesAdd, cmdNotesList, cmdNotesGet, cmdNotesDelete };
