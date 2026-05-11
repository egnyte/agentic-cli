'use strict';

const { resolveAuth }              = require('../lib/auth');
const { parseJsonArg }             = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }              = require('../lib/fields');
const { apiRequest, buildUrl }     = require('../lib/http');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const USERS_API = '/pubapi/v2/users';

// ── users get ─────────────────────────────────────────────────────────────────

async function cmdUsersGet(args) {
    const { token, domain } = await resolveAuth(args);
    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte users get <id> [--fields userName,email,active]');

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: USERS_API + '/' + id });
    out(applyFields(result, args.fields));
}

// ── users list ────────────────────────────────────────────────────────────────

async function cmdUsersList(args) {
    const { token, domain } = await resolveAuth(args);
    const query  = parseJsonArg(args.json);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: USERS_API, query });
    out(applyFields(result, args.fields));
}

// ── users create ──────────────────────────────────────────────────────────────

async function cmdUsersCreate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'users.create',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.userName) throw new CLIError('Bulk CSV row requires a "userName" field');
                if (!body.email) throw new CLIError('Bulk CSV row requires an "email" field');
                return { label: String(body.userName), body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, USERS_API), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: USERS_API, body: task.body, bodyType: 'json' });
                return applyFields(result, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);

    if (!body.userName) throw new CLIError('"userName" is required in --json');
    if (!body.email)    throw new CLIError('"email" is required in --json as a plain string e.g. "email": "user@co.com"');

    const apiPath = USERS_API;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── users update ──────────────────────────────────────────────────────────────

async function cmdUsersUpdate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'users.update',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                const body = buildBodyFromRow(row, ['id', 'label']);
                if (!Object.keys(body).length) throw new CLIError('Bulk CSV row requires at least one update field');
                return { label: String(id), id: id, body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'PATCH', url: buildUrl(domain, USERS_API + '/' + task.id), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'PATCH', apiPath: USERS_API + '/' + task.id, body: task.body, bodyType: 'json' });
                return applyFields(result || { status: 'updated', id: task.id }, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const id   = args._[2];
    const body = parseJsonArg(args.json);
    if (!id)                  throw new CLIError("Usage: egnyte users update <id> --json '{}'  [--dry-run]");
    if (!Object.keys(body).length) throw new CLIError('--json body is required with at least one field to update');

    const apiPath = USERS_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'PATCH', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'PATCH', apiPath, body, bodyType: 'json' });
    out(applyFields(result || { status: 'updated', id }, args.fields));
}

// ── users delete ──────────────────────────────────────────────────────────────

async function cmdUsersDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'users.delete',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                return { label: String(id), id: id };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, USERS_API + '/' + task.id) });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'DELETE', apiPath: USERS_API + '/' + task.id });
                return { status: 'deleted', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte users delete <id> [--dry-run]');

    const apiPath = USERS_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out({ status: 'deleted', id });
}

module.exports = { cmdUsersGet, cmdUsersList, cmdUsersCreate, cmdUsersUpdate, cmdUsersDelete };
