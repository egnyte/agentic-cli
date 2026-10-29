'use strict';

// Offline tests for the intentional API version splits (PINT-22523).
// https.request is stubbed, so no network and no credentials are needed.
// Checked on a live domain: GET v2 perms rejects /Shared (HTTP 400), so reads stay on v1.

const EventEmitter = require('events');
const https = require('https');

const { cmdPermsGetUser, cmdPermsGetGroup, cmdPermsSetUser } = require('../src/commands/perms');
const { cmdTrashList, cmdTrashRestore } = require('../src/commands/trash');
const { cmdProjectsCreate } = require('../src/commands/projects');
const { SCHEMA } = require('../src/lib/schema-registry');

describe('API version per operation', function() {
    let originalRequest;
    let originalWrite;
    let requests;

    beforeEach(function() {
        originalRequest = https.request;
        originalWrite = process.stdout.write;
        requests = [];

        process.stdout.write = function() { return true; };
        https.request = function(options, callback) {
            const sent = { method: options.method, path: options.path.split('?')[0], body: '' };
            requests.push(sent);
            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.write = function(chunk) { sent.body += chunk.toString(); };
            req.destroy = function(err) { this.emit('error', err); };
            req.end = function() {
                const res = new EventEmitter();
                res.statusCode = 200;
                res.headers = { 'content-type': 'application/json' };
                callback(res);
                res.emit('data', Buffer.from('{}'));
                res.emit('end');
            };
            return req;
        };
    });

    afterEach(function() {
        https.request = originalRequest;
        process.stdout.write = originalWrite;
    });

    function args(positional, json) {
        return { _: positional, token: 't', domain: 'https://example.egnyte.com', json: json, yes: true };
    }

    it('reads permissions on GET v1 and writes them on POST v2', async function() {
        await cmdPermsGetUser(args(['perms', 'get-user', '/Shared']));
        await cmdPermsGetGroup(args(['perms', 'get-group', '/Shared/Finance']));
        await cmdPermsSetUser(args(['perms', 'set-user', '/Shared/Finance'], '{"users":{"jsmith":"Viewer"}}'));
        expect(requests.map(function(r) { return r.method + ' ' + r.path; })).toEqual([
            'GET /pubapi/v1/perms/folder/Shared',
            'GET /pubapi/v1/perms/folder/Shared/Finance',
            'POST /pubapi/v2/perms/Shared/Finance',
        ]);
    });

    it('lists trash on GET v2 and restores on POST v1 with the action', async function() {
        await cmdTrashList(args(['trash', 'list']));
        await cmdTrashRestore(args(['trash', 'restore'], '{"ids":["id1"]}'));
        expect(requests[0].method + ' ' + requests[0].path).toBe('GET /pubapi/v2/fs/trash');
        expect(requests[1].method + ' ' + requests[1].path).toBe('POST /pubapi/v1/fs/trash');
        expect(JSON.parse(requests[1].body).action).toBe('RESTORE');
    });

    it('creates projects on POST v1 without templateFolderId and on POST v2 with it', async function() {
        await cmdProjectsCreate(args(['projects', 'create'], '{"name":"A","status":"pending","rootFolderId":"f1"}'));
        await cmdProjectsCreate(args(['projects', 'create'],
            '{"name":"B","status":"pending","templateFolderId":"t1","parentFolderId":"p1"}'));
        expect(requests.map(function(r) { return r.path; })).toEqual([
            '/pubapi/v1/project-folders',
            '/pubapi/v2/project-folders',
        ]);
    });

    it('explains each split in the schema notes', function() {
        ['perms.get-user', 'perms.get-group', 'trash.restore', 'trash.delete', 'projects.create'].forEach(function(op) {
            expect(SCHEMA[op].notes).toMatch(/v1/);
            expect(SCHEMA[op].notes).toMatch(/v2/);
        });
    });
});
