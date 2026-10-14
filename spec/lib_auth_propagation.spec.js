'use strict';

// Execute command helpers through the real HTTP layer, without network/keyring access.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const https = require('https');
const EventEmitter = require('events');
const { Readable } = require('stream');
const auth = require('../src/lib/auth');
const config = require('../src/lib/config');
const { parseArgs } = require('../src/lib/args');
const { USER_AGENT } = require('../src/lib/http');

describe('command auth propagation (offline)', function() {
    const modules = ['ai', 'fs', 'request'].map(function(name) {
        return require.resolve('../src/commands/' + name);
    });
    let cached, oldConfigDir, tmp, cli, plans, requests, stdout, originalExitCode;

    beforeEach(function() {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egnyte-routing-'));
        oldConfigDir = config.CONFIG_DIR;
        config.CONFIG_DIR = tmp; // Upload manifests must never touch the user's config.
        originalExitCode = process.exitCode;
        process.exitCode = undefined;
        requests = [];
        plans = [];
        stdout = [];
        spyOn(auth, 'resolveAuth').and.resolveTo({ domain: 'https://test.egnyte.com', token: 'test-token' });
        spyOn(process.stdout, 'write').and.callFake(function(s) { stdout.push(s); return true; });
        spyOn(process.stderr, 'write').and.returnValue(true);
        spyOn(global, 'setTimeout').and.callFake(function(fn) { fn(); return 0; });
        spyOn(https, 'request').and.callFake(function(options, callback) {
            requests.push(options);
            if (!plans.length) throw new Error('Unexpected HTTP request');
            const plan = plans.shift();
            const req = new EventEmitter();
            req.setTimeout = function() {};
            req.write = function() {};
            req.end = function() {
                const res = Readable.from([Buffer.from(plan.text || JSON.stringify(plan.body || {}))]);
                res.statusCode = plan.status || 200;
                res.headers = Object.assign({ 'content-type': 'application/json' }, plan.headers);
                callback(res);
            };
            return req;
        });
        cached = modules.map(function(id) { return require.cache[id]; });
        cli = modules.map(function(id) { delete require.cache[id]; return require(id); });
    });

    afterEach(function() {
        modules.forEach(function(id, i) {
            delete require.cache[id];
            if (cached[i]) require.cache[id] = cached[i];
        });
        config.CONFIG_DIR = oldConfigDir;
        process.exitCode = originalExitCode;
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    [undefined, 'stored_profile', 'cli_flags', 'environment_variables', 'desktop_app'].forEach(function(source) {
        describe(String(source), function() {
            const prefix = source === 'desktop_app' ? '/api' : '/pubapi';
            beforeEach(function() {
                auth.resolveAuth.and.resolveTo({ domain: 'https://test.egnyte.com', token: 'test-token', auth_source: source });
            });

            function check(paths) {
                expect(requests.map(function(r) { return r.path; })).toEqual(paths.map(function(p) { return prefix + p; }));
                requests.forEach(function(r) {
                    expect(r.hostname).toBe('test.egnyte.com');
                    expect(r.headers.Authorization).toBe(source === 'desktop_app'
                        ? 'OAUTH oauth_token=test-token,oauth_version=2.0' : 'Bearer test-token');
                    expect(r.headers['User-Agent']).toBe(USER_AGENT);
                });
                expect(plans.length).toBe(0);
            }

            ['ask-document', 'summarize'].forEach(function(command) {
                it(command + ' resolves metadata then sends the AI request', async function() {
                    plans = [{ body: { entry_id: 'entry' } }, { body: { response: 'ok' } }];
                    const args = parseArgs(['ai', command, '/Shared/file.txt', 'Question?']);
                    await cli[0][command === 'summarize' ? 'cmdAiSummarize' : 'cmdAiAskDocument'](args);
                    check(['/v1/fs/Shared/file.txt', '/v1/ai/document/entry/' + (command === 'summarize' ? 'summary' : 'ask')]);
                    expect(requests[1].headers['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
                });
            });

            ['ask', 'status'].forEach(function(command) {
                it(command + ' preserves auth through polling', async function() {
                    plans = [{ body: { status: 'IN_PROGRESS' } }, { body: { status: 'COMPLETED' } }];
                    if (command === 'ask') plans.unshift({ body: { executionId: 'exec' } });
                    await cli[0][command === 'ask' ? 'cmdAiAsk' : 'cmdAiStatus'](
                        parseArgs(['ai', command, command === 'ask' ? 'Question?' : 'exec', command === 'ask' ? '--yes' : '--wait']));
                    const paths = ['/v1/ai/assistant/exec/status', '/v1/ai/assistant/exec/status'];
                    if (command === 'ask') paths.unshift('/v1/ai/assistant/ask');
                    check(paths);
                    requests.forEach(function(r) { expect(r.headers['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true'); });
                });
            });

            [false, true].forEach(function(bulk) {
                it('sets metadata after resolving the file ID (bulk=' + bulk + ')', async function() {
                    plans = [{ body: { entry_id: 'entry' } }, {}];
                    const csv = path.join(tmp, 'metadata.csv');
                    fs.writeFileSync(csv, 'path,namespace,values\n/Shared/file.txt,test,"{""status"":""signed""}"\n');
                    const flags = bulk ? ['--bulk-file-path', csv] : ['/Shared/file.txt', '--json', '{"namespace":"test","values":{"status":"signed"}}'];
                    await cli[1].cmdFsSetMetadata(parseArgs(['fs', 'set-metadata'].concat(flags, ['--yes'])));
                    check(['/v1/fs/Shared/file.txt', '/v1/fs/ids/file/entry/properties/test']);
                    expect(process.exitCode || 0).toBe(0);
                });

                [false, true].forEach(function(multipleChunks) {
                    it('uploads (multi-chunk=' + multipleChunks + ', bulk=' + bulk + ')', async function() {
                        const file = path.join(tmp, 'upload.bin');
                        fs.writeFileSync(file, 'sample');
                        if (multipleChunks) fs.truncateSync(file, 10 * 1024 * 1024 + 1);
                        const csv = path.join(tmp, 'upload.csv');
                        fs.writeFileSync(csv, 'path,file\n/Shared/file.txt,' + file + '\n');
                        plans = multipleChunks ? [{ headers: { 'x-egnyte-upload-id': 'upload' } }, {}] : [{}];
                        const flags = bulk ? ['--bulk-file-path', csv] : ['/Shared/file.txt', '--file', file];
                        await cli[1].cmdFsUploadChunked(parseArgs(['fs', 'upload-chunked'].concat(flags, ['--yes'])));
                        check(multipleChunks ? ['/v1/fs-content-chunked/Shared/file.txt', '/v1/fs-content-chunked/Shared/file.txt'] : ['/v1/fs-content/Shared/file.txt']);
                        expect(process.exitCode || 0).toBe(0);
                        if (multipleChunks) expect(requests[1].headers['x-egnyte-upload-id']).toBe('upload');
                    });
                });
            });

            it('downloads with auth and safeguards', async function() {
                plans = [{ text: 'hello' }];
                const file = path.join(tmp, 'download.txt');
                await cli[1].cmdFsDownload(parseArgs(['fs', 'download', '/Shared/file.txt', '--out', file]));
                check(['/v1/fs-content/Shared/file.txt']);
                expect(requests[0].headers['X-Egnyte-Ai-Safeguards-Enabled']).toBe('true');
                expect(fs.readFileSync(file, 'utf8')).toBe('hello');
            });

            it('preserves query parameters in raw requests', async function() {
                plans = [{}];
                await cli[2].cmdRequest(parseArgs(['request', '/pubapi/v1/search', '--json', '{"query":"some text"}']));
                check(['/v1/search?query=some%20text']);
            });

            it('dry-run has the same route/query without HTTP or credentials in output', async function() {
                await cli[2].cmdRequest(parseArgs(['request', '/pubapi/v1/search', '--json', '{"query":"some text"}', '--dry-run']));
                expect(stdout.join('')).toContain(prefix + '/v1/search?query=some%20text');
                expect(stdout.join('')).not.toContain('test-token');
                expect(requests.length).toBe(0);
            });
        });
    });
});
