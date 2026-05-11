'use strict';

const { resolveAuth }                        = require('../lib/auth');
const { parseJsonArg }                       = require('../lib/args');
const { apiRequest, buildUrl }               = require('../lib/http');
const { applyFields }                        = require('../lib/fields');
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
    const apiPath = AGENTS_API + '/' + agentId + '/ask';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const submitted = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    const requestId     = submitted.requestId;
    const conversationId = submitted.conversationId;

    if (args['no-wait']) {
        out({ requestId, conversationId });
        return;
    }

    // Poll until terminal state
    info('Submitted. requestId=' + requestId + '. Polling for result...');
    const statusPath = AGENTS_API + '/' + agentId + '/ask/' + requestId + '/status';
    const deadline   = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const status = await apiRequest({ domain, token, method: 'GET', apiPath: statusPath });
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
            out(applyFields(status, args.fields));
            return;
        }
        info('Status: ' + status.status + '...');
    }

    throw new CLIError('Timed out waiting for agent response. Use `egnyte agents status ' + agentId + ' ' + requestId + '` to check manually.');
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

    const apiPath = AGENTS_API + '/' + agentId + '/ask/' + requestId + '/status';

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath), bodyType: 'none' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = {
    cmdAgentsList,
    cmdAgentsAsk,
    cmdAgentsStatus,
};
