'use strict';

const { resolveAuth }              = require('../lib/auth');
const { parseJsonArg }             = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }              = require('../lib/fields');
const { apiRequest, buildUrl }     = require('../lib/http');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const GROUPS_API = '/pubapi/v2/groups';

// ── groups get ────────────────────────────────────────────────────────────────

async function cmdGroupsGet(args) {
    const { token, domain } = await resolveAuth(args);
    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte groups get <group-id> [--fields displayName,members]');

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: GROUPS_API + '/' + id });
    out(applyFields(result, args.fields));
}

// ── groups list ───────────────────────────────────────────────────────────────

async function cmdGroupsList(args) {
    const { token, domain } = await resolveAuth(args);
    const query  = parseJsonArg(args.json);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: GROUPS_API, query });
    out(applyFields(result, args.fields));
}

// ── groups create ─────────────────────────────────────────────────────────────

async function cmdGroupsCreate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'groups.create',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.displayName) throw new CLIError('Bulk CSV row requires a "displayName" field');
                return { label: String(body.displayName), body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, GROUPS_API), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: GROUPS_API, body: task.body, bodyType: 'json' });
                return applyFields(result, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);
    if (!body.displayName) throw new CLIError('"displayName" is required in --json');

    const apiPath = GROUPS_API;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── groups update ─────────────────────────────────────────────────────────────

async function cmdGroupsUpdate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'groups.update',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                const body = buildBodyFromRow(row, ['id', 'label']);
                if (!Object.keys(body).length) throw new CLIError('Bulk CSV row requires at least one update field');
                return { label: String(id), id: id, body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'PATCH', url: buildUrl(domain, GROUPS_API + '/' + task.id), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'PATCH', apiPath: GROUPS_API + '/' + task.id, body: task.body, bodyType: 'json' });
                return applyFields(result || { status: 'updated', id: task.id }, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const id   = args._[2];
    const body = parseJsonArg(args.json);
    if (!id)                       throw new CLIError("Usage: egnyte groups update <group-id> --json '{}' [--dry-run]");
    if (!Object.keys(body).length) throw new CLIError('--json body is required with at least one field to update');

    const apiPath = GROUPS_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'PATCH', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'PATCH', apiPath, body, bodyType: 'json' });
    out(applyFields(result || { status: 'updated', id }, args.fields));
}

// ── groups delete ─────────────────────────────────────────────────────────────

async function cmdGroupsDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'groups.delete',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                return { label: String(id), id: id };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, GROUPS_API + '/' + task.id) });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'DELETE', apiPath: GROUPS_API + '/' + task.id });
                return { status: 'deleted', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte groups delete <group-id> [--dry-run]');

    const apiPath = GROUPS_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out({ status: 'deleted', id });
}

module.exports = { cmdGroupsGet, cmdGroupsList, cmdGroupsCreate, cmdGroupsUpdate, cmdGroupsDelete };
