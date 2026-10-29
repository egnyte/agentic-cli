'use strict';

const { resolveAuth }  = require('../lib/auth');
const { parseJsonArg, rejectIgnoredParams } = require('../lib/args');
const { applyFields }  = require('../lib/fields');
const { apiRequest }   = require('../lib/http');
const { out, CLIError } = require('../lib/output');

const SEARCH_API = '/pubapi/v1/search';

// GET /v1/search has none of these and would silently ignore them.
function rejectUnsupportedFilters(command, params) {
    rejectIgnoredParams(command, 'GET ' + SEARCH_API, params, ['custom_metadata', 'namespaces'],
        "For metadata filters use POST /pubapi/v2/search, e.g. egnyte request /pubapi/v2/search -X POST --json '{...}' --yes");
    rejectIgnoredParams(command, 'GET ' + SEARCH_API, params, ['group_by_type']);
}

/**
 * egnyte search <query> [--json '{"count":20,"folder":"/Shared"}'] [--fields name,path,size]
 *
 * Agent rule: always --fields to limit returned tokens.
 * Pagination: increment offset by count until results array is empty.
 */
async function cmdSearch(args) {
    const { token, domain, auth_source } = await resolveAuth(args);
    const query = args._[1];
    if (!query) throw new CLIError("Usage: egnyte search <query> [--json '{\"count\":20}'] [--fields name,path]");

    const params = parseJsonArg(args.json);
    params.query = query;
    rejectUnsupportedFilters('search', params);

    const result = await apiRequest({
        domain,
        token,
        auth_source,
        method:  'GET',
        apiPath: SEARCH_API,
        query:   params,
    });
    out(applyFields(result, args.fields));
}

// ── search advanced ───────────────────────────────────────────────────────────
//
// Advanced search with date ranges, folder scoping, and field targeting.
//
// Usage: egnyte search advanced "<query>" [--json '{"folder":"/Shared","modified_after":"2024-01-01"}'] [--fields name,path]

async function cmdSearchAdvanced(args) {
    const { token, domain, auth_source } = await resolveAuth(args);
    const query = args._[2];
    if (!query) throw new CLIError(
        'Usage: egnyte search advanced "<query>" [--json \'{"folder":"/Shared","modified_after":"2024-01-01"}\'] [--fields name,path]'
    );

    const params = parseJsonArg(args.json);
    params.query = query;

    rejectUnsupportedFilters('search advanced', params);

    // Egnyte search API requires full ISO 8601 datetime for date filters.
    // Normalize bare dates ("2024-01-01" → "2024-01-01T00:00:00Z").
    const DATE_FIELDS = ['modified_after', 'modified_before', 'uploaded_after', 'uploaded_before'];
    DATE_FIELDS.forEach(function(f) {
        if (params[f] && /^\d{4}-\d{2}-\d{2}$/.test(params[f])) {
            params[f] = params[f] + 'T00:00:00Z';
        }
    });

    const result = await apiRequest({
        domain,
        token,
        auth_source,
        method:  'GET',
        apiPath: SEARCH_API,
        query:   params,
    });
    out(applyFields(result, args.fields));
}

module.exports = { cmdSearch, cmdSearchAdvanced };
