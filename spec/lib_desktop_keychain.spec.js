'use strict';

// Unit tests for src/lib/desktop-keychain.js. Only the native library
// (module.exports._keychain) is mocked here - everything else runs for real.

const fs   = require('fs');
const path = require('path');

const desktopKeychain = require('../src/lib/desktop-keychain');
const { resolveDesktopAppToken } = desktopKeychain;

const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'desktop-app-profile.sample.json'), 'utf8'
));
const sampleProfile = fixture.profiles[fixture.default_profile];

describe('resolveDesktopAppToken', function() {

    var originalKeychain;

    beforeEach(function() {
        originalKeychain = desktopKeychain._keychain;
    });

    afterEach(function() {
        desktopKeychain._keychain = originalKeychain;
    });

    it('calls getEgnyteToken with desktopCtx passed through opaque, and resolves the token', function(done) {
        var capturedOptions;
        desktopKeychain._keychain = {
            getEgnyteToken: function(options) {
                capturedOptions = options;
                return 'resolved-token-abc';
            },
        };

        resolveDesktopAppToken(sampleProfile).then(function(token) {
            expect(capturedOptions).toEqual(sampleProfile.desktopCtx);
            expect(token).toBe('resolved-token-abc');
            done();
        }).catch(done.fail);
    });

    it('rejects when the library throws', function(done) {
        desktopKeychain._keychain = {
            getEgnyteToken: function() {
                var err = new Error('Egnyte token lookup failed with native status -34018');
                err.code = 'ERR_EGNYTE_NATIVE_LOOKUP';
                throw err;
            },
        };

        resolveDesktopAppToken(sampleProfile).then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toContain('ERR_EGNYTE_NATIVE_LOOKUP');
            expect(err.message).toContain('native status -34018');
            expect(err.message).toContain('signed egnyte CLI binary');
            done();
        });
    });

    it('includes the library error code without the macOS hint for other failures', function(done) {
        desktopKeychain._keychain = {
            getEgnyteToken: function() {
                var err = new Error('Egnyte token not found in Credential Store');
                err.code = 'ERR_EGNYTE_CREDENTIAL_NOT_FOUND';
                throw err;
            },
        };

        resolveDesktopAppToken(sampleProfile).then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toBe('Keychain lookup failed: ERR_EGNYTE_CREDENTIAL_NOT_FOUND: Egnyte token not found in Credential Store');
            done();
        });
    });

    [null, undefined, ''].forEach(function(value) {
        it('rejects when the library returns ' + JSON.stringify(value), function(done) {
            desktopKeychain._keychain = {
                getEgnyteToken: function() { return value; },
            };

            resolveDesktopAppToken(sampleProfile).then(function() {
                done.fail('should have rejected');
            }).catch(function(err) {
                expect(err.message).toContain('no Desktop App token returned');
                done();
            });
        });
    });

    it('rejects clearly when the library is not installed', function(done) {
        desktopKeychain._keychain = null;

        resolveDesktopAppToken(sampleProfile).then(function() {
            done.fail('should have rejected');
        }).catch(function(err) {
            expect(err.message).toContain('@egnyte/keyring is not installed');
            done();
        });
    });

});
