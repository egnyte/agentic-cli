'use strict';

const { resolveAuth }            = require('../lib/auth');
const { parseJsonArg }           = require('../lib/args');
const { apiRequest, buildUrl }   = require('../lib/http');
const { applyFields }            = require('../lib/fields');
const { validatePath }           = require('../lib/validation');
const { ASYNC_WAIT_FLAGS }       = require('../lib/schema-registry');
const { out, info, printDryRun, requireConfirmation, serializeError, CLIError } = require('../lib/output');

const FS_API           = '/pubapi/v1/fs';
const AI_DOC_API       = '/pubapi/v1/ai/document';
const AI_ASSISTANT_API = '/pubapi/v1/ai/assistant';
const AI_KB_API        = '/pubapi/v1/ai/kb';
const HYBRID_API       = '/pubapi/v1/hybrid-search';

// Only confirmed Assistant stop states; other states keep polling.
const ASSISTANT_EXIT_CODES = {
    COMPLETED:                  0,
    FAILED:                     1,
    AWAITING_USER_CONFIRMATION: 3,
};

// What differs between the commands sharing the wait helpers below. agents.js
// passes its own; `rateWarning` is the AI API 10 calls/min note.
const ASSISTANT_WAIT = {
    cmd:         'ai',
    label:       'Assistant',
    idKey:       'executionId',
    flags:       ASYNC_WAIT_FLAGS,
    rateWarning: true,
    statusPath:  function(id) { return AI_ASSISTANT_API + '/' + encodeURIComponent(id) + '/status'; },
};

// ai ask waits by default, ai status only with --wait. Returns the polling
// budget, or null when the command performs a single request; flags that only
// make sense while waiting are rejected rather than silently ignored.
function readAssistantWaitOptions(args, command, kind = ASSISTANT_WAIT) {
    for (const flag of ['wait', 'no-wait', 'exit-status']) {
        // Value-greedy parser: `--wait 60` would swallow a token meant for --timeout.
        if (args[flag] !== undefined && args[flag] !== true) {
            throw new CLIError('--' + flag + ' takes no value');
        }
    }

    const foreign = command === 'ask' ? 'wait' : 'no-wait';
    if (args[foreign] !== undefined) throw new CLIError(
        '--' + foreign + ' only applies to ' + kind.cmd + ' ' + (command === 'ask' ? 'status' : 'ask') + '.'
    );

    const waiting = command === 'ask' ? !args['no-wait'] : !!args.wait;
    if (!waiting) {
        const flag = ['timeout', 'poll-interval', 'exit-status'].find(function(f) {
            return args[f] !== undefined;
        });
        if (flag) throw new CLIError(
            '--' + flag + ' only applies while waiting. Use ' + kind.cmd + ' status --wait, or drop --no-wait.'
        );
        return null;
    }

    // Defaults live in the schema registry so `egnyte schema ai.ask` cannot drift.
    function seconds(flag) {
        const raw = args[flag] === undefined ? String(kind.flags[flag].default) : args[flag];
        // One day is a CLI limit, not the Node.js timer overflow boundary.
        if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > 86400) {
            throw new CLIError('--' + flag + ' must be a whole number of seconds between 1 and 86400');
        }
        return Number(raw) * 1000;
    }

    // AI API rate budget is 10 calls/min — the 6 s default sits exactly at it
    // (submit + 9 polls in the first minute); 429s at the boundary are retried
    // automatically by apiRequest using the server's Retry-After.
    const wait = { timeoutMs: seconds('timeout'), intervalMs: seconds('poll-interval') };
    if (kind.rateWarning && wait.intervalMs < kind.flags['poll-interval'].default * 1000 && !args['dry-run']) {
        info('Warning: --poll-interval below 6s may exceed the AI API budget of 10 calls/min.');
    }
    return wait;
}

