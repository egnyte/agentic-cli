'use strict';

const EventEmitter = require('events');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { apiRequest, apiDownload } = require('../src/lib/http');
const { CLIError } = require('../src/lib/output');

describe('http helpers', function() {
    let originalRequest;
    let originalSetTimeout;
    let originalMathRandom;
    let queuedResponses;
    let callMethods;
    let callHeaders;

    beforeEach(function() {
        originalRequest = https.request;
        originalSetTimeout = global.setTimeout;
        originalMathRandom = Math.random;
        queuedResponses = [];
        callMethods = [];
        callHeaders = [];

        Math.random = function() { return 0; };
        global.setTimeout = function(fn) {
            fn();
            return 0;
        };

        https.request = function(options, callback) {
            callMethods.push(options.method);
            callHeaders.push(options.headers);

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
});
