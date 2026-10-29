'use strict';

const { CLIError } = require('./output');

/**
 * Minimal argument parser — no dependencies.
 * Supports positional args and --flag [value] / --flag (boolean).
 */
function parseArgs(argv) {
    const args = { _: [] };
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key  = a.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('-')) {
                args[key] = true;
            } else {
                args[key] = next;
                i++;
            }
        } else if (a.startsWith('-') && a.length === 2) {
            // Single-char flags like -X GET (curl-style method override)
            const key  = a.slice(1);
            const next = argv[i + 1];
            if (!next || next.startsWith('-')) {
                args[key] = true;
            } else {
                args[key] = next;
                i++;
            }
        } else {
            args._.push(a);
        }
        i++;
    }
    return args;
}

function parseJsonArg(raw) {
    if (!raw) return {};
    try { return JSON.parse(raw); }
    catch (e) { throw new CLIError('Invalid --json: ' + e.message); }
}

/**
 * Fail before the request when --json carries keys the API silently ignores,
 * so callers get an error instead of an unfiltered or unsorted result.
 */
function rejectIgnoredParams(command, route, params, keys, hint) {
    const given = keys.filter(function(k) { return params[k] !== undefined; });
    if (!given.length) return;
    throw new CLIError(command + ' does not support ' + given.join(', ') + ': ' + route + ' ignores them.' + (hint ? ' ' + hint : ''));
}

module.exports = { parseArgs, parseJsonArg, rejectIgnoredParams };
