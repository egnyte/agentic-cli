'use strict';

// Offline tests for `egnyte search advanced` request building.
// https.request is stubbed, so no network and no credentials are needed.
// Expected query params come from the published OpenAPI GET /v1/search (spec sha256 9575d61d):
// custom_metadata and namespaces do not exist there (only POST /v2/search has them), and
// modified_* / uploaded_* are date-time values. Enum and type findings: 3b4475b594b5,
// 23189c8f0b0b, 14e5863806a8, 3c28e9ec5684, 7b91b496589a, 71fea5d9a871; missing params:
// b12945d97605, 5e47c0a69e5c, 2ffee2d56748.

const EventEmitter = require('events');
const https = require('https');

const { cmdSearchAdvanced } = require('../src/commands/search');
const { SCHEMA } = require('../src/lib/schema-registry');

describe('search advanced request', function() {
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

    function run(json) {
        const args = { _: ['search', 'advanced', 'contract'], token: 't', domain: 'https://example.egnyte.com' };
        if (json !== undefined) args.json = json;
        return cmdSearchAdvanced(args);
    }

    function lastQuery() {
        const p = requestedPaths[requestedPaths.length - 1];
        return new URLSearchParams(p.split('?')[1] || '');
    }

    ['custom_metadata', 'namespaces'].forEach(function(key) {
        it('rejects ' + key + ' without sending a request', async function() {
            const json = key === 'namespaces' ? '{"namespaces":["contract"]}' : '{"custom_metadata":{"status":"signed"}}';
            await expectAsync(run(json)).toBeRejectedWithError(/POST \/pubapi\/v2\/search/);
            expect(requestedPaths.length).toBe(0);
        });
    });

    it('normalizes bare uploaded_* and modified_* dates to date-time', async function() {
        await run('{"uploaded_after":"2024-01-01","uploaded_before":"2024-02-01","modified_after":"2024-03-01"}');
        const q = lastQuery();
        expect(q.get('uploaded_after')).toBe('2024-01-01T00:00:00Z');
        expect(q.get('uploaded_before')).toBe('2024-02-01T00:00:00Z');
        expect(q.get('modified_after')).toBe('2024-03-01T00:00:00Z');
    });

    it('passes sort_direction, query_operator and snippet_requested through', async function() {
        await run('{"sort_by":"name","sort_direction":"descending","query_operator":"ALL","snippet_requested":false}');
        const q = lastQuery();
        expect(q.get('sort_direction')).toBe('descending');
        expect(q.get('query_operator')).toBe('ALL');
        expect(q.get('snippet_requested')).toBe('false');
    });

    it('documents the GET /v1/search values', function() {
        const p = SCHEMA['search.advanced'].query_params;
        expect(p.type.enum).toEqual(['FILE', 'FOLDER']);
        expect(p.sort_by.enum).toEqual(['last_modified', 'size', 'name', 'score']);
        expect(p.file_query_fields.type).toBe('string');
        expect(p.file_query_fields.enum).toEqual(['ALL', 'FILENAME', 'COMMENTS', 'CONTENT']);
        expect(p.folder_query_fields.type).toBe('string');
        expect(p.folder_query_fields.enum).toEqual(['ALL', 'FOLDERNAME', 'DESCRIPTION']);
        expect(p.sort_direction.enum).toEqual(['ascending', 'descending']);
        expect(p.query_operator.enum).toEqual(['ANY', 'ALL']);
        expect(p.snippet_requested.type).toBe('boolean');
        // GET /v1/search: count minimum 1, maximum 20
        expect(p.count.description).toContain('1–20');
        expect(p.count.description).not.toContain('100');
    });
});
