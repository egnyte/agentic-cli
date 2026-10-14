'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { apiDownload } = require('../src/lib/http');

describe('resumable downloads (offline)', function() {
    const content = Buffer.from('resume download test content');
    const prefix = content.slice(0, Math.floor(content.length / 2));
    const options = { domain: 'https://testdomain.egnyte.com', apiPath: '/pubapi/v1/fs-content/Shared/resume.txt' };
    let directory, outPath, requestHeaders, response, queuedResponses, requestError, delays;

    beforeEach(function() {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'egnyte-download-spec-'));
        outPath = path.join(directory, 'download.txt');
        response = { status: 200, body: content };
        queuedResponses = [];
        requestError = null;
        delays = [];
        spyOn(global, 'setTimeout').and.callFake(function(fn, ms) {
            delays.push(ms);
            fn();
            return 0;
        });
        spyOn(https, 'request').and.callFake(function(opts, callback) {
            requestHeaders = opts.headers;
            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.end = function() {
                if (requestError) {
                    req.emit('error', requestError);
                    return;
                }
                const current = queuedResponses.length ? queuedResponses.shift() : response;
                const res = new Readable({ read: function() {} });
                res.statusCode = current.status;
                res.headers = Object.assign({ 'content-length': String(current.body.length) }, current.headers);
                callback(res);
                res.push(current.body);
                res.push(null);
            };
            return req;
        });
    });

    afterEach(function() {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        fs.rmdirSync(directory);
    });

    it('downloads the whole file without Range when no local file exists', async function() {
        await apiDownload(options, outPath, true);
        expect(requestHeaders.Range).toBeUndefined();
        expect(requestHeaders['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
        expect(fs.readFileSync(outPath)).toEqual(content);
    });

    it('sends the local byte offset and appends a 206 response exactly once', async function() {
        fs.writeFileSync(outPath, prefix);
        response = {
            status: 206,
            body: content.slice(prefix.length),
            headers: { 'content-range': 'bytes ' + prefix.length + '-' + (content.length - 1) + '/' + content.length },
        };
        await apiDownload(options, outPath, true);
        expect(requestHeaders.Range).toBe('bytes=' + prefix.length + '-');
        expect(fs.readFileSync(outPath)).toEqual(content);
        expect(https.request.calls.count()).toBe(1);
    });

    it('overwrites rather than appends when the server ignores Range and returns 200', async function() {
        fs.writeFileSync(outPath, prefix);
        await apiDownload(options, outPath, true);
        expect(requestHeaders.Range).toBe('bytes=' + prefix.length + '-');
        expect(fs.readFileSync(outPath)).toEqual(content);
    });

    it('leaves an already-complete file unchanged on 416', async function() {
        fs.writeFileSync(outPath, content);
        response = { status: 416, body: Buffer.alloc(0), headers: { 'content-range': 'bytes */' + content.length } };
        await apiDownload(options, outPath, true);
        expect(requestHeaders.Range).toBe('bytes=' + content.length + '-');
        expect(fs.readFileSync(outPath)).toEqual(content);
    });

    it('preserves the partial file and HTTP diagnostics on 403', async function() {
        fs.writeFileSync(outPath, prefix);
        response = { status: 403, body: Buffer.from('{"message":"download refused"}') };
        await expectAsync(apiDownload(options, outPath, true)).toBeRejectedWith(
            jasmine.objectContaining({ statusCode: 403, message: 'HTTP 403: download refused' })
        );
        expect(fs.readFileSync(outPath)).toEqual(prefix);
        expect(https.request.calls.count()).toBe(1);
    });

    // Apigee answers a spike arrest with 429 and a load-shedding gateway with 503;
    // both are transient, so the resumed download has to survive them.
    [429, 503].forEach(function(status) {
        it('retries ' + status + ' and finishes the resumed download', async function() {
            fs.writeFileSync(outPath, prefix);
            queuedResponses = [
                { status: status, body: Buffer.from('{"message":"Spike arrest violation"}'), headers: { 'retry-after': '7' } },
                { status: 206, body: content.slice(prefix.length) },
            ];
            await apiDownload(options, outPath, true);
            expect(https.request.calls.count()).toBe(2);
            expect(delays).toEqual([7000]);
            expect(requestHeaders.Range).toBe('bytes=' + prefix.length + '-');
            expect(fs.readFileSync(outPath)).toEqual(content);
        });
    });

    it('gives up after four attempts with exponential backoff and preserves the partial file', async function() {
        fs.writeFileSync(outPath, prefix);
        response = { status: 429, body: Buffer.from('{"message":"Spike arrest violation"}') };
        await expectAsync(apiDownload(options, outPath, true)).toBeRejectedWith(
            jasmine.objectContaining({ statusCode: 429, message: 'HTTP 429: Spike arrest violation' })
        );
        expect(https.request.calls.count()).toBe(4);
        expect(delays).toEqual([1000, 2000, 4000]);
        expect(fs.readFileSync(outPath)).toEqual(prefix);
    });

    it('preserves the partial file and propagates a connection error', async function() {
        fs.writeFileSync(outPath, prefix);
        requestError = new Error('connection reset');
        await expectAsync(apiDownload(options, outPath, true)).toBeRejectedWith(requestError);
        expect(fs.readFileSync(outPath)).toEqual(prefix);
    });
});