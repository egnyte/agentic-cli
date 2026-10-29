'use strict';

// Offline tests for `egnyte search` request building.
// https.request is stubbed, so no network and no credentials are needed.
// Expected query params come from the published OpenAPI GET /v1/search (spec sha256 9575d61d):
// no group_by_type, custom_metadata or namespaces; type FILE | FOLDER; count 1-20
// (findings b4777b3b0eb2, d3d6e39a514c; missing params f511be8c10e3, 21c350767524, 5b933f52667f).

const EventEmitter = require('events');
const https = require('https');

const { cmdSearch, cmdSearchAdvanced } = require('../src/commands/search');
const { SCHEMA } = require('../src/lib/schema-registry');

describe('search request', function() {
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
                res.emit('data', Buffer.from('{"results":[],"total_count":0}'));
                res.emit('end');
            };
            return req;
        };
    });

    afterEach(function() {
        https.request = originalRequest;
        process.stdout.write = originalWrite;
    });

    function run(cmd, json) {
        const args = { _: cmd === cmdSearch ? ['search', 'report'] : ['search', 'advanced', 'report'],
            token: 't', domain: 'https://example.egnyte.com', json: json };
        return cmd(args);
    }

    function lastQuery() {
        const p = requestedPaths[requestedPaths.length - 1];
        return new URLSearchParams(p.split('?')[1] || '');
    }

    [
        ['search', cmdSearch, '{"group_by_type":true}'],
        ['search', cmdSearch, '{"custom_metadata":{"status":"signed"}}'],
        ['search advanced', cmdSearchAdvanced, '{"group_by_type":true}'],
    ].forEach(function(c) {
        it(c[0] + ' rejects ' + c[2] + ' without sending a request', async function() {
            await expectAsync(run(c[1], c[2])).toBeRejectedWithError(/GET \/pubapi\/v1\/search ignores/);
            expect(requestedPaths.length).toBe(0);
        });
    });

    it('passes type, sort_direction, query_operator and snippet_requested through', async function() {
        await run(cmdSearch, '{"type":"FILE","sort_by":"name","sort_direction":"descending","query_operator":"ALL","snippet_requested":false}');
        const q = lastQuery();
        expect(q.get('query')).toBe('report');
        expect(q.get('type')).toBe('FILE');
        expect(q.get('sort_direction')).toBe('descending');
        expect(q.get('query_operator')).toBe('ALL');
        expect(q.get('snippet_requested')).toBe('false');
    });

    it('documents the GET /v1/search values', function() {
        const p = SCHEMA['search'].query_params;
        expect(p.group_by_type).toBeUndefined();
        expect(p.type.enum).toEqual(['FILE', 'FOLDER']);
        expect(p.sort_by.enum).toEqual(['last_modified', 'size', 'name', 'score']);
        expect(p.sort_direction.enum).toEqual(['ascending', 'descending']);
        expect(p.query_operator.enum).toEqual(['ANY', 'ALL']);
        expect(p.snippet_requested.type).toBe('boolean');
        expect(p.count.description).toContain('1–20');
    });
});
