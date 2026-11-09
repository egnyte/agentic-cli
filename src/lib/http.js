'use strict';

const fs    = require('fs');
const http  = require('http');
const https = require('https');
const net   = require('net');
const os    = require('os');
const tls   = require('tls');
const { URL } = require('url');
const { CLIError, info } = require('./output');
const { buildEgnyteBaseUrl } = require('./domain');
const { ENABLED_HEADER, isAiSafeguardedPath } = require('./ai-safeguards');
const { version: CLI_VERSION } = require('../../package.json');

const AUTH_FAILED_HINT = 'Run `egnyte login` to re-authenticate, or verify your EGNYTE_TOKEN is valid.';

const USER_AGENT = 'agentic-cli/' + CLI_VERSION + ' (' + os.platform() + ' ' + os.arch() + ') node/' + process.version;
/**
 * Parse an API error response body and return a structured CLIError.
 * Extracts: human message, error code, request ID, context info.
 * Falls back to raw body text (truncated) when body is not JSON.
 */
// { inputErrors: { field: [{ code, msg }] } } is the input-validation envelope used by
// e.g. /pubapi/v1/events — keep the human msg per field, drop the internal validator code
function _inputErrorsDetail(p) {
    if (!p.inputErrors || typeof p.inputErrors !== 'object') return undefined;
    const parts = [];
    Object.entries(p.inputErrors).forEach(function(pair) {
        (Array.isArray(pair[1]) ? pair[1] : []).forEach(function(e) {
            if (e && e.msg) parts.push(pair[0] + ': ' + e.msg);
        });
    });
    return parts.length ? parts.join('; ') : undefined;
}

function _buildApiError(statusCode, bodyBuf, headers) {
    const bodyStr = (bodyBuf || Buffer.alloc(0)).toString().trim();
    let message = 'HTTP ' + statusCode;
    let errorCode, requestId, contextInfo;

    try {
        const p = JSON.parse(bodyStr);
        // Human-readable message — try common field names across Egnyte APIs
        // p.fault is the Apigee gateway error envelope: { faultstring, detail: { errorcode } }
        const detail = p.errorMessage || p.error_description || p.message || p.detail ||
                       (p.fault && p.fault.faultstring) || _inputErrorsDetail(p) || undefined;
        // Error code — short machine-readable string
        errorCode = p.errorCode || p.error || p.code ||
                    (p.fault && p.fault.detail && p.fault.detail.errorcode) || undefined;
        // Request / correlation ID for support tickets
        requestId = p.requestId || p.request_id || p.correlationId || undefined;
        // Extra context object
        contextInfo = (p.context_info && typeof p.context_info === 'object') ? p.context_info : undefined;

        if (detail) {
            message = 'HTTP ' + statusCode + ': ' + detail;
        } else if (errorCode) {
            message = 'HTTP ' + statusCode + ': ' + errorCode;
        } else if (Object.keys(p).length) {
            message = 'HTTP ' + statusCode + ': ' + JSON.stringify(p);
        }
    } catch (_) {
        if (bodyStr) message = 'HTTP ' + statusCode + ': ' + bodyStr.slice(0, 300);
    }
    if (statusCode === 401) {
        message += '\n' + AUTH_FAILED_HINT;
    }

    // Retry-After tells the caller when to come back; --verbose adds the quota headers to a 429
    let retryAfter, retryAt, rateLimit;
    if (headers) {
        retryAfter = _retryAfterSeconds(headers);
        if (retryAfter > 0) {
            // A huge Retry-After lands outside the Date range; keep the error, drop retryAt
            const at = new Date(Date.now() + retryAfter * 1000);
            if (!isNaN(at.getTime())) retryAt = at.toISOString().replace(/\.\d{3}Z$/, 'Z');
        }
        if (_verbose && statusCode === 429) {
            const rl = _rateLimitFromHeaders(headers);
            if (Object.keys(rl).length) rateLimit = rl;
        }
    }

    return new CLIError(message, { statusCode, errorCode, requestId, contextInfo, retryAfter, retryAt, rateLimit });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// When verbose mode is on, rate-limit headers are merged into every API response
// so scripts and agents can see how many calls they have remaining and self-pace.
// Set once at startup via setVerbose(true) — no changes needed in command files.
let _verbose = false;
function setVerbose(v) { _verbose = v; }

// Longest Retry-After (seconds) a 429 is waited out before the CLI gives up. Daily-quota
// 429s carry a Retry-After of hours; waiting for one would look like a hung command.
const DEFAULT_MAX_RETRY_WAIT = 60;
// Upper bound for --max-retry-wait (one day, same as --timeout in ai.js); keeps sleep() under
// Node's 2^31-1 ms setTimeout limit
const MAX_RETRY_WAIT_LIMIT = 86400;
let _maxRetryWait = DEFAULT_MAX_RETRY_WAIT;
function setMaxRetryWait(sec) { _maxRetryWait = sec; }

// With --json-progress, stderr is newline-delimited JSON, so retry notices are emitted as events.
let _jsonProgress = false;
function setJsonProgress(v) { _jsonProgress = v; }

/**
 * Resolve the retry-wait cap: --max-retry-wait beats EGNYTE_MAX_RETRY_WAIT beats the
 * default. Whole seconds up to MAX_RETRY_WAIT_LIMIT; 0 means never wait, fail on the first 429 instead.
 */
function resolveMaxRetryWait(args, env) {
    const fromFlag = args['max-retry-wait'] !== undefined;
    const raw = fromFlag ? args['max-retry-wait'] : env.EGNYTE_MAX_RETRY_WAIT;
    if (raw === undefined || raw === '') return DEFAULT_MAX_RETRY_WAIT;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) > MAX_RETRY_WAIT_LIMIT) {
        throw new CLIError('Invalid ' + (fromFlag ? '--max-retry-wait' : 'EGNYTE_MAX_RETRY_WAIT') +
            ': expected whole seconds from 0 to ' + MAX_RETRY_WAIT_LIMIT + ' (0 = never wait), got ' + String(raw));
    }
    return parseInt(raw, 10);
}

