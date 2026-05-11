'use strict';

/**
 * CLIError — thrown by library functions instead of calling process.exit directly.
 * The top-level main() catch handler converts it to fatal() output.
 * This design keeps library functions pure and testable.
 *
 * Carries structured API error fields so fatal() can emit rich JSON:
 *   statusCode   — HTTP status (e.g. 403)
 *   errorCode    — API error code string (e.g. "access_denied")
 *   requestId    — server-side request ID for support tickets
 *   contextInfo  — extra detail object from the API body
 */
class CLIError extends Error {
    constructor(msg, opts) {
        super(msg);
        this.name = 'CLIError';
        opts = opts || {};
        if (opts.statusCode)   this.statusCode  = opts.statusCode;
        if (opts.errorCode)    this.errorCode   = opts.errorCode;
        if (opts.requestId)    this.requestId   = opts.requestId;
        if (opts.contextInfo)  this.contextInfo = opts.contextInfo;
        if (opts.cause)        this.cause       = opts.cause;
    }
}

/** Write structured JSON to stdout — the only output format agents ever see. */
function out(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** Write structured JSON error to stderr and exit. Only called from the top-level dispatcher. */
function fatal(err, code) {
    code = (code === undefined) ? 1 : code;
    const out = {};

    if (err && typeof err === 'object' && err.name === 'CLIError') {
        out.error = err.message;
        if (err.statusCode)   out.status      = err.statusCode;
        if (err.errorCode)    out.code         = err.errorCode;
        if (err.requestId)    out.request_id   = err.requestId;
        if (err.contextInfo)  out.context_info = err.contextInfo;
    } else {
        out.error = (err && err.message) ? err.message : String(err);
    }

    process.stderr.write(JSON.stringify(out) + '\n');
    process.exit(code);
}

/** Write a plain informational string to stderr (never stdout). */
function info(msg) {
    process.stderr.write(msg + '\n');
}

function formatDryRun(opts) {
    const { method, url, body, bodyType, localFile } = opts;
    const parts = [
        "curl -X " + method + " '" + url + "'",
        "  -H 'Authorization: ***'",
    ];
    if (bodyType === 'json') {
        parts.push("  -H 'Content-Type: application/json'");
        parts.push("  -d '" + JSON.stringify(body) + "'");
    } else if (bodyType === 'multipart') {
        parts.push("  -H 'Content-Type: multipart/form-data'");
        parts.push("  -F 'file=@" + localFile + "'");
    }
    return parts.join(' \\\n');
}

/**
 * Print a redacted curl preview for --dry-run.
 * Accepts a pre-built url string to avoid a circular dependency with http.js.
 *
 * @param {object} opts
 * @param {string} opts.method    HTTP method
 * @param {string} opts.url       Full URL (pre-built by caller)
 * @param {object} [opts.body]    Request body (for json bodyType)
 * @param {string} [opts.bodyType] 'json' | 'multipart'
 * @param {string} [opts.localFile] Local file path (for multipart bodyType)
 */
function printDryRun(opts) {
    process.stdout.write(formatDryRun(opts) + '\n');
}

/**
 * Guard for mutating operations — enforces that the caller passes either
 * --dry-run (preview only) or --yes (explicit confirmation) before any
 * command that modifies data executes.
 *
 * Throws CLIError when neither flag is present, so accidents are impossible
 * at the binary level regardless of what the skill file says.
 */
function requireConfirmation(args) {
    if (!args['dry-run'] && !args.yes) {
        throw new CLIError(
            'Mutating operation requires confirmation.\n' +
            '  --dry-run   Preview the request without executing\n' +
            '  --yes       Confirm and execute'
        );
    }
}

function serializeError(err) {
    const payload = {
        error: (err && err.message) ? err.message : String(err),
    };
    if (err && err.statusCode)   payload.status = err.statusCode;
    if (err && err.errorCode)    payload.code = err.errorCode;
    if (err && err.requestId)    payload.request_id = err.requestId;
    if (err && err.contextInfo)  payload.context_info = err.contextInfo;
    return payload;
}

module.exports = { CLIError, out, fatal, info, formatDryRun, printDryRun, requireConfirmation, serializeError };
