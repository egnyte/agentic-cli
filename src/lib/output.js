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
 *   retryAfter   — seconds from the response's Retry-After header
 *   retryAt      — ISO-8601 UTC time when retryAfter elapses
 *   rateLimit    — rate-limit headers of the response (--verbose, 429 only)
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
        if (opts.retryAfter)   this.retryAfter  = opts.retryAfter;
        if (opts.retryAt)      this.retryAt     = opts.retryAt;
        if (opts.rateLimit)    this.rateLimit   = opts.rateLimit;
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
    process.stderr.write(JSON.stringify(serializeError(err)) + '\n');
    process.exit(code);
}

/** Write a plain informational string to stderr (never stdout). */
function info(msg) {
    process.stderr.write(msg + '\n');
}

/** POSIX single-quote a value so apostrophes cannot break out of the quoting. */
function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * Encode the URL like apiRequest() does (new URL()), but keep placeholders such as
 * <entry-id> readable. Egnyte forbids < and > in names, so %3C...%3E is only ever a placeholder.
 */
function previewUrl(url) {
    return new URL(url).href.replace(/%3C([\w-]+)%3E/g, '<$1>');
}

function formatDryRun(opts) {
    const { method, url, body, bodyType, localFile } = opts;
    const parts = [
        'curl -X ' + method + ' ' + shellQuote(previewUrl(url)),
        "  -H 'Authorization: ***'",
    ];
    if (bodyType === 'json') {
        parts.push("  -H 'Content-Type: application/json'");
        parts.push('  -d ' + shellQuote(JSON.stringify(body)));
    } else if (bodyType === 'multipart') {
        parts.push("  -H 'Content-Type: multipart/form-data'");
        parts.push('  -F ' + shellQuote('file=@' + localFile));
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
 *
 * @param {object} args             Parsed CLI args
 * @param {string} [reason]         Optional one-line explanation of why this
 *                                  command mutates, appended to the guard error.
 *                                  Use for commands whose name does not make the
 *                                  mutation obvious (e.g. `ai ask`).
 */
function requireConfirmation(args, reason) {
    if (!args['dry-run'] && !args.yes) {
        throw new CLIError(
            'Mutating operation requires confirmation.\n' +
            (reason ? '  ' + reason + '\n' : '') +
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
    if (err && err.retryAfter)   payload.retry_after = err.retryAfter;
    if (err && err.retryAt)      payload.retry_at = err.retryAt;
    if (err && err.rateLimit)    payload._ratelimit = err.rateLimit;
    if (err && err.contextInfo)  payload.context_info = err.contextInfo;
    return payload;
}

module.exports = { CLIError, out, fatal, info, formatDryRun, printDryRun, requireConfirmation, serializeError };
