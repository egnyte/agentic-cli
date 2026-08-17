'use strict';

const { resolveAuth }            = require('../lib/auth');
const { parseJsonArg }           = require('../lib/args');
const { apiRequest, buildUrl }   = require('../lib/http');
const { applyFields }            = require('../lib/fields');
const { validatePath }           = require('../lib/validation');
const { pollUntilTerminal }      = require('../lib/poll');
const { out, info, printDryRun, requireConfirmation, CLIError } = require('../lib/output');

const FS_API           = '/pubapi/v1/fs';
const AI_DOC_API       = '/pubapi/v1/ai/document';
const AI_ASSISTANT_API = '/pubapi/v1/ai/assistant';
const AI_KB_API        = '/pubapi/v1/ai/kb';
const HYBRID_API       = '/pubapi/v1/hybrid-search';

// AI API rate budget is 10 calls/min — 6 s polling sits exactly at it
// (submit + 9 polls in the first minute); 429s at the boundary are retried
// automatically by apiRequest using the server's Retry-After.
const ASSISTANT_POLL_INTERVAL_MS = 6000;
const ASSISTANT_POLL_TIMEOUT_MS  = 300000; // 5 min

const ASSISTANT_TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'AWAITING_USER_CONFIRMATION'];

// Resolve a file path to its entry_id via fs get metadata.
async function resolveEntryId(domain, token, filePath) {
    const meta = await apiRequest({
        domain, token,
        method: 'GET',
        apiPath: FS_API + filePath,
    });
    const entryId = meta.entry_id || (meta.versions && meta.versions[0] && meta.versions[0].entry_id);
    if (!entryId) throw new CLIError('Could not resolve entry_id for: ' + filePath);
    return entryId;
}

// ── ai ask-document ───────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/document/{entry-id}/ask
// Usage: egnyte ai ask-document <path> "<question>" [--json '{"includeCitations":true}'] [--fields response]

async function cmdAiAskDocument(args) {
    const { token, domain } = await resolveAuth(args);

    const p        = args._[2];
    const question = args._[3];

    if (!p || !question) throw new CLIError(
        'Usage: egnyte ai ask-document <path> "<question>" [--json \'{"includeCitations":true}\'] [--fields response]'
    );
    validatePath(p);

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, AI_DOC_API + '/<entry-id>/ask'), body, bodyType: 'json' });
        return;
    }

    const entryId = await resolveEntryId(domain, token, p);
    const apiPath = AI_DOC_API + '/' + entryId + '/ask';
    const result  = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai summarize ──────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/document/{entry-id}/summary
// Usage: egnyte ai summarize <path> [--fields response]