function _retryAfterSeconds(headers) {
    return parseInt(headers['retry-after']) || 0;
}

/**
 * Shared 429 policy for apiRequest and apiDownload. Returns the seconds to wait before
 * retrying, or throws `err` when the retries are spent or the wait is not worth it.
 * Every wait is announced on stderr — a retry is never silent (as a JSON event with --json-progress).
 *
 * @param {CLIError} err        The 429 error built by _buildApiError (with response headers)
 * @param {number} attempt      0-based attempt that just failed
 * @param {number} maxRetries
 */
function _planRetry429(err, attempt, maxRetries) {
    const delaySec = err.retryAfter > 0 ? err.retryAfter : Math.pow(2, attempt);
    if (delaySec > _maxRetryWait) {
        // A Retry-After over the default cap is usually an exhausted quota, but nothing in the
        // response says so — name the wait, not the cause. A shorter one (e.g. with
        // --max-retry-wait 0) is an ordinary rate limit the caller chose not to wait out
        if (err.retryAfter > DEFAULT_MAX_RETRY_WAIT) {
            err.message = 'HTTP 429: rate limited, retry after ' + (err.retryAt || err.retryAfter + 's');
        }
        throw err;
    }
    if (attempt >= maxRetries) throw err;
    if (_jsonProgress) {
        process.stderr.write(JSON.stringify({ type: 'retry', status: 429, wait: delaySec, attempt: attempt + 1, max: maxRetries }) + '\n');
    } else {
        info('[retry] HTTP 429, waiting ' + delaySec + 's (' + (attempt + 1) + '/' + maxRetries + ')');
    }
    return delaySec;
}

/**
 * Resolve the Authorization header and API path for a token.
 * Desktop App tokens are OAuth tokens: "OAUTH oauth_token=..." on /api/...
 * Other auth sources keep Bearer authentication and the supplied path.
 */
function buildAuth(token, authSource, apiPath) {
    if (authSource === 'desktop_app') {
        return {
            authorization: 'OAUTH oauth_token=' + token + ',oauth_version=2.0',
            apiPath: resolveApiPath(apiPath, authSource)
        };
    }
    return { authorization: 'Bearer ' + token, apiPath };
}

// Shared by actual requests and dry-run previews. Never rewrite an embedded
// /pubapi segment or a different prefix such as /pubapi-other.
function resolveApiPath(apiPath, authSource) {
    return authSource === 'desktop_app' ? apiPath.replace(/^\/pubapi(?=\/|\?|$)/, '/api') : apiPath;
}

