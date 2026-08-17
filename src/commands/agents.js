'use strict';

const { resolveAuth }                        = require('../lib/auth');
const { parseJsonArg }                       = require('../lib/args');
const { apiRequest, buildUrl }               = require('../lib/http');
const { applyFields }                        = require('../lib/fields');
const { pollUntilTerminal }                  = require('../lib/poll');
const { out, info, printDryRun, CLIError }   = require('../lib/output');

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 300000; // 5 min

const AGENTS_API = '/pubapi/v1/ai/agents';

// ── agents list ───────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/agents/list
// Usage: egnyte agents list [--json '{"sortBy":"name","sortOrder":"asc"}'] [--fields agentId,name,status]

async function cmdAgentsList(args) {
    const { token, domain } = await resolveAuth(args);

    const extra  = parseJsonArg(args.json);
    if (extra.sortBy && !['name', 'createdOn'].includes(extra.sortBy)) {
        throw new CLIError('sortBy must be one of: name, createdOn');
    }
    const params = Object.assign({ sortBy: 'name', sortOrder: 'asc' }, extra);
    const qs     = new URLSearchParams(params).toString();
    const apiPath = AGENTS_API + '/list' + (qs ? '?' + qs : '');

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, AGENTS_API + '/list') + (qs ? '?' + qs : ''), bodyType: 'none' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

// ── agents ask ────────────────────────────────────────────────────────────────
//
// POST /pubapi/v1/ai/agents/{agentId}/ask  →  poll status until COMPLETED/FAILED
//
// Usage: egnyte agents ask <agentId> "<question>"
//          [--json '{"instructions":"...","conversationId":"...","entryIds":[],"selectedItems":{}}']
//          [--fields responseText,citations]
//          [--no-wait]   (return requestId immediately, skip polling)

async function cmdAgentsAsk(args) {
    const { token, domain } = await resolveAuth(args);

    const agentId  = args._[2];
    const question = args._[3];

    if (!agentId || !question) throw new CLIError(
        'Usage: egnyte agents ask <agentId> "<question>" [--json \'{"conversationId":"..."}\'] [--fields responseText,citations]'
    );

    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);
    const apiPath = AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const submitted = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    const requestId = submitted.requestId;
    if (!requestId) throw new CLIError('Agent did not return a requestId');

    if (args['no-wait']) {
        out(applyFields(submitted, args.fields));
        return;
    }

    // Poll until terminal state
    info('Submitted. requestId=' + requestId + '. Polling for result...');
    const statusPath = AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask/' + encodeURIComponent(requestId) + '/status';

    const final = await pollUntilTerminal({
        fetchStatus: function() { return apiRequest({ domain, token, method: 'GET', apiPath: statusPath }); },
        isTerminal:  function(s) { return s.status === 'COMPLETED' || s.status === 'FAILED'; },
        intervalMs:  POLL_INTERVAL_MS,
        timeoutMs:   POLL_TIMEOUT_MS,
        onProgress:  function(s) { info('Status: ' + s.status + '...'); },
        timeoutMessage: 'Timed out waiting for agent response. Use `egnyte agents status ' + agentId + ' ' + requestId + '` to check manually.',
    });

    out(applyFields(final, args.fields));
}

// ── agents status ─────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/agents/{agentId}/ask/{requestId}/status
// Usage: egnyte agents status <agentId> <requestId> [--fields responseText,citations,status]

async function cmdAgentsStatus(args) {
    const { token, domain } = await resolveAuth(args);

    const agentId   = args._[2];
    const requestId = args._[3];

    if (!agentId || !requestId) throw new CLIError(
        'Usage: egnyte agents status <agentId> <requestId> [--fields responseText,citations,status]'
    );

    const apiPath = AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask/' + encodeURIComponent(requestId) + '/status';

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath), bodyType: 'none' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

module.exports = {
    cmdAgentsList,
    cmdAgentsAsk,
    cmdAgentsStatus,
};
