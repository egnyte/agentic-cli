'use strict';

const { resolveAuth }                = require('../lib/auth');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { apiRequest, buildUrl }       = require('../lib/http');
const { applyFields }                = require('../lib/fields');
const { out, formatDryRun, printDryRun, CLIError, requireConfirmation } = require('../lib/output');

/**
 * egnyte request <api-path> [-X METHOD] [--json '{}'] [--fields a,b] [--dry-run]
 *
 * Universal escape hatch — calls any Egnyte Public API endpoint directly,
 * handling auth, retries, and JSON output the same way every other command does.
 * Use this for endpoints that don't have a dedicated command yet.
 *
 * GET / HEAD:  --json body is sent as query-string parameters.
 * POST / PUT / PATCH / DELETE: --json body is sent as a JSON request body.
 *
 * Examples:
 *   egnyte request /pubapi/v1/userinfo
 *   egnyte request /pubapi/v2/users -X GET --json '{"count":10}' --fields id,username
 *   egnyte request /pubapi/v2/groups/1234/members -X POST --json '{"id":567}'
 *   egnyte request /pubapi/v1/fs/Shared/report.pdf -X DELETE --dry-run
 */
async function cmdRequest(args) {
    const { token, domain } = await resolveAuth(args);
    const defaultMethod  = (args.X || args.method || 'GET').toUpperCase();
    const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

    if (isBulkMode(args)) {
        const rows = loadBulkRows(args);
        const hasMutatingRow = rows.some(function(row) {
            const method = String(row.values.method || defaultMethod || 'GET').toUpperCase();
            return MUTATING.includes(method);
        });
        if (hasMutatingRow) requireConfirmation(args);
        const summary = await runBulkOperation({
            args,
            operation: 'request',
            rows,
            createTask: function(row) {
                const apiPath = row.api_path || row.apiPath || row.path;
                const method = String(row.method || defaultMethod || 'GET').toUpperCase();
                if (!apiPath) throw new CLIError('Bulk CSV row requires an "api_path" column');
                if (!apiPath.startsWith('/')) throw new CLIError('Bulk API path must start with /');
                const bodyOrQuery = buildBodyFromRow(row, ['api_path', 'apiPath', 'path', 'method', 'label']);
                const isMutating = MUTATING.includes(method);
                return {
                    label: method + ' ' + apiPath,
                    apiPath: apiPath,
                    method: method,
                    isMutating: isMutating,
                    query: isMutating ? undefined : bodyOrQuery,
                    body: isMutating ? bodyOrQuery : undefined,
                    bodyType: Object.keys(bodyOrQuery).length ? 'json' : undefined,
                };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: task.method, url: buildUrl(domain, task.apiPath, task.query), body: task.body, bodyType: task.bodyType });
            },
            executeTask: async function(task) {
                return applyFields(await apiRequest({
                    domain,
                    token,
                    method: task.method,
                    apiPath: task.apiPath,
                    query: task.query,
                    body: task.body,
                    bodyType: task.bodyType,
                }), args.fields);
            },
        });
        if (summary) out(summary);
        return;
    }

    const apiPath = args._[1];
    const method  = defaultMethod;

    if (!apiPath) {
        throw new CLIError(
            'Usage: egnyte request <api-path> [-X METHOD] [--json \'{}\'] [--fields a,b] [--dry-run]\n' +
            'Examples:\n' +
            '  egnyte request /pubapi/v1/userinfo\n' +
            '  egnyte request /pubapi/v2/users -X GET --json \'{"count":10}\'\n' +
            '  egnyte request /pubapi/v2/groups/42/members -X POST --json \'{"id":7}\''
        );
    }

    if (!apiPath.startsWith('/')) {
        throw new CLIError('API path must start with /. Example: /pubapi/v1/userinfo');
    }

    const isMutating = MUTATING.includes(method);
    let rawBody;
    if (args.json) {
        try { rawBody = JSON.parse(args.json); }
        catch (e) { throw new CLIError('Invalid --json: ' + e.message); }
    }

    // GET/HEAD: body becomes query params.  POST/PUT/PATCH/DELETE: body is JSON.
    const query   = (!isMutating && rawBody) ? rawBody   : undefined;
    const body    = (isMutating  && rawBody) ? rawBody   : undefined;
    const bodyType = body ? 'json' : undefined;

    if (isMutating) requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method, url: buildUrl(domain, apiPath, query), body, bodyType });
        return;
    }

    const result = await apiRequest({ domain, token, method, apiPath, query, body, bodyType });
    out(applyFields(result, args.fields));
}

module.exports = { cmdRequest };