async function cmdAiSummarize(args) {
    const { token, domain } = await resolveAuth(args);

    const p = args._[2];
    if (!p) throw new CLIError(
        'Usage: egnyte ai summarize <path> [--fields response]'
    );
    validatePath(p);

    const extra = parseJsonArg(args.json);
    const body  = Object.keys(extra).length ? extra : undefined;

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, AI_DOC_API + '/<entry-id>/summary'), body: body || {}, bodyType: 'json' });
        return;
    }

    const entryId = await resolveEntryId(domain, token, p);
    const apiPath = AI_DOC_API + '/' + entryId + '/summary';
    const result  = await apiRequest({ domain, token, method: 'POST', apiPath, body: body || {}, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai ask (assistant) ────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/assistant/ask  →  poll GET /ai/assistant/{executionId}/status
//
// Assistant executions are asynchronous and can run tool-calls that create or
// modify content — hence the --yes/--dry-run gate.
//
// Usage: egnyte ai ask "<question>" --yes|--dry-run
//          [--json '{"selectedItems":{...},"includeCitations":true,"conversationId":"..."}']
//          [--fields status,responseText,citations]
//          [--no-wait]   (return executionId immediately, skip polling)

async function cmdAiAsk(args) {
    const { token, domain } = await resolveAuth(args);

    const question = args._[2];
    if (!question) throw new CLIError(
        'Usage: egnyte ai ask "<question>" [--json \'{...}\'] [--no-wait] --yes|--dry-run'
    );

    // Fresh asks default to searching the whole domain. But when the caller
    // passes conversationId (continuing a prior conversation), don't inject the
    // default — the server already knows the scope from the first turn, and
    // sending selectedItems here would override it.
    const extra = parseJsonArg(args.json);
    const body  = Object.assign({ question }, extra);
    if (!('selectedItems' in extra) && !('conversationId' in extra)) {
        body.selectedItems = { allEgnyteSearch: true };
    }

    requireConfirmation(args,
        'Assistant executions can run tool-calls that create or modify content.');

    const apiPath = AI_ASSISTANT_API + '/ask';
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const submitted = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    if (!submitted.executionId) throw new CLIError('Assistant did not return an executionId');

    if (args['no-wait']) {
        out(applyFields(submitted, args.fields));
        return;
    }

    info('Submitted. executionId=' + submitted.executionId + '. Polling for result...');
    const statusPath = AI_ASSISTANT_API + '/' + encodeURIComponent(submitted.executionId) + '/status';

    const final = await pollUntilTerminal({
        fetchStatus: function() { return apiRequest({ domain, token, method: 'GET', apiPath: statusPath }); },
        isTerminal:  function(s) { return ASSISTANT_TERMINAL_STATUSES.includes(s.status); },
        intervalMs:  ASSISTANT_POLL_INTERVAL_MS,
        timeoutMs:   ASSISTANT_POLL_TIMEOUT_MS,
        onProgress:  function(s) { info('Status: ' + s.status + '...'); },
        timeoutMessage: 'Timed out waiting for Assistant response. ' +
                        'Use `egnyte ai status ' + submitted.executionId + '` to check manually.',
    });

    out(applyFields(final, args.fields));
}

// ── ai status ─────────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/assistant/{executionId}/status
// Usage: egnyte ai status <executionId> [--fields status,responseText,citations]

async function cmdAiStatus(args) {
    const { token, domain } = await resolveAuth(args);

    const executionId = args._[2];
    if (!executionId) throw new CLIError(
        'Usage: egnyte ai status <executionId> [--fields status,responseText,citations]'
    );

    const apiPath = AI_ASSISTANT_API + '/' + encodeURIComponent(executionId) + '/status';

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath), bodyType: 'none' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

// ── ai list-kbs ───────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/kb/list
// Usage: egnyte ai list-kbs [--json '{"status":["ACTIVE"],"sortBy":["name"],"sortDirection":["ASC"]}'] [--fields content]

async function cmdAiListKbs(args) {
    const { token, domain } = await resolveAuth(args);

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ sortBy: ['createdOn'], sortDirection: ['ASC'], status: ['ACTIVE'] }, extra);
    const apiPath = AI_KB_API + '/list';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai ask-kb ─────────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/kb/{kb-id}/ask
// Usage: egnyte ai ask-kb <kb-id> "<question>" [--json '{"includeCitations":true}'] [--fields response,citations]

async function cmdAiAskKb(args) {
    const { token, domain } = await resolveAuth(args);

    const kbId     = args._[2];
    const question = args._[3];

    if (!kbId || !question) throw new CLIError(
        'Usage: egnyte ai ask-kb <kb-id> "<question>" [--json \'{"includeCitations":true}\'] [--fields response,citations]'
    );

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);
    const apiPath = AI_KB_API + '/' + kbId + '/ask';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai hybrid-search ──────────────────────────────────────────────────────────
//
// POST /pubapi/v1/hybrid-search
// Usage: egnyte ai hybrid-search "<query>" [--json '{"semanticWeight":0.5,"folderPath":"/Shared","limit":20}'] [--fields results]

async function cmdAiHybridSearch(args) {
    const { token, domain } = await resolveAuth(args);

    const query = args._[2];
    if (!query) throw new CLIError(
        'Usage: egnyte ai hybrid-search "<query>" [--json \'{"semanticWeight":0.5,"folderPath":"/Shared","limit":20}\'] [--fields results]'
    );

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ query, semanticWeight: 0.5 }, extra);
    const apiPath = HYBRID_API;

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

module.exports = {
    cmdAiAsk,
    cmdAiStatus,
    cmdAiAskDocument,
    cmdAiSummarize,
    cmdAiAskKb,
    cmdAiListKbs,
    cmdAiHybridSearch,
};