/** Build an HTTPS URL; an optional auth source also routes dry-run previews. */
function buildUrl(domain, apiPath, query, authSource) {
    query = query || {};
    const base = buildEgnyteBaseUrl(domain) + resolveApiPath(apiPath, authSource);
    const pairs = [];
    Object.entries(query).forEach(function(pair) {
        const k = pair[0];
        const v = pair[1];
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) {
            v.forEach(function(item) { pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(item)); });
        } else if (typeof v === 'object') {
            pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(JSON.stringify(v)));
        } else {
            pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
        }
    });
    const qs = pairs.join('&');
    return qs ? base + '?' + qs : base;
}

const PROXY_CONNECT_TIMEOUT_MS = 30000;

function _cleanHostname(hostname) {
    return String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

/** Match NO_PROXY entries such as example.com, .example.com:443, [::1], or *. */
function _isProxyBypassed(hostname, port, noProxy) {
    if (!noProxy) return false;
    const host = _cleanHostname(hostname);

    return String(noProxy).split(',').some(function(rawEntry) {
        let entry = rawEntry.trim().toLowerCase();
        if (!entry) return false;
        if (entry === '*') return true;

        let entryPort;
        if (entry[0] === '[') {
            const end = entry.indexOf(']');
            if (end === -1) return false;
            const remainder = entry.slice(end + 1);
            if (remainder && !/^:\d+$/.test(remainder)) return false;
            entryPort = remainder ? remainder.slice(1) : undefined;
            entry = entry.slice(1, end);
        } else {
            const portMatch = entry.match(/^(.*):(\d+)$/);
            if (portMatch && portMatch[1].indexOf(':') === -1) {
                entry = portMatch[1];
                entryPort = portMatch[2];
            }
        }

        if (entryPort && Number(entryPort) !== Number(port || 443)) return false;
        entry = _cleanHostname(entry).replace(/^\./, '');
        return entry && (host === entry || host.endsWith('.' + entry));
    });
}

/** Resolve standard proxy environment variables without exposing credentials in errors. */
function _proxyFromEnv(options) {
    const env = process.env;
    const port = Number(options.port) || 443;
    if (_isProxyBypassed(options.hostname || options.host, port, env.NO_PROXY || env.no_proxy)) return null;

    let raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
    if (!raw || !raw.trim()) return null;
    raw = raw.trim();
    if (raw.indexOf('://') === -1) raw = 'http://' + raw;

    let proxy;
    try {
        proxy = new URL(raw);
    } catch (_) {
        throw new CLIError('Invalid HTTP proxy URL. Expected http://host[:port].');
    }
    if (proxy.protocol !== 'http:' || !proxy.hostname) {
        throw new CLIError('Unsupported proxy protocol. Use an HTTP proxy URL: http://host[:port].');
    }

    let authorization;
    if (proxy.username || proxy.password) {
        try {
            const credentials = decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password);
            authorization = 'Basic ' + Buffer.from(credentials).toString('base64');
        } catch (_) {
            throw new CLIError('Invalid HTTP proxy credentials: URL encoding is malformed.');
        }
    }

    return {
        hostname: _cleanHostname(proxy.hostname),
        port: Number(proxy.port) || 80,
        authorization,
    };
}

/**
 * Create an HTTPS agent that tunnels through an HTTP proxy with CONNECT.
 * Each agent is request-scoped, matching the existing non-keep-alive behavior.
 */
function _proxyAgentFor(options) {
    const proxy = _proxyFromEnv(options);
    if (!proxy) return undefined;

    const targetHost = _cleanHostname(options.hostname || options.host);
    const targetPort = Number(options.port) || 443;
    const authority = (net.isIP(targetHost) === 6 ? '[' + targetHost + ']' : targetHost) + ':' + targetPort;
    const agent = new https.Agent();

    agent.createConnection = function(connectionOptions, callback) {
        const headers = { Host: authority };
        if (proxy.authorization) headers['Proxy-Authorization'] = proxy.authorization;

        const connectRequest = http.request({
            hostname: proxy.hostname,
            port: proxy.port,
            method: 'CONNECT',
            path: authority,
            headers,
        });
        let settled = false;
        function done(err, socket) {
            if (settled) return;
            settled = true;
            callback(err, socket);
        }

        connectRequest.once('connect', function(res, socket, head) {
            // The tunnel is ready; the outer HTTPS request now owns socket timeouts.
            connectRequest.setTimeout(0);
            if (res.statusCode !== 200) {
                socket.destroy();
                done(new Error('Proxy CONNECT failed with HTTP ' + res.statusCode));
                return;
            }
            if (head.length) socket.unshift(head);

            const tlsOptions = Object.assign({}, connectionOptions, { socket });
            if (!tlsOptions.servername && net.isIP(targetHost) === 0) tlsOptions.servername = targetHost;
            let secureSocket;
            try {
                secureSocket = tls.connect(tlsOptions);
            } catch (err) {
                socket.destroy();
                done(err);
                return;
            }
            done(null, secureSocket);
        });
        connectRequest.once('error', done);
        connectRequest.setTimeout(PROXY_CONNECT_TIMEOUT_MS, function() {
            connectRequest.destroy(new Error('Proxy CONNECT timed out after 30s'));
        });
        connectRequest.end();
        // Node calls the callback asynchronously once the tunnel is ready.
    };

    return agent;
}

