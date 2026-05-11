'use strict';

const fs    = require('fs');
const https = require('https');
const { URL } = require('url');
const { CLIError } = require('./output');
const { buildEgnyteBaseUrl } = require('./domain');

const AUTH_FAILED_HINT = 'Run `egnyte login` to re-authenticate, or verify your EGNYTE_TOKEN is valid.';

/**
 * Parse an API error response body and return a structured CLIError.
 * Extracts: human message, error code, request ID, context info.
 * Falls back to raw body text (truncated) when body is not JSON.
 */
function _buildApiError(statusCode, bodyBuf) {
    const bodyStr = (bodyBuf || Buffer.alloc(0)).toString().trim();
    let message = 'HTTP ' + statusCode;
    let errorCode, requestId, contextInfo;

    try {
        const p = JSON.parse(bodyStr);
        // Human-readable message — try common field names across Egnyte APIs
        // p.fault is the Apigee gateway error envelope: { faultstring, detail: { errorcode } }
        const detail = p.errorMessage || p.error_description || p.message || p.detail ||
                       (p.fault && p.fault.faultstring) || undefined;
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

    // Auth hint — mirrors Box CLI pattern
    if (statusCode === 401) {
        message += '\n' + AUTH_FAILED_HINT;
    }

    return new CLIError(message, { statusCode, errorCode, requestId, contextInfo });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// When verbose mode is on, rate-limit headers are merged into every API response
// so scripts and agents can see how many calls they have remaining and self-pace.
// Set once at startup via setVerbose(true) — no changes needed in command files.
let _verbose = false;
function setVerbose(v) { _verbose = v; }

/** Build a full HTTPS URL from domain, API path, and optional query params object. */
function buildUrl(domain, apiPath, query) {
    query = query || {};
    const base = buildEgnyteBaseUrl(domain) + apiPath;
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

/**
 * Low-level HTTP request. Returns { status, headers, body: Buffer }.
 * @param {object} options  - Node https.request options
 * @param {Buffer} [body]   - Request body
 * @param {number} [timeoutMs=30000] - Request timeout in ms. Increase for large chunk uploads.
 */
function httpRequest(options, body, timeoutMs) {
    return new Promise(function(resolve, reject) {
        const req = https.request(options, function(res) {
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

/** POST to a URL with a raw string body and a given content-type. Returns parsed JSON. */
async function httpPost(url, body, contentType) {
    const parsed = new URL(url);
    const buf    = Buffer.from(body);

    return new Promise(function(resolve, reject) {
        const req = https.request({
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method:   'POST',
            headers:  {
                'Content-Type':   contentType,
                'Content-Length': buf.length,
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
 * Throws CLIError on HTTP 4xx/5xx.
 */
async function apiRequest(opts) {
    const { domain, token, method, apiPath, query, body, bodyType, raw } = opts;
    const urlStr = buildUrl(domain, apiPath, query);
    const parsed = new URL(urlStr);
    const headers = { Authorization: 'Bearer ' + token };
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
        const resp = await httpRequest({
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method: normalizedMethod,
            headers,
        }, bodyBuf);

        // Rate-limited — wait then retry (up to MAX_RETRIES times)
        if (resp.status === 429 && attempt < MAX_RETRIES) {
            const retryAfterSec = parseInt(resp.headers['retry-after']) || 0;
            const delaySec = retryAfterSec > 0 ? retryAfterSec : Math.pow(2, attempt);
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
            throw _buildApiError(resp.status, resp.body);
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
 * Merge Egnyte rate-limit response headers into the result object when --verbose is on.
 * Egnyte uses non-standard header names (not the common x-ratelimit-* convention):
 *   x-accesstoken-qps-allotted   — calls per second allowed (2 for most tokens)
 *   x-accesstoken-qps-current    — calls used in the current second
 *   x-accesstoken-quota-allotted — total API call quota for the period
 *   x-accesstoken-quota-current  — quota calls used so far
 * If result is null or not a plain object, wraps it as { _data: result, _ratelimit: ... }.
 */
function _withRateLimit(result, headers) {
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
function apiDownload(opts, outPath, resume) {
    const { domain, token, apiPath, onProgress } = opts;
    const urlStr = buildUrl(domain, apiPath);
    const parsed = new URL(urlStr);

    // Determine how many bytes we already have on disk
    let startByte = 0;
    if (resume) {
        try { startByte = fs.statSync(outPath).size; } catch (_) {}
    }

    const reqHeaders = { Authorization: 'Bearer ' + token };
    if (startByte > 0) reqHeaders['Range'] = 'bytes=' + startByte + '-';

    return new Promise(function(resolve, reject) {
        const req = https.request({
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method:   'GET',
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
                    reject(_buildApiError(res.statusCode, Buffer.concat(chunks)));
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

module.exports = { buildUrl, httpRequest, httpPost, apiRequest, apiDownload, setVerbose };
