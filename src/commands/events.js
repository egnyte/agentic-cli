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

    // The events API returns an empty body when no events match — normalize to the
    // same shape as a non-empty response so callers can always read .events. With
    // --verbose the empty body arrives wrapped as { _data: null, _ratelimit }.
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: EVENTS_API, query }) || {};
    if (result.events === undefined) {
        delete result._data;
        result.events = [];
    }
    out(applyFields(result, args.fields));
}

module.exports = { cmdEventsGetCursor, cmdEventsList };