/**
 * Single HTTP request, no retries. Returns { status, headers, body: Buffer }.
 * Internal: apiRequest runs its own retry loop around it; other callers use httpRequest.
 * @param {object} options  - Node https.request options
 * @param {Buffer} [body]   - Request body
 * @param {number} [timeoutMs=30000] - Request timeout in ms. Increase for large chunk uploads.
 */
function _httpRequestOnce(options, body, timeoutMs) {
    return new Promise(function(resolve, reject) {
        const requestOptions = Object.assign({}, options);
        const proxyAgent = _proxyAgentFor(requestOptions);
        if (proxyAgent) requestOptions.agent = proxyAgent;
        const req = https.request(requestOptions, function(res) {
            const chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                resolve({
                    status:  res.statusCode,
                    headers: res.headers,
                    body:    Buffer.concat(chunks),
                });
            });
        });
        req.setTimeout(timeoutMs || 30000, function() {
            req.destroy(new Error('Request timed out after ' + ((timeoutMs || 30000) / 1000) + 's'));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

/**
 * HTTP request with the shared 429 policy (same as apiRequest): waits out a Retry-After within
 * the max retry wait, announcing each wait on stderr, and throws the 429 CLIError when the
 * retries are spent or the wait is not worth it. Any other status is returned to the caller.
 * Returns { status, headers, body: Buffer }.
 */
async function httpRequest(options, body, timeoutMs) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; ; attempt++) {
        const resp = await _httpRequestOnce(options, body, timeoutMs);
        if (resp.status !== 429) return resp;
        const delaySec = _planRetry429(_buildApiError(resp.status, resp.body, resp.headers), attempt, MAX_RETRIES);
        await sleep(delaySec * 1000);
    }
}

/** POST to a URL with a raw string body and a given content-type. Returns parsed JSON. */
async function httpPost(url, body, contentType) {
    const parsed = new URL(url);
    const buf    = Buffer.from(body);

    return new Promise(function(resolve, reject) {
        const req = https.request({
            hostname: parsed.hostname,
            port:     parsed.port || 443,
            path:     parsed.pathname + parsed.search,
            method:   'POST',
            agent:    _proxyAgentFor(parsed),
            headers:  {
                'Content-Type':   contentType,
                'Content-Length': buf.length,
                'User-Agent':     USER_AGENT,
            },
        }, function(res) {
            const chunks = [];
            res.on('data', function(c) { chunks.push(c); });
            res.on('end', function() {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (_) { resolve({}); }
            });
        });
        req.on('error', reject);
        req.write(buf);
        req.end();
    });
}

/**
 * Authenticated API request to the Egnyte Public API.
 * Automatically retries on 429 (rate-limit) up to 3 times, honouring the
 * Retry-After header when present and falling back to exponential backoff.
 * Each wait is reported on stderr; a Retry-After over the max retry wait
 * (default 60 s, see setMaxRetryWait) fails immediately instead of waiting.
 * Throws CLIError on HTTP 4xx/5xx.
 */
async function apiRequest(opts) {
    const { domain, token, auth_source, method, query, body, bodyType, raw } = opts;
    const auth = buildAuth(token, auth_source, opts.apiPath);
    const apiPath = auth.apiPath;
    const urlStr = buildUrl(domain, apiPath, query);
    const parsed = new URL(urlStr);
    const headers = { Authorization: auth.authorization, 'User-Agent': USER_AGENT };
    // AI Safeguards: route content-serving PubAPI calls (AI, search, file content)
    // through the safeguards facade.
    if (isAiSafeguardedPath(apiPath)) {
        headers[ENABLED_HEADER] = 'true';
    }
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const retryableServerErrorMethods = new Set(['GET', 'HEAD']);
    let bodyBuf;

    if (body && bodyType === 'json') {
        bodyBuf = Buffer.from(JSON.stringify(body));
        headers['Content-Type']   = 'application/json';
        headers['Content-Length'] = bodyBuf.length;
    } else if (body && bodyType === 'multipart') {
        bodyBuf = body.data;
        headers['Content-Type']   = 'multipart/form-data; boundary=' + body.boundary;
        headers['Content-Length'] = bodyBuf.length;
    }

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const resp = await _httpRequestOnce({
            hostname: parsed.hostname,
            port:     parsed.port || 443,
            path:     parsed.pathname + parsed.search,
            method: normalizedMethod,
            headers,
        }, bodyBuf);

        // Rate-limited — wait then retry (up to MAX_RETRIES times); throws when not worth waiting
        if (resp.status === 429) {
            const delaySec = _planRetry429(_buildApiError(resp.status, resp.body, resp.headers), attempt, MAX_RETRIES);
            await sleep(delaySec * 1000);
            continue;
        }

        // Transient server errors — retry with exponential backoff + jitter
        if (resp.status >= 500 &&
            retryableServerErrorMethods.has(normalizedMethod) &&
            attempt < MAX_RETRIES) {
            const delaySec = Math.pow(2, attempt) + Math.random();
            await sleep(delaySec * 1000);
            continue;
        }

        if (resp.status >= 400) {
            throw _buildApiError(resp.status, resp.body, resp.headers);
        }

        if (resp.body.length === 0) {
            // Even on empty body, surface rate-limit info in verbose mode
            if (_verbose) return _withRateLimit(null, resp.headers);
            return null;
        }

        const ct = resp.headers['content-type'] || '';
        let result;
        if (raw) {
            result = resp.body.toString();
        } else if (ct.includes('application/json')) {
            result = JSON.parse(resp.body.toString());
        } else {
            try { result = JSON.parse(resp.body.toString()); } catch (_) { result = null; }
        }

        if (_verbose) return _withRateLimit(result, resp.headers);
        return result;
    }
}

