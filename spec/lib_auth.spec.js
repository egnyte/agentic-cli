// Unit tests for src/lib/auth.js — localhost callback server.
// Tests startCallbackServer and waitForCallback without network or browser.

var http                = require('http');
var auth                = require('../src/lib/auth');
var startCallbackServer = auth.startCallbackServer;
var waitForCallback     = auth.waitForCallback;

describe('startCallbackServer', function() {

    it('resolves with a server and a numeric port', function(done) {
        startCallbackServer().then(function(result) {
            expect(typeof result.port).toBe('number');
            expect(result.port).toBeGreaterThan(0);
            expect(result.server).toBeDefined();
            result.server.close(done);
        }).catch(done.fail);
    });

    it('listens on 127.0.0.1', function(done) {
        startCallbackServer().then(function(result) {
            expect(result.server.address().address).toBe('127.0.0.1');
            result.server.close(done);
        }).catch(done.fail);
    });

    it('each call gets a different port', function(done) {
        Promise.all([startCallbackServer(), startCallbackServer()]).then(function(results) {
            expect(results[0].port).not.toBe(results[1].port);
            results[0].server.close();
            results[1].server.close(done);
        }).catch(done.fail);
    });

});

describe('waitForCallback', function() {

    var server, port;

    beforeEach(function(done) {
        startCallbackServer().then(function(result) {
            server = result.server;
            port   = result.port;
            done();
        }).catch(done.fail);
    });

    afterEach(function(done) {
        server.close(done);
    });

    function get(path) {
        return new Promise(function(resolve) {
            http.get('http://127.0.0.1:' + port + path, function(res) {
                var body = '';
                res.on('data', function(chunk) { body += chunk; });
                res.on('end', function() { resolve({ status: res.statusCode, body: body }); });
            });
        });
    }

    it('resolves with the code on valid callback', function(done) {
        var state = 'teststate123';
        waitForCallback(server, state).then(function(code) {
            expect(code).toBe('mycode456');
            done();
        }).catch(done.fail);
        get('/callback?code=mycode456&state=' + state);
    });

    it('rejects on state mismatch', function(done) {
        waitForCallback(server, 'expected-state').then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toContain('state mismatch');
            done();
        });
        get('/callback?code=mycode&state=wrong-state');
    });

    it('rejects when Egnyte returns an error param', function(done) {
        waitForCallback(server, 'state').then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toContain('Authorization failed');
            done();
        });
        get('/callback?error=access_denied&state=state');
    });

    it('rejects when no code in callback', function(done) {
        waitForCallback(server, 'state').then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toContain('No authorization code');
            done();
        });
        get('/callback?state=state');
    });

    it('returns 404 for non-callback paths', function(done) {
        waitForCallback(server, 'state').catch(function() {});
        get('/favicon.ico').then(function(res) {
            expect(res.status).toBe(404);
            done();
        }).catch(done.fail);
    });

    it('returns HTML with success message on valid callback', function(done) {
        var state = 'state-html';
        waitForCallback(server, state).catch(function() {});
        get('/callback?code=abc&state=' + state).then(function(res) {
            expect(res.body).toContain('Authorization complete');
            done();
        }).catch(done.fail);
    });

    it('returns HTML with failure message on error', function(done) {
        waitForCallback(server, 'state').catch(function() {});
        get('/callback?error=access_denied&state=state').then(function(res) {
            expect(res.body).toContain('Authorization failed');
            done();
        }).catch(done.fail);
    });

});
