'use strict';

const { resolveAuth }              = require('../lib/auth');
const { parseJsonArg }             = require('../lib/args');
const { applyFields }              = require('../lib/fields');
const { apiRequest }               = require('../lib/http');
const { out, CLIError }            = require('../lib/output');

const EVENTS_API = '/pubapi/v1/events';

// ── events get-cursor ─────────────────────────────────────────────────────────

async function cmdEventsGetCursor(args) {
    const { token, domain } = await resolveAuth(args);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: EVENTS_API + '/cursor' });
    out(applyFields(result, args.fields));
}

// ── events list ───────────────────────────────────────────────────────────────

async function cmdEventsList(args) {
    const { token, domain } = await resolveAuth(args);
    const query = parseJsonArg(args.json);

    if (query.id === undefined) {
        throw new CLIError('"id" (start event ID) is required in --json — get the latest ID first with: egnyte events get-cursor');
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath: EVENTS_API, query });
    out(applyFields(result, args.fields));
}

module.exports = { cmdEventsGetCursor, cmdEventsList };