/**
 * Read Egnyte rate-limit response headers into a _ratelimit object ({} when none are present).
 * Egnyte uses non-standard header names (not the common x-ratelimit-* convention):
 *   x-accesstoken-qps-allotted   — calls per second allowed (2 for most tokens)
 *   x-accesstoken-qps-current    — calls used in the current second
 *   x-accesstoken-quota-allotted — total API call quota for the period
 *   x-accesstoken-quota-current  — quota calls used so far
 */
function _rateLimitFromHeaders(headers) {
    const rl = {};
    const qpsAllotted  = parseInt(headers['x-accesstoken-qps-allotted']);
    const qpsCurrent   = parseInt(headers['x-accesstoken-qps-current']);
    const quotaAlloted = parseInt(headers['x-accesstoken-quota-allotted']);
    const quotaCurrent = parseInt(headers['x-accesstoken-quota-current']);

    if (!isNaN(qpsAllotted))  rl.qps_limit     = qpsAllotted;
    if (!isNaN(qpsCurrent))   rl.qps_used      = qpsCurrent;
    if (!isNaN(qpsAllotted) && !isNaN(qpsCurrent))
                               rl.qps_remaining = qpsAllotted - qpsCurrent;
    if (!isNaN(quotaAlloted)) rl.quota_limit   = quotaAlloted;
    if (!isNaN(quotaCurrent)) rl.quota_used    = quotaCurrent;
    if (headers['retry-after']) rl.retry_after = parseInt(headers['retry-after']);
    return rl;
}

/**
 * Merge the rate-limit headers into the result object when --verbose is on.
 * If result is null or not a plain object, wraps it as { _data: result, _ratelimit: ... }.
 */
function _withRateLimit(result, headers) {
    const rl = _rateLimitFromHeaders(headers);

    // Nothing to add — server didn't send rate-limit headers
    if (!Object.keys(rl).length) return result;

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        result._ratelimit = rl;
        return result;
    }
    // Wrap primitives, arrays, or null so _ratelimit is always accessible
    return { _data: result, _ratelimit: rl };
}

