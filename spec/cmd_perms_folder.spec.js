'use strict';

// Offline tests for `egnyte perms get-user` and `egnyte perms get-group` request building.
// https.request is stubbed, so no network and no credentials are needed.
// GET /v1/perms/folder/{path} takes optional pipe-separated users and groups filters.

const EventEmitter = require('events');
const https = require('https');

const { cmdPermsGetUser, cmdPermsGetGroup } = require('../src/commands/perms');
const { SCHEMA } = require('../src/lib/schema-registry');

[['get-user', cmdPermsGetUser], ['get-group', cmdPermsGetGroup]].forEach(function(c) {
    describe('perms ' + c[0] + ' request', function() {
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
                    res.emit('data', Buffer.from('{"users":[],"groups":[]}'));
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
            const args = { _: ['perms', c[0], '/Shared/Finance'], token: 't', domain: 'https://example.egnyte.com' };
            if (json !== undefined) args.json = json;
            return c[1](args);
        }

        function lastQuery() {
            const p = requestedPaths[requestedPaths.length - 1];
            return new URLSearchParams(p.split('?')[1] || '');
        }

        it('sends no filters by default', async function() {
            await run();
            expect(requestedPaths[0].split('?')[0]).toBe('/pubapi/v1/perms/folder/Shared/Finance');
            expect(lastQuery().toString()).toBe('');
        });

        it('passes users and groups filters from --json', async function() {
            await run('{"users":"jsmith|ajones","groups":"Marketing"}');
            const q = lastQuery();
            expect(q.get('users')).toBe('jsmith|ajones');
            expect(q.get('groups')).toBe('Marketing');
        });

        it('documents users and groups as optional string query params', function() {
            const params = SCHEMA['perms.' + c[0]].query_params;
            expect(params.users.type).toBe('string');
            expect(params.users.required).toBe(false);
            expect(params.groups.type).toBe('string');
            expect(params.groups.required).toBe(false);
        });
    });
});
