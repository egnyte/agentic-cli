'use strict';

const { CLIError } = require('./output');

/**
 * Validate an Egnyte path before any network call is made.
 * Throws CLIError (not process.exit) so the caller controls the exit path
 * and unit tests can assert without spawning a subprocess.
 *
 * Six rules, in order:
 *   1. Must start with /
 *   2. No path traversal (..)
 *   3. No pre-encoded slashes (%2f / %2F)
 *   4. No embedded query strings (?)
 *   5. No double-encoded characters (%25)
 *   6. No null bytes (%00) or control characters
 */
function validatePath(p) {
    if (!p.startsWith('/'))
        throw new CLIError("Invalid path \u2014 must start with /: '" + p + "'");

    if (/(^|\/)\.\.(\/|$)/.test(p))
        throw new CLIError("Invalid path \u2014 path traversal (..) detected: '" + p + "'");

    if (/%2f/i.test(p))
        throw new CLIError("Invalid path \u2014 pre-encoded slash (%2f) detected: '" + p + "'");

    if (p.includes('?'))
        throw new CLIError("Invalid path \u2014 embedded query string (?) detected: '" + p + "'");

    if (/%25/i.test(p))
        throw new CLIError("Invalid path \u2014 double-encoded characters (%25) detected: '" + p + "'");

    if (/%00/i.test(p))
        throw new CLIError("Invalid path \u2014 null byte (%00) detected: '" + p + "'");

    if (/[\x00-\x1f]/.test(p)) // eslint-disable-line no-control-regex
        throw new CLIError("Invalid path \u2014 control characters detected: '" + p + "'");
}

module.exports = { validatePath };
