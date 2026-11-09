'use strict';

const EventEmitter = require('events');
const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { apiRequest, apiDownload, httpRequest, httpPost, buildAuth, buildUrl,
        setVerbose, setMaxRetryWait, resolveMaxRetryWait, setJsonProgress } = require('../src/lib/http');
const { CLIError } = require('../src/lib/output');

const PROXY_ENV_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];

describe('http helpers', function() {
    let originalRequest;
    let originalSetTimeout;
    let originalMathRandom;
    let originalProxyEnv;
    let queuedResponses;
    let callMethods;
    let callHeaders;
    let callOptions;
    let delays;
    let stderrOutput;

    beforeEach(function() {
        originalRequest = https.request;
        originalSetTimeout = global.setTimeout;
        originalMathRandom = Math.random;
        originalProxyEnv = {};
        PROXY_ENV_VARS.forEach(function(name) {
            originalProxyEnv[name] = process.env[name];
            delete process.env[name];
        });
        queuedResponses = [];
        callMethods = [];
        callHeaders = [];
        callOptions = [];
        delays = [];
        stderrOutput = [];

        // Capture what the CLI tells the user on stderr (retry notices) instead of printing it
        spyOn(process.stderr, 'write').and.callFake(function(chunk) { stderrOutput.push(String(chunk)); return true; });

        Math.random = function() { return 0; };
        global.setTimeout = function(fn, ms) {
            delays.push(ms);
            fn();
            return 0;
        };

        https.request = function(options, callback) {
            callMethods.push(options.method);
            callHeaders.push(options.headers);
            callOptions.push(options);

            const plan = queuedResponses.shift();
            if (!plan) throw new Error('No queued response for request');

            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.write = function() {};
            req.destroy = function(err) {
                this.emit('error', err);
            };
            req.end = function() {
                if (plan.error) {
                    this.emit('error', plan.error);
                    return;
                }

                const res = new EventEmitter();
                res.statusCode = plan.status;
                res.headers = plan.headers || {};
                callback(res);

                if (plan.body !== undefined) {
                    res.emit('data', Buffer.from(plan.body));
                }
                res.emit('end');
            };
            return req;
        };
    });

    afterEach(function() {
        https.request = originalRequest;
        global.setTimeout = originalSetTimeout;
        Math.random = originalMathRandom;
        PROXY_ENV_VARS.forEach(function(name) {
            if (originalProxyEnv[name] === undefined) delete process.env[name];
            else process.env[name] = originalProxyEnv[name];
        });
        setVerbose(false);
        setMaxRetryWait(60);
        setJsonProgress(false);
    });

    it('retries GET requests on 500 responses and eventually returns the success body', async function() {
        queuedResponses.push(
            { status: 500, body: '{"message":"temporary"}', headers: { 'content-type': 'application/json' } },
            { status: 502, body: '{"message":"still temporary"}', headers: { 'content-type': 'application/json' } },
            { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }
        );

        const result = await apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'GET',
            apiPath: '/pubapi/v1/userinfo',
        });

        expect(result).toEqual({ ok: true });
        expect(callMethods).toEqual(['GET', 'GET', 'GET']);
    });

    it('does not retry POST requests on 500 responses', async function() {
        queuedResponses.push(
            { status: 500, body: '{"message":"temporary"}', headers: { 'content-type': 'application/json' } }
        );

        await expectAsync(apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'POST',
            apiPath: '/pubapi/v2/users',
            body: { userName: 'jsmith' },
            bodyType: 'json',
        })).toBeRejectedWithError(CLIError, /HTTP 500/);

        expect(callMethods).toEqual(['POST']);
    });

    it('surfaces inputErrors msg without the internal validator code', async function() {
        queuedResponses.push(
            { status: 400, body: '{"formErrors":[],"inputErrors":{"count":[{"code":"ORG_HIBERNATE_VALIDATOR_CONSTRAINTS_RANGE_MESSAGE","msg":"Value must be between 1 and 100"}]}}', headers: { 'content-type': 'application/json' } }
        );

        await expectAsync(apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'GET',
            apiPath: '/pubapi/v1/events',
        })).toBeRejectedWithError(CLIError, /HTTP 400: count: Value must be between 1 and 100$/);
    });

    it('still retries 429 responses for mutating requests', async function() {
        queuedResponses.push(
            { status: 429, body: '{"message":"slow down"}', headers: { 'retry-after': '0', 'content-type': 'application/json' } },
            { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }
        );

        const result = await apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'DELETE',
            apiPath: '/pubapi/v2/users/1',
        });

        expect(result).toEqual({ ok: true });
        expect(callMethods).toEqual(['DELETE', 'DELETE']);
    });

    describe('buildAuth', function() {
        it('uses Bearer and keeps /pubapi for non-desktop tokens', function() {
            expect(buildAuth('t', 'stored_profile', '/pubapi/v1/fs/Shared')).toEqual({
                authorization: 'Bearer t', apiPath: '/pubapi/v1/fs/Shared'
            });
            expect(buildAuth('t', undefined, '/pubapi/v1/userinfo').authorization).toBe('Bearer t');
        });

        it('uses OAUTH header and /api for desktop_app tokens', function() {
            expect(buildAuth('t', 'desktop_app', '/pubapi/v1/fs/Shared')).toEqual({
                authorization: 'OAUTH oauth_token=t,oauth_version=2.0', apiPath: '/api/v1/fs/Shared'
            });
        });

        it('only rewrites the leading /pubapi segment', function() {
            expect(buildAuth('t', 'desktop_app', '/pubapi/v1/fs/pubapi/x').apiPath).toBe('/api/v1/fs/pubapi/x');
        });

        [
            ['/pubapi', '/api'],
            ['/pubapi?x=1', '/api?x=1'],
            ['/pubapi/v1/fs/Shared/pubapi/file', '/api/v1/fs/Shared/pubapi/file'],
            ['/api/v1/userinfo', '/api/v1/userinfo'],
            ['/pubapi-other/v1', '/pubapi-other/v1'],
            ['/custom/pubapi/v1', '/custom/pubapi/v1'],
        ].forEach(function(paths) {
            it('routes only the public API prefix: ' + paths[0], function() {
                expect(buildAuth('t', 'desktop_app', paths[0]).apiPath).toBe(paths[1]);
                expect(buildUrl('https://test.egnyte.com', paths[0], null, 'desktop_app'))
                    .toBe('https://test.egnyte.com' + paths[1]);
                expect(buildAuth('t', 'unknown-source', paths[0]))
                    .toEqual({ authorization: 'Bearer t', apiPath: paths[0] });
            });
        });

        it('keeps the existing buildUrl signature and query encoding', function() {
            const query = { query: 'some text' };
            expect(buildUrl('https://test.egnyte.com', '/pubapi/v1/search', query))
                .toBe('https://test.egnyte.com/pubapi/v1/search?query=some%20text');
            expect(buildUrl('https://test.egnyte.com', '/pubapi/v1/search', query, 'desktop_app'))
                .toBe('https://test.egnyte.com/api/v1/search?query=some%20text');
        });
    });

    it('apiRequest sends OAUTH header to /api for desktop_app tokens', async function() {
        let paths = [];
        const inner = https.request;
        https.request = function(options, cb) { paths.push(options.path); return inner(options, cb); };
        queuedResponses.push({ status: 200, body: '{}', headers: { 'content-type': 'application/json' } });

        await apiRequest({ domain: 'https://testdomain.egnyte.com', token: 'tok', auth_source: 'desktop_app', method: 'GET', apiPath: '/pubapi/v1/userinfo' });

        expect(callHeaders[0].Authorization).toBe('OAUTH oauth_token=tok,oauth_version=2.0');
        expect(paths[0]).toBe('/api/v1/userinfo');
    });

    it('apiRequest keeps Bearer on /pubapi when auth_source is not desktop_app', async function() {
        let paths = [];
        const inner = https.request;
        https.request = function(options, cb) { paths.push(options.path); return inner(options, cb); };
        queuedResponses.push({ status: 200, body: '{}', headers: { 'content-type': 'application/json' } });

        await apiRequest({ domain: 'https://testdomain.egnyte.com', token: 'tok', auth_source: 'stored_profile', method: 'GET', apiPath: '/pubapi/v1/userinfo' });

        expect(callHeaders[0].Authorization).toBe('Bearer tok');
        expect(paths[0]).toBe('/pubapi/v1/userinfo');
    });

    it('sends X-Egnyte-Ai-Safeguards-Enabled on AI endpoint requests', async function() {
        queuedResponses.push(
            { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }
        );

        await apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'POST',
            apiPath: '/pubapi/v1/ai/assistant/ask',
            body: { question: 'q' },
            bodyType: 'json',
        });

        expect(callHeaders[0]['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
    });

    it('sends X-Egnyte-Ai-Safeguards-Enabled on standard search requests', async function() {
        queuedResponses.push(
            { status: 200, body: '{"results":[]}', headers: { 'content-type': 'application/json' } }
        );

        await apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'GET',
            apiPath: '/pubapi/v1/search',
            query: { query: 'report' },
        });

        expect(callHeaders[0]['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
    });

    it('does not send the AI Safeguards header on non-AI requests', async function() {
        queuedResponses.push(
            { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }
        );

        await apiRequest({
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'GET',
            apiPath: '/pubapi/v1/userinfo',
        });

        expect(callHeaders[0]['X-Egnyte-Ai-Safeguards-Enabled']).toBeUndefined();
    });

    it('sends X-Egnyte-Ai-Safeguards-Enabled on file content downloads (apiDownload)', async function() {
        // apiDownload pipes the response to disk, so the mocked response must be
        // a real Readable stream — override the shared https.request stub locally
        // (afterEach restores the original).
        const outPath = path.join(os.tmpdir(), 'safeguards-download-' + Date.now() + '.bin');
        let capturedHeaders;

        https.request = function(options, callback) {
            capturedHeaders = options.headers;
            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.end = function() {
                const res = new Readable({ read: function() {} });
                res.statusCode = 200;
                res.headers = { 'content-length': '5' };
                callback(res);
                res.push(Buffer.from('hello'));
                res.push(null);
            };
            return req;
        };

        try {
            await apiDownload({
                domain: 'https://testdomain.egnyte.com',
                token: 'token',
                apiPath: '/pubapi/v1/fs-content/Shared/report.pdf',
            }, outPath, false);

            expect(capturedHeaders['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
            expect(fs.readFileSync(outPath).toString()).toBe('hello');
        } finally {
            try { fs.unlinkSync(outPath); } catch (_) {}
        }
    });

    describe('HTTP proxy support', function() {
        const requestOptions = {
            domain: 'https://testdomain.egnyte.com',
            token: 'token',
            method: 'GET',
            apiPath: '/pubapi/v1/userinfo',
        };

        async function proxyAgent() {
            queuedResponses.push({ status: 200, body: '{}', headers: { 'content-type': 'application/json' } });
            await apiRequest(requestOptions);
            return callOptions[0].agent;
        }

        it('leaves requests direct when no proxy is configured', async function() {
            expect(await proxyAgent()).toBeUndefined();
        });

        it('opens an authenticated CONNECT tunnel and starts TLS to the destination', async function() {
            process.env.HTTPS_PROXY = 'http://user:p%40ss@proxy.example:8080';
            const agent = await proxyAgent();
            expect(agent).toEqual(jasmine.any(https.Agent));
            expect(callOptions[0].hostname).toBe('testdomain.egnyte.com');
            expect(callOptions[0].port).toBe(443);
            expect(callHeaders[0]['Proxy-Authorization']).toBeUndefined();

            const socket = new EventEmitter();
            socket.destroy = jasmine.createSpy('socketDestroy');
            socket.unshift = jasmine.createSpy('socketUnshift');
            const secureSocket = new EventEmitter();
            const connectRequest = new EventEmitter();
            connectRequest.setTimeout = function() {};
            connectRequest.end = function() {
                connectRequest.emit('connect', { statusCode: 200 }, socket, Buffer.alloc(0));
            };

            let connectOptions;
            spyOn(http, 'request').and.callFake(function(options) {
                connectOptions = options;
                return connectRequest;
            });
            spyOn(tls, 'connect').and.returnValue(secureSocket);

            let callbackArgs;
            agent.createConnection({ host: 'testdomain.egnyte.com', port: 443 }, function() {
                callbackArgs = Array.prototype.slice.call(arguments);
            });

            expect(connectOptions.method).toBe('CONNECT');
            expect(connectOptions.hostname).toBe('proxy.example');
            expect(connectOptions.port).toBe(8080);
            expect(connectOptions.path).toBe('testdomain.egnyte.com:443');
            expect(connectOptions.headers.Host).toBe('testdomain.egnyte.com:443');
            expect(connectOptions.headers['Proxy-Authorization']).toBe(
                'Basic ' + Buffer.from('user:p@ss').toString('base64')
            );
            expect(tls.connect.calls.mostRecent().args[0].socket).toBe(socket);
            expect(tls.connect.calls.mostRecent().args[0].servername).toBe('testdomain.egnyte.com');
            expect(callbackArgs[0]).toBeNull();
            expect(callbackArgs[1]).toBe(secureSocket);
        });

        it('surfaces a proxy CONNECT rejection without starting TLS', async function() {
            process.env.HTTPS_PROXY = 'http://proxy.example:8080';
            const agent = await proxyAgent();
            const socket = new EventEmitter();
            socket.destroy = jasmine.createSpy('socketDestroy');
            const connectRequest = new EventEmitter();
            connectRequest.setTimeout = function() {};
            connectRequest.end = function() {
                connectRequest.emit('connect', { statusCode: 407 }, socket, Buffer.alloc(0));
            };
            spyOn(http, 'request').and.returnValue(connectRequest);
            spyOn(tls, 'connect');

            let connectionError;
            agent.createConnection({ host: 'testdomain.egnyte.com', port: 443 }, function(err) {
                connectionError = err;
            });

            expect(connectionError.message).toBe('Proxy CONNECT failed with HTTP 407');
            expect(socket.destroy).toHaveBeenCalled();
            expect(tls.connect).not.toHaveBeenCalled();
        });

        it('uses HTTP_PROXY as a fallback for OAuth token requests', async function() {
            process.env.HTTP_PROXY = 'proxy.example:8080';
            queuedResponses.push({
                status: 200,
                body: '{"access_token":"oauth-token"}',
                headers: { 'content-type': 'application/json' },
            });

            const result = await httpPost(
                'https://testdomain.egnyte.com/puboauth/token',
                'grant_type=refresh_token',
                'application/x-www-form-urlencoded'
            );

            expect(result.access_token).toBe('oauth-token');
            expect(callOptions[0].agent).toEqual(jasmine.any(https.Agent));
            expect(callOptions[0].port).toBe(443);
        });

        it('honors NO_PROXY hostname suffixes and ports', async function() {
            process.env.HTTPS_PROXY = 'http://proxy.example:8080';
            process.env.NO_PROXY = 'other.example, .egnyte.com:443';
            expect(await proxyAgent()).toBeUndefined();
        });

        it('rejects unsupported proxy protocols before sending a request', async function() {
            process.env.HTTPS_PROXY = 'socks5://proxy.example:1080';
            await expectAsync(apiRequest(requestOptions)).toBeRejectedWithError(
                CLIError,
                'Unsupported proxy protocol. Use an HTTP proxy URL: http://host[:port].'
            );
            expect(callOptions.length).toBe(0);
        });
    });

    describe('429 handling', function() {
        const NOW = Date.UTC(2026, 9, 15, 9, 0, 16);
        const JSON_HEADERS = { 'content-type': 'application/json' };
        const request = function(overrides) {
            return apiRequest(Object.assign({
                domain: 'https://testdomain.egnyte.com',
                token: 'token',
                method: 'POST',
                apiPath: '/pubapi/v1/fs-content/Shared/report.txt',
            }, overrides));
        };

        beforeEach(function() {
            spyOn(Date, 'now').and.returnValue(NOW);
        });

        it('waits out a Retry-After of 60 s or less and reports each wait on stderr', async function() {
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '60' } },
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '5' } },
                { status: 200, body: '{"ok":true}', headers: JSON_HEADERS }
            );

            expect(await request()).toEqual({ ok: true });
            expect(delays).toEqual([60000, 5000]);
            expect(stderrOutput).toEqual([
                '[retry] HTTP 429, waiting 60s (1/3)\n',
                '[retry] HTTP 429, waiting 5s (2/3)\n',
            ]);
        });

        it('fails at once, without waiting, on a Retry-After over 60 s', async function() {
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '53984' } }
            );

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                name: 'CLIError',
                message: 'HTTP 429: rate limited, retry after 2026-10-16T00:00:00Z',
                statusCode: 429,
                retryAfter: 53984,
                retryAt: '2026-10-16T00:00:00Z',
            }));
            expect(callMethods).toEqual(['POST']);
            expect(delays).toEqual([]);
            expect(stderrOutput).toEqual([]);
        });

        it('reports each wait as a newline-delimited JSON event with --json-progress', async function() {
            setJsonProgress(true);
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '5' } },
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}' },
                { status: 200, body: '{"ok":true}', headers: JSON_HEADERS }
            );

            expect(await request()).toEqual({ ok: true });
            expect(stderrOutput.map(function(line) { return JSON.parse(line); })).toEqual([
                { type: 'retry', status: 429, wait: 5, attempt: 1, max: 3 },
                { type: 'retry', status: 429, wait: 2, attempt: 2, max: 3 },
            ]);
            expect(stderrOutput.every(function(line) { return /\n$/.test(line); })).toBe(true);
        });

        it('keeps the 429 CLIError, without retryAt, when the Retry-After is beyond the Date range', async function() {
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '8640000000000' } }
            );

            let error;
            try { await request(); } catch (err) { error = err; }

            expect(error instanceof CLIError).toBe(true);
            expect(error.statusCode).toBe(429);
            expect(error.retryAfter).toBe(8640000000000);
            expect(error.retryAt).toBeUndefined();
            expect(error.message).toBe('HTTP 429: rate limited, retry after 8640000000000s');
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
        });

        it('falls back to 1 s, 2 s, 4 s backoff when Retry-After is missing, reporting each wait', async function() {
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}' },
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}' },
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}' },
                { status: 200, body: '{"ok":true}', headers: JSON_HEADERS }
            );

            expect(await request()).toEqual({ ok: true });
            expect(delays).toEqual([1000, 2000, 4000]);
            expect(stderrOutput).toEqual([
                '[retry] HTTP 429, waiting 1s (1/3)\n',
                '[retry] HTTP 429, waiting 2s (2/3)\n',
                '[retry] HTTP 429, waiting 4s (3/3)\n',
            ]);
        });

        it('gives up after 3 retries with the plain 429 error and no retry fields when Retry-After is missing', async function() {
            for (let i = 0; i < 4; i++) queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}' });

            let error;
            try { await request(); } catch (err) { error = err; }

            expect(error.message).toBe('HTTP 429: Developer Over Rate');
            expect(error.statusCode).toBe(429);
            expect(error.retryAfter).toBeUndefined();
            expect(error.retryAt).toBeUndefined();
            expect(callMethods.length).toBe(4);
        });

        it('keeps the short Retry-After on the error when the retries run out', async function() {
            for (let i = 0; i < 4; i++) {
                queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '20' } });
            }

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                message: 'HTTP 429: Developer Over Rate',
                retryAfter: 20,
                retryAt: '2026-10-15T09:00:36Z',
            }));
            expect(delays).toEqual([20000, 20000, 20000]);
        });

        it('waits a Retry-After over 60 s when --max-retry-wait allows it', async function() {
            setMaxRetryWait(300);
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '120' } },
                { status: 200, body: '{"ok":true}', headers: JSON_HEADERS }
            );

            expect(await request()).toEqual({ ok: true });
            expect(delays).toEqual([120000]);
            expect(stderrOutput).toEqual(['[retry] HTTP 429, waiting 120s (1/3)\n']);
        });

        it('still fails at once when the Retry-After is over a raised --max-retry-wait', async function() {
            setMaxRetryWait(300);
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '301' } }
            );

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({ statusCode: 429, retryAfter: 301 }));
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
        });

        it('never waits with --max-retry-wait 0', async function() {
            setMaxRetryWait(0);
            queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}' });

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                message: 'HTTP 429: Developer Over Rate',
                statusCode: 429,
            }));
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
            expect(stderrOutput).toEqual([]);
        });

        it('keeps the plain 429 message for a short Retry-After with --max-retry-wait 0', async function() {
            setMaxRetryWait(0);
            queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '1' } });

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                message: 'HTTP 429: Developer Over Rate',
                statusCode: 429,
                retryAfter: 1,
                retryAt: '2026-10-15T09:00:17Z',
            }));
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
        });

        it('still uses the retry-after message for a Retry-After over 60 s with a lowered --max-retry-wait', async function() {
            setMaxRetryWait(5);
            queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '120' } });

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                message: 'HTTP 429: rate limited, retry after 2026-10-15T09:02:16Z',
            }));
        });

        it('includes _ratelimit in the 429 error with --verbose', async function() {
            setVerbose(true);
            queuedResponses.push({
                status: 429,
                body: '{"errorMessage":"Developer Over Rate"}',
                headers: {
                    'retry-after': '53984',
                    'x-accesstoken-qps-allotted': '2',
                    'x-accesstoken-qps-current': '2',
                    'x-accesstoken-quota-allotted': '1000',
                    'x-accesstoken-quota-current': '1000',
                },
            });

            await expectAsync(request()).toBeRejectedWith(jasmine.objectContaining({
                statusCode: 429,
                rateLimit: {
                    qps_limit: 2, qps_used: 2, qps_remaining: 0,
                    quota_limit: 1000, quota_used: 1000, retry_after: 53984,
                },
            }));
        });

        it('leaves _ratelimit off the 429 error without --verbose', async function() {
            queuedResponses.push({
                status: 429,
                body: '{"errorMessage":"Developer Over Rate"}',
                headers: { 'retry-after': '53984', 'x-accesstoken-quota-current': '1000' },
            });

            let error;
            try { await request(); } catch (err) { error = err; }

            expect(error.rateLimit).toBeUndefined();
        });
    });

    describe('httpRequest (raw requests such as upload chunks)', function() {
        const NOW = Date.UTC(2026, 9, 15, 9, 0, 16);
        const options = { hostname: 'testdomain.egnyte.com', path: '/pubapi/v1/fs-content-chunked/Shared/big.bin', method: 'POST', headers: {} };
        const chunk = Buffer.from('chunk');

        beforeEach(function() {
            spyOn(Date, 'now').and.returnValue(NOW);
        });

        it('waits out a short 429, announces it on stderr and returns the next response', async function() {
            queuedResponses.push(
                { status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '5' } },
                { status: 200, body: '{"ok":true}', headers: { 'x-egnyte-upload-id': 'upl-1' } }
            );

            const resp = await httpRequest(options, chunk, 1000);

            expect(resp.status).toBe(200);
            expect(resp.headers['x-egnyte-upload-id']).toBe('upl-1');
            expect(callMethods).toEqual(['POST', 'POST']);
            expect(delays).toEqual([5000]);
            expect(stderrOutput).toEqual(['[retry] HTTP 429, waiting 5s (1/3)\n']);
        });

        it('gives up after 3 retries with the 429 CLIError', async function() {
            for (let i = 0; i < 4; i++) {
                queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '2' } });
            }

            await expectAsync(httpRequest(options, chunk)).toBeRejectedWith(jasmine.objectContaining({
                name: 'CLIError',
                message: 'HTTP 429: Developer Over Rate',
                statusCode: 429,
                retryAfter: 2,
                retryAt: '2026-10-15T09:00:18Z',
            }));
            expect(callMethods.length).toBe(4);
            expect(delays).toEqual([2000, 2000, 2000]);
        });

        it('fails at once, without waiting, on a Retry-After over 60 s', async function() {
            queuedResponses.push({ status: 429, body: '{"errorMessage":"Developer Over Rate"}', headers: { 'retry-after': '53984' } });

            await expectAsync(httpRequest(options, chunk)).toBeRejectedWith(jasmine.objectContaining({
                message: 'HTTP 429: rate limited, retry after 2026-10-16T00:00:00Z',
                statusCode: 429,
                retryAfter: 53984,
            }));
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
            expect(stderrOutput).toEqual([]);
        });

        it('returns other error statuses untouched for the caller to handle', async function() {
            queuedResponses.push({ status: 500, body: '{"errorMessage":"boom"}' });

            const resp = await httpRequest(options, chunk);

            expect(resp.status).toBe(500);
            expect(callMethods.length).toBe(1);
            expect(delays).toEqual([]);
        });
    });

    describe('resolveMaxRetryWait', function() {
        it('defaults to 60 seconds', function() {
            expect(resolveMaxRetryWait({}, {})).toBe(60);
        });

        it('reads EGNYTE_MAX_RETRY_WAIT', function() {
            expect(resolveMaxRetryWait({}, { EGNYTE_MAX_RETRY_WAIT: '300' })).toBe(300);
        });

        it('prefers --max-retry-wait over the environment', function() {
            expect(resolveMaxRetryWait({ 'max-retry-wait': '5' }, { EGNYTE_MAX_RETRY_WAIT: '300' })).toBe(5);
        });

        it('accepts 0 as "never wait"', function() {
            expect(resolveMaxRetryWait({ 'max-retry-wait': '0' }, {})).toBe(0);
        });

        it('ignores an empty EGNYTE_MAX_RETRY_WAIT', function() {
            expect(resolveMaxRetryWait({}, { EGNYTE_MAX_RETRY_WAIT: '' })).toBe(60);
        });

        it('accepts the 86400 s upper bound', function() {
            expect(resolveMaxRetryWait({ 'max-retry-wait': '86400' }, {})).toBe(86400);
        });

        [['--max-retry-wait', { 'max-retry-wait': 'abc' }, {}],
         ['--max-retry-wait', { 'max-retry-wait': true }, {}],
         ['--max-retry-wait', { 'max-retry-wait': '1.5' }, {}],
         ['--max-retry-wait', { 'max-retry-wait': '86401' }, {}],
         ['--max-retry-wait', { 'max-retry-wait': '9999999' }, {}],
         ['EGNYTE_MAX_RETRY_WAIT', {}, { EGNYTE_MAX_RETRY_WAIT: '-1' }],
         ['EGNYTE_MAX_RETRY_WAIT', {}, { EGNYTE_MAX_RETRY_WAIT: '86401' }],
        ].forEach(function(c) {
            it('rejects an invalid value from ' + c[0], function() {
                expect(function() { resolveMaxRetryWait(c[1], c[2]); })
                    .toThrowError(CLIError, 'Invalid ' + c[0] + ': expected whole seconds from 0 to 86400 (0 = never wait), got ' +
                        String(c[1]['max-retry-wait'] !== undefined ? c[1]['max-retry-wait'] : c[2].EGNYTE_MAX_RETRY_WAIT));
            });
        });
    });
});