/**
 * Streaming file download — pipes the response body directly to disk without
 * buffering in memory. Safe for files of any size.
 * Uses a 5-minute idle timeout (resets whenever data arrives).
 * Throws CLIError on HTTP 4xx/5xx (error body is small, buffered normally).
 * Cleans up the partial file on any error (unless resume=true).
 *
 * When resume=true and the output file already exists, sends a Range header to
 * skip bytes already on disk and appends to the file. A 416 response (range
 * not satisfiable) means the file is already complete — treated as success.
 */
function _downloadOnce(opts, outPath, resume) {
    const { domain, token, auth_source, onProgress } = opts;
    const auth = buildAuth(token, auth_source, opts.apiPath);
    const apiPath = auth.apiPath;
    const urlStr = buildUrl(domain, apiPath);
    const parsed = new URL(urlStr);

    // Determine how many bytes we already have on disk
    let startByte = 0;
    if (resume) {
        try { startByte = fs.statSync(outPath).size; } catch (_) {}
    }

    const reqHeaders = { Authorization: auth.authorization, 'User-Agent': USER_AGENT };
    // AI Safeguards: downloads serve file content — route through the safeguards facade.
    if (isAiSafeguardedPath(apiPath)) {
        reqHeaders[ENABLED_HEADER] = 'true';
    }
    if (startByte > 0) reqHeaders['Range'] = 'bytes=' + startByte + '-';

    return new Promise(function(resolve, reject) {
        const req = https.request({
            hostname: parsed.hostname,
            port:     parsed.port || 443,
            path:     parsed.pathname + parsed.search,
            method:   'GET',
            agent:    _proxyAgentFor(parsed),
            headers:  reqHeaders,
        }, function(res) {
            // 416 Range Not Satisfiable — the file on disk is already complete
            if (res.statusCode === 416) {
                res.resume(); // drain the (empty) body
                resolve();
                return;
            }

            if (res.statusCode >= 400) {
                const chunks = [];
                res.on('data', function(c) { chunks.push(c); });
                res.on('end', function() {
                    reject(_buildApiError(res.statusCode, Buffer.concat(chunks), res.headers));
                });
                return;
            }

            // 206 Partial Content → append; 200 OK → overwrite
            const fileFlags = (res.statusCode === 206) ? 'a' : 'w';
            const file = fs.createWriteStream(outPath, { flags: fileFlags });
            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let transferred = startByte;
            if (onProgress) {
                onProgress({
                    transferred: transferred,
                    total: totalBytes ? startByte + totalBytes : null,
                });
            }
            res.on('data', function(chunk) {
                transferred += chunk.length;
                if (onProgress) {
                    onProgress({
                        transferred: transferred,
                        total: totalBytes ? startByte + totalBytes : null,
                    });
                }
            });
            res.pipe(file);
            file.on('finish', resolve);
            file.on('error', function(err) {
                if (!resume) fs.unlink(outPath, function() {});
                reject(err);
            });
            res.on('error', function(err) {
                if (!resume) fs.unlink(outPath, function() {});
                reject(err);
            });
        });

        // 5-minute idle timeout — fires only if no bytes arrive for 5 minutes
        req.setTimeout(300000, function() {
            req.destroy(new Error('Download timed out (no data for 5 minutes)'));
        });
        req.on('error', function(err) {
            if (!resume) fs.unlink(outPath, function() {});
            reject(err);
        });
        req.end();
    });
}

/**
 * Streaming download with the same rate-limit handling as apiRequest: retries a
 * 429 (Apigee spike arrest) or a transient 5xx up to 3 times, honouring
 * Retry-After and falling back to exponential backoff. A 429 follows the same
 * stderr reporting and max-retry-wait cap as apiRequest. Only failures raised
 * before any byte is written are retried, so a resumed file is never corrupted.
 */
async function apiDownload(opts, outPath, resume) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await _downloadOnce(opts, outPath, resume);
        } catch (err) {
            const status = err && err.statusCode;
            const retryable = status === 429 || status >= 500;
            if (!retryable || attempt === MAX_RETRIES) throw err;
            const delaySec = status === 429
                ? _planRetry429(err, attempt, MAX_RETRIES)
                : (err.retryAfter > 0 ? err.retryAfter : Math.pow(2, attempt));
            await sleep(delaySec * 1000);
        }
    }
}

module.exports = {
    buildUrl, httpRequest, httpPost, apiRequest, apiDownload, setVerbose, buildAuth, USER_AGENT,
    setMaxRetryWait, resolveMaxRetryWait, setJsonProgress,
};
