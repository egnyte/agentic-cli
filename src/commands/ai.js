'use strict';

const { resolveAuth }            = require('../lib/auth');
const { parseJsonArg }           = require('../lib/args');
const { apiRequest, buildUrl }   = require('../lib/http');
const { applyFields }            = require('../lib/fields');
const { validatePath }           = require('../lib/validation');
const { out, printDryRun, CLIError } = require('../lib/output');

const FS_API         = '/pubapi/v1/fs';
const AI_DOC_API     = '/pubapi/v1/ai/document';
const AI_COPILOT_API = '/pubapi/v1/ai/copilot/ask';
const AI_KB_API      = '/pubapi/v1/ai/kb';
const HYBRID_API     = '/pubapi/v1/hybrid-search';

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

// ── ai ask (copilot) ──────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/copilot/ask
// Usage: egnyte ai ask "<question>" [--json '{"selectedItems":{"folders":[{"id":"..."}],"files":[{"entryId":"..."}]},"includeCitations":true}'] [--fields response]

async function cmdAiAsk(args) {
    const { token, domain } = await resolveAuth(args);

    const question = args._[2];
    if (!question) throw new CLIError(
        'Usage: egnyte ai ask "<question>" [--json \'{"selectedItems":{"folders":[],"files":[]},"includeCitations":true}\'] [--fields response]'
    );

    const extra = parseJsonArg(args.json);
    const body  = Object.assign({ question, selectedItems: { folders: [], files: [] } }, extra);
    const apiPath = AI_COPILOT_API;

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    if (result && result.response && typeof result.response === 'object') {
        result.response = result.response.text || JSON.stringify(result.response);
    }
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
    cmdAiAskDocument,
    cmdAiSummarize,
    cmdAiAskKb,
    cmdAiListKbs,
    cmdAiHybridSearch,
};