// Shared by ai ask and ai status. The budget limits new polls, not an in-flight
// request and its retries. agents ask/status reuse it through `kind`.
async function printAssistantStatus(auth, id, args, wait, justSubmitted, conversationId, kind = ASSISTANT_WAIT) {
    const apiPath  = kind.statusPath(id);
    const deadline = wait ? Date.now() + wait.timeoutMs : Infinity;
    // The execution has just been submitted, so the first check is worth a wait.
    let delayMs = (wait && justSubmitted) ? wait.intervalMs : 0;
    let result, exitCode;

    try {
        while (Date.now() < deadline) {
            if (delayMs) {
                await new Promise(function(resolve) {
                    setTimeout(resolve, Math.min(delayMs, deadline - Date.now()));
                });
                if (Date.now() >= deadline) break;
            }

            result = await apiRequest({ ...auth, method: 'GET', apiPath });
            if (!result || typeof result.status !== 'string' || !result.status.trim()) {
                throw new CLIError(kind.label + ' status response did not contain a non-empty "status" field');
            }
            conversationId = result.conversationId || conversationId;
            if (Object.prototype.hasOwnProperty.call(ASSISTANT_EXIT_CODES, result.status)) {
                exitCode = ASSISTANT_EXIT_CODES[result.status];
            }
            if (!wait || exitCode !== undefined) break;

            info('Status: ' + result.status + '...');
            delayMs = wait.intervalMs;
        }

        const timedOut = wait && exitCode === undefined;
        if (timedOut) result = { status: 'TIMEOUT' };

        // Identifiers first so --fields can project them; the execution stays resumable.
        const ids = { [kind.idKey]: id };
        if (conversationId) ids.conversationId = conversationId;
        out(applyFields(Object.assign(ids, result), args.fields));

        if (timedOut) {
            info(JSON.stringify({
                error: 'Timed out waiting for ' + kind.label + ' response. Check ' + kind.cmd + ' status with the same ' + kind.idKey + ' and profile; add --wait to keep waiting.',
                [kind.idKey]: id,
            }));
            process.exitCode = args['exit-status'] ? 2 : 1;
        } else if (wait && args['exit-status']) {
            process.exitCode = exitCode;
        }
    } catch (err) {
        // Keep the API diagnostics; a failed call is never relabelled as a timeout.
        info(JSON.stringify(Object.assign(serializeError(err), { [kind.idKey]: id })));
        process.exitCode = 1;
    }
}

// Resolve a file path to its entry_id via fs get metadata.
async function resolveEntryId(auth, filePath) {
    const meta = await apiRequest({
        ...auth,
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
    const { token, domain, auth_source } = await resolveAuth(args);

    const p        = args._[2];
    const question = args._[3];

    if (!p || !question) throw new CLIError(
        'Usage: egnyte ai ask-document <path> "<question>" [--json \'{"includeCitations":true}\'] [--fields response]'
    );
    validatePath(p);

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, AI_DOC_API + '/<entry-id>/ask', null, auth_source), body, bodyType: 'json' });
        return;
    }

    const entryId = await resolveEntryId({ domain, token, auth_source }, p);
    const apiPath = AI_DOC_API + '/' + entryId + '/ask';
    const result  = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai summarize ──────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/document/{entry-id}/summary
// Usage: egnyte ai summarize <path> [--fields response]

async function cmdAiSummarize(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const p = args._[2];
    if (!p) throw new CLIError(
        'Usage: egnyte ai summarize <path> [--fields response]'
    );
    validatePath(p);

    const extra = parseJsonArg(args.json);
    const body  = Object.keys(extra).length ? extra : undefined;

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, AI_DOC_API + '/<entry-id>/summary', null, auth_source), body: body || {}, bodyType: 'json' });
        return;
    }

    const entryId = await resolveEntryId({ domain, token, auth_source }, p);
    const apiPath = AI_DOC_API + '/' + entryId + '/summary';
    const result  = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body: body || {}, bodyType: 'json' });
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
//          [--no-wait]        (return executionId immediately, skip polling)
//          [--timeout <s>] [--poll-interval <s>] [--exit-status]

