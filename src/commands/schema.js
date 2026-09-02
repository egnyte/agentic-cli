'use strict';

const { SCHEMA }    = require('../lib/schema-registry');
const { out, CLIError } = require('../lib/output');

/**
 * egnyte schema --list          → list all operations (summary + method + mutating)
 * egnyte schema <operation>     → full parameter reference for one operation
 *
 * Agent rule: run schema before any call to discover parameters at runtime.
 * This eliminates hallucination caused by stale or missing documentation.
 */
function cmdSchema(args) {
    // Accept the space form used everywhere else ("events list", or two args) as
    // well as the dotted registry key ("events.list")
    const op = args._.slice(1).join('.').replace(/\s+/g, '.');

    if (args.list || !op) {
        out(Object.fromEntries(
            Object.entries(SCHEMA).map(function(pair) {
                const k = pair[0];
                const v = pair[1];
                return [k, { summary: v.summary, method: v.method, mutating: v.mutating }];
            })
        ));
        return;
    }

    const schema = SCHEMA[op];
    if (!schema) throw new CLIError("Unknown operation: '" + op + "'. Run: egnyte schema --list");
    out(schema);
}

module.exports = { cmdSchema };
