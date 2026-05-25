'use strict';

const { resolveAuth }              = require('../lib/auth');
const { parseJsonArg }             = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }              = require('../lib/fields');
const { apiRequest, buildUrl }     = require('../lib/http');
const { validatePath }             = require('../lib/validation');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const PERMS_V2_API      = '/pubapi/v2/perms';
const PERMS_FOLDER_API  = '/pubapi/v1/perms/folder';
const PERMS_USER_LOOKUP = '/pubapi/v1/perms/user';

// ── perms get-user ────────────────────────────────────────────────────────────

async function cmdPermsGetUser(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];
    if (!p) throw new CLIError('Usage: egnyte perms get-user <folder-path> [--fields users]');
    validatePath(p);

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: PERMS_FOLDER_API + p });
    out(applyFields(result, args.fields));
}

// ── perms set-user ────────────────────────────────────────────────────────────

async function cmdPermsSetUser(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'perms.set-user',
            rows,
            createTask: function(row) {
                const p = row.path;
                const body = buildBodyFromRow(row, ['path', 'label']);
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                if (!body.users) throw new CLIError('Bulk CSV row requires a "users" field');
                validatePath(p);
                return { label: p, path: p, body: body };
            },
            formatDryRun: function(task) {
                const v2Body = { userPerms: task.body.users };
                return formatDryRun({ method: 'POST', url: buildUrl(domain, PERMS_V2_API + task.path), body: v2Body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const v2Body = { userPerms: task.body.users };
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: PERMS_V2_API + task.path, body: v2Body, bodyType: 'json' });
                return result || { status: 'ok', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);
    if (!p)          throw new CLIError("Usage: egnyte perms set-user <folder-path> --json '{\"users\":{\"jsmith\":\"Viewer\"}}' [--dry-run]");
    if (!body.users) throw new CLIError('"users" is required in --json e.g. {"users": {"jsmith": "Viewer"}}');
    validatePath(p);

    const apiPath = PERMS_V2_API + p;
    const v2Body  = { userPerms: body.users };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: v2Body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body: v2Body, bodyType: 'json' });
    out(result || { status: 'ok', path: p });
}

// ── perms delete-user ─────────────────────────────────────────────────────────

async function cmdPermsDeleteUser(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'perms.delete-user',
            rows,
            createTask: function(row) {
                const p = row.path;
                const body = buildBodyFromRow(row, ['path', 'label']);
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                if (!body.users) throw new CLIError('Bulk CSV row requires a "users" field');
                validatePath(p);
                return { label: p, path: p, body: body };
            },
            formatDryRun: function(task) {
                const noneMap = Object.fromEntries(task.body.users.map(u => [u, 'None']));
                const v2Body = { userPerms: noneMap };
                return formatDryRun({ method: 'POST', url: buildUrl(domain, PERMS_V2_API + task.path), body: v2Body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const noneMap = Object.fromEntries(task.body.users.map(u => [u, 'None']));
                const v2Body = { userPerms: noneMap };
                await apiRequest({ domain, token, method: 'POST', apiPath: PERMS_V2_API + task.path, body: v2Body, bodyType: 'json' });
                return { status: 'deleted', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);
    if (!p)          throw new CLIError("Usage: egnyte perms delete-user <folder-path> --json '{\"users\":[\"jsmith\"]}' [--dry-run]");
    if (!body.users) throw new CLIError('"users" array is required in --json e.g. {"users": ["jsmith"]}');
    validatePath(p);

    const apiPath = PERMS_V2_API + p;
    const noneMap = Object.fromEntries(body.users.map(u => [u, 'None']));
    const v2Body  = { userPerms: noneMap };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: v2Body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body: v2Body, bodyType: 'json' });
    out({ status: 'deleted', path: p });
}

// ── perms get-group ───────────────────────────────────────────────────────────

async function cmdPermsGetGroup(args) {
    const { token, domain } = await resolveAuth(args);
    const p = args._[2];
    if (!p) throw new CLIError('Usage: egnyte perms get-group <folder-path> [--fields groups]');
    validatePath(p);

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: PERMS_FOLDER_API + p });
    out(applyFields(result, args.fields));
}