async function cmdAiAsk(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const question = args._[2];
    if (!question) throw new CLIError(
        'Usage: egnyte ai ask "<question>" [--json \'{...}\'] [--no-wait] --yes|--dry-run'
    );

    const wait = readAssistantWaitOptions(args, 'ask');

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
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath, null, auth_source), body, bodyType: 'json' });
        return;
    }

    const submitted = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    if (!submitted || typeof submitted.executionId !== 'string' || !submitted.executionId.trim()) {
        throw new CLIError('Assistant did not return an executionId');
    }

    // From the response or the caller's --json — either way the next turn needs it.
    const conversationId = submitted.conversationId || extra.conversationId;

    if (!wait) {
        const ids = { executionId: submitted.executionId };
        if (conversationId) ids.conversationId = conversationId;
        out(applyFields(Object.assign(ids, submitted), args.fields));
        return;
    }

    info('Submitted. executionId=' + submitted.executionId + '. Polling for result...');
    await printAssistantStatus({ domain, token, auth_source }, submitted.executionId, args, wait, true, conversationId);
}

// ── ai status ─────────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/assistant/{executionId}/status
// Usage: egnyte ai status <executionId> [--fields status,responseText,citations]
//          [--wait]   (resume polling until the execution stops)
//          [--timeout <s>] [--poll-interval <s>] [--exit-status]

async function cmdAiStatus(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const executionId = args._[2];
    if (!executionId) throw new CLIError(
        'Usage: egnyte ai status <executionId> [--wait] [--fields status,responseText,citations]'
    );

    const wait = readAssistantWaitOptions(args, 'status');

    if (args['dry-run']) {
        const apiPath = AI_ASSISTANT_API + '/' + encodeURIComponent(executionId) + '/status';
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath, null, auth_source), bodyType: 'none' });
        return;
    }

    // Without --wait this is a single query: exit 0 whenever the GET succeeds.
    await printAssistantStatus({ domain, token, auth_source }, executionId, args, wait, false);
}

// ── ai list-kbs ───────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/kb/list
// Usage: egnyte ai list-kbs [--json '{"status":["ACTIVE"],"sortBy":["name"],"sortDirection":["ASC"]}'] [--fields content]

async function cmdAiListKbs(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ sortBy: ['createdOn'], sortDirection: ['ASC'], status: ['ACTIVE'] }, extra);
    const apiPath = AI_KB_API + '/list';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath, null, auth_source), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai ask-kb ─────────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/kb/{kb-id}/ask
// Usage: egnyte ai ask-kb <kb-id> "<question>" [--json '{"includeCitations":true}'] [--fields response,citations]

async function cmdAiAskKb(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const kbId     = args._[2];
    const question = args._[3];

    if (!kbId || !question) throw new CLIError(
        'Usage: egnyte ai ask-kb <kb-id> "<question>" [--json \'{"includeCitations":true}\'] [--fields response,citations]'
    );

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);
    const apiPath = AI_KB_API + '/' + kbId + '/ask';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath, null, auth_source), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

// ── ai hybrid-search ──────────────────────────────────────────────────────────
//
// POST /pubapi/v1/hybrid-search
// Usage: egnyte ai hybrid-search "<query>" [--json '{"semanticWeight":0.5,"folderPath":"/Shared","limit":20}'] [--fields results]

async function cmdAiHybridSearch(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const query = args._[2];
    if (!query) throw new CLIError(
        'Usage: egnyte ai hybrid-search "<query>" [--json \'{"semanticWeight":0.5,"folderPath":"/Shared","limit":20}\'] [--fields results]'
    );

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ query, semanticWeight: 0.5 }, extra);
    const apiPath = HYBRID_API;

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath, null, auth_source), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    out(applyFields(result, args.fields));
}

module.exports = {
    readAssistantWaitOptions,
    printAssistantStatus,
    cmdAiAsk,
    cmdAiStatus,
    cmdAiAskDocument,
    cmdAiSummarize,
    cmdAiAskKb,
    cmdAiListKbs,
    cmdAiHybridSearch,
};
