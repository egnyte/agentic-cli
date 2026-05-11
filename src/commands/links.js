'use strict';

const { resolveAuth }              = require('../lib/auth');
const { parseJsonArg }             = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }              = require('../lib/fields');
const { apiRequest, buildUrl }     = require('../lib/http');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

const LINKS_API = '/pubapi/v1/links';

// ── links create ──────────────────────────────────────────────────────────────

async function cmdLinksCreate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'links.create',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.path) throw new CLIError('Bulk CSV row requires a "path" field');
                if (!body.type) throw new CLIError('Bulk CSV row requires a "type" field');
                if (!body.accessibility) throw new CLIError('Bulk CSV row requires an "accessibility" field');
                return { label: body.path, body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, LINKS_API), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'POST', apiPath: LINKS_API, body: task.body, bodyType: 'json' });
                return applyFields(result, args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);

    if (!body.path)          throw new CLIError('"path" is required in --json');
    if (!body.type)          throw new CLIError('"type" is required in --json (file | folder)');
    if (!body.accessibility) throw new CLIError('"accessibility" is required in --json (anyone | domain | password | recipients)');

    const apiPath = LINKS_API;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── links list ────────────────────────────────────────────────────────────────

async function cmdLinksList(args) {
    const { token, domain } = await resolveAuth(args);
    const query  = parseJsonArg(args.json);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: LINKS_API, query });
    out(applyFields(result, args.fields));
}

// ── links get ─────────────────────────────────────────────────────────────────

async function cmdLinksGet(args) {
    const { token, domain } = await resolveAuth(args);
    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte links get <link-id> [--fields id,url,path]');

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: LINKS_API + '/' + id });
    out(applyFields(result, args.fields));
}

// ── links delete ──────────────────────────────────────────────────────────────

async function cmdLinksDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'links.delete',
            rows,
            createTask: function(row) {
                const id = row.id;
                if (!id) throw new CLIError('Bulk CSV row requires an "id" column');
                return { label: String(id), id: id };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, LINKS_API + '/' + task.id) });
            },
            executeTask: async function(task) {
                await apiRequest({ domain, token, method: 'DELETE', apiPath: LINKS_API + '/' + task.id });
                return { status: 'deleted', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const id = args._[2];
    if (!id) throw new CLIError('Usage: egnyte links delete <link-id> [--dry-run]');

    const apiPath = LINKS_API + '/' + id;
    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out({ status: 'deleted', id });
}

module.exports = { cmdLinksCreate, cmdLinksList, cmdLinksGet, cmdLinksDelete };
