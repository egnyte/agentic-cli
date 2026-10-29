'use strict';

// Offline tests for `egnyte users list` request building.
// https.request is stubbed, so no network and no credentials are needed.
// GET /v2/users has no sorting; sortBy and sortOrder used to be sent and silently ignored.

const EventEmitter = require('events');
const https = require('https');

const { cmdUsersList } = require('../src/commands/users');

describe('users list request', function() {
    let originalRequest;
    let originalWrite;
    let requestedPaths;

    beforeEach(function() {
        originalRequest = https.request;
        originalWrite = process.stdout.write;
        requestedPaths = [];

        process.stdout.write = function() { return true; };
        https.request = function(options, callback) {
            requestedPaths.push(options.path);
            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.write = function() {};
            req.destroy = function(err) { this.emit('error', err); };
            req.end = function() {
                const res = new EventEmitter();
                res.statusCode = 200;
                res.headers = { 'content-type': 'application/json' };
                callback(res);
                res.emit('data', Buffer.from('{"resources":[]}'));
                res.emit('end');
            };
            return req;
        };
    });

    afterEach(function() {
        https.request = originalRequest;
        process.stdout.write = originalWrite;
    });

    function run(json) {
        return cmdUsersList({ _: ['users', 'list'], token: 't', domain: 'https://example.egnyte.com', json: json });
    }

    ['sortBy', 'sortOrder'].forEach(function(key) {
        it('rejects ' + key + ' without sending a request', async function() {
            await expectAsync(run('{"' + key + '":"x"}')).toBeRejectedWithError(/GET \/pubapi\/v2\/users ignores/);
            expect(requestedPaths.length).toBe(0);
        });
    });

    it('still sends startIndex, count and filter', async function() {
        await run('{"startIndex":1,"count":10,"filter":"userName eq \\"a\\""}');
        const q = new URLSearchParams(requestedPaths[0].split('?')[1]);
        expect(q.get('count')).toBe('10');
        expect(q.get('filter')).toBe('userName eq "a"');
    });
});
