'use strict';

const { resolveAuth }                        = require('../lib/auth');
const { parseJsonArg }                       = require('../lib/args');
const { apiRequest, buildUrl }               = require('../lib/http');
const { applyFields }                        = require('../lib/fields');
const { out, info, printDryRun, CLIError }   = require('../lib/output');
const { AGENT_WAIT_FLAGS }                   = require('../lib/schema-registry');
const { readAssistantWaitOptions, printAssistantStatus } = require('./ai');

const AGENTS_API = '/pubapi/v1/ai/agents';

// Plugs agents into the wait helpers shared with `ai` (flags, polling, exit codes).
function agentWait(agentId) {
    return {
        cmd:         'agents',
        label:       'agent',
        idKey:       'requestId',
        flags:       AGENT_WAIT_FLAGS,
        rateWarning: false,
        statusPath:  function(requestId) {
            return AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask/' + encodeURIComponent(requestId) + '/status';
        },
    };
}

// ── agents list ───────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/agents/list
// Usage: egnyte agents list [--json '{"sortBy":"name","sortOrder":"asc"}'] [--fields agentId,name,status]

async function cmdAgentsList(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const extra  = parseJsonArg(args.json);
    if (extra.sortBy && !['name', 'createdOn'].includes(extra.sortBy)) {
        throw new CLIError('sortBy must be one of: name, createdOn');
    }
    const params = Object.assign({ sortBy: 'name', sortOrder: 'asc' }, extra);
    const qs     = new URLSearchParams(params).toString();
    const apiPath = AGENTS_API + '/list' + (qs ? '?' + qs : '');

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, AGENTS_API + '/list', null, auth_source) + (qs ? '?' + qs : ''), bodyType: 'none' });
        return;
    }

    const result = await apiRequest({ domain, token, auth_source, method: 'GET', apiPath });
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
    const { token, domain, auth_source } = await resolveAuth(args);

    const agentId  = args._[2];
    const question = args._[3];

    if (!agentId || !question) throw new CLIError(
        'Usage: egnyte agents ask <agentId> "<question>" [--json \'{"conversationId":"..."}\'] [--fields responseText,citations]'
    );

    const wait    = readAssistantWaitOptions(args, 'ask', agentWait(agentId));
    const extra   = parseJsonArg(args.json);
    const body    = Object.assign({ question }, extra);
    const apiPath = AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask';

    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath, null, auth_source), body, bodyType: 'json' });
        return;
    }

    const submitted = await apiRequest({ domain, token, auth_source, method: 'POST', apiPath, body, bodyType: 'json' });
    const requestId = submitted.requestId;
    if (!requestId) throw new CLIError('Agent did not return a requestId');

    if (args['no-wait']) {
        out(applyFields(submitted, args.fields));
        return;
    }

    info('Submitted. requestId=' + requestId + '. Polling for result...');
    await printAssistantStatus({ domain, token, auth_source }, requestId, args, wait, true, undefined, agentWait(agentId));
}

// ── agents status ─────────────────────────────────────────────────────────────
//
// GET /pubapi/v1/ai/agents/{agentId}/ask/{requestId}/status
// Usage: egnyte agents status <agentId> <requestId> [--fields responseText,citations,status]

async function cmdAgentsStatus(args) {
    const { token, domain, auth_source } = await resolveAuth(args);

    const agentId   = args._[2];
    const requestId = args._[3];

    if (!agentId || !requestId) throw new CLIError(
        'Usage: egnyte agents status <agentId> <requestId> [--fields responseText,citations,status]'
    );

    const wait    = readAssistantWaitOptions(args, 'status', agentWait(agentId));
    const apiPath = AGENTS_API + '/' + encodeURIComponent(agentId) + '/ask/' + encodeURIComponent(requestId) + '/status';

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath, null, auth_source), bodyType: 'none' });
        return;
    }

    if (wait) {
        await printAssistantStatus({ domain, token, auth_source }, requestId, args, wait, false, undefined, agentWait(agentId));
        return;
    }

    const result = await apiRequest({ domain, token, auth_source, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

module.exports = {
    cmdAgentsList,
    cmdAgentsAsk,
    cmdAgentsStatus,
};