// ── perms set-group ───────────────────────────────────────────────────────────

async function cmdPermsSetGroup(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'perms.set-group',
            rows,
            createTask: function(row) {
                const p = row.path;
                const body = buildBodyFromRow(row, ['path', 'label']);
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                if (!body.groups) throw new CLIError('Bulk CSV row requires a "groups" field');
                validatePath(p);
                return { label: p, path: p, body: body };
            },
            formatDryRun: function(task) {
                const v2Body = { groupPerms: task.body.groups };
                return formatDryRun({ method: 'POST', url: buildUrl(domain, PERMS_V2_API + task.path), body: v2Body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const v2Body = { groupPerms: task.body.groups };
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: PERMS_V2_API + task.path, body: v2Body, bodyType: 'json' });
                return result || { status: 'ok', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);
    if (!p)           throw new CLIError("Usage: egnyte perms set-group <folder-path> --json '{\"groups\":{\"Eng\":\"Editor\"}}' [--dry-run]");
    if (!body.groups) throw new CLIError('"groups" is required in --json e.g. {"groups": {"Engineering": "Editor"}}');
    validatePath(p);

    const apiPath = PERMS_V2_API + p;
    const v2Body  = { groupPerms: body.groups };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: v2Body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body: v2Body, bodyType: 'json' });
    out(result || { status: 'ok', path: p });
}

// ── perms delete-group ────────────────────────────────────────────────────────

async function cmdPermsDeleteGroup(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'perms.delete-group',
            rows,
            createTask: function(row) {
                const p = row.path;
                const body = buildBodyFromRow(row, ['path', 'label']);
                if (!p) throw new CLIError('Bulk CSV row requires a "path" column');
                if (!body.groups) throw new CLIError('Bulk CSV row requires a "groups" field');
                validatePath(p);
                return { label: p, path: p, body: body };
            },
            formatDryRun: function(task) {
                const noneMap = Object.fromEntries(task.body.groups.map(g => [g, 'None']));
                const v2Body = { groupPerms: noneMap };
                return formatDryRun({ method: 'POST', url: buildUrl(domain, PERMS_V2_API + task.path), body: v2Body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const noneMap = Object.fromEntries(task.body.groups.map(g => [g, 'None']));
                const v2Body = { groupPerms: noneMap };
                await apiRequest({ domain, token, method: 'POST', apiPath: PERMS_V2_API + task.path, body: v2Body, bodyType: 'json' });
                return { status: 'deleted', path: task.path };
            },
        });
        if (summary) out(summary);
        return;
    }

    const p    = args._[2];
    const body = parseJsonArg(args.json);
    if (!p)           throw new CLIError("Usage: egnyte perms delete-group <folder-path> --json '{\"groups\":[\"Engineering\"]}' [--dry-run]");
    if (!body.groups) throw new CLIError('"groups" array is required in --json e.g. {"groups": ["Engineering"]}');
    validatePath(p);

    const apiPath = PERMS_V2_API + p;
    const noneMap = Object.fromEntries(body.groups.map(g => [g, 'None']));
    const v2Body  = { groupPerms: noneMap };
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body: v2Body, bodyType: 'json' });
        return;
    }

    await apiRequest({ domain, token, method: 'POST', apiPath, body: v2Body, bodyType: 'json' });
    out({ status: 'deleted', path: p });
}

// ── perms get-by-user ─────────────────────────────────────────────────────────

async function cmdPermsGetByUser(args) {
    const { token, domain } = await resolveAuth(args);
    const username = args._[2];
    const query    = parseJsonArg(args.json);

    if (!username)    throw new CLIError("Usage: egnyte perms get-by-user <username> --json '{\"folder\":\"/Shared\"}'");
    if (!query.folder) throw new CLIError('"folder" is required in --json e.g. {"folder": "/Shared"}');

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: PERMS_USER_LOOKUP + '/' + username, query });
    out(applyFields(result, args.fields));
}

module.exports = {
    cmdPermsGetUser, cmdPermsSetUser, cmdPermsDeleteUser,
    cmdPermsGetGroup, cmdPermsSetGroup, cmdPermsDeleteGroup,
    cmdPermsGetByUser,
};
