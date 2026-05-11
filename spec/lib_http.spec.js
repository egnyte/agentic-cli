'use strict';

const EventEmitter = require('events');
const https = require('https');

const { apiRequest } = require('../src/lib/http');
const { CLIError } = require('../src/lib/output');

describe('http helpers', function() {
    let originalRequest;
    let originalSetTimeout;
    let originalMathRandom;
    let queuedResponses;
    let callMethods;

    beforeEach(function() {
        originalRequest = https.request;
        originalSetTimeout = global.setTimeout;
        originalMathRandom = Math.random;
        queuedResponses = [];
        callMethods = [];

        Math.random = function() { return 0; };
        global.setTimeout = function(fn) {
            fn();
            return 0;
        };

        https.request = function(options, callback) {
            callMethods.push(options.method);

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
});
