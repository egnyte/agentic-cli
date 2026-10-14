'use strict';

// Exercise module loading without accessing the real OS credential store.
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const loaderSource = fs.readFileSync(
    path.join(__dirname, '../src/lib/desktop-keychain.js'), 'utf8'
);

function loadKeychain(env, loadModule, pkg) {
    const sandbox = {
        module: { exports: {} },
        process: { env: env, pkg: pkg },
        require: function(name) {
            if (name === './output') return require('../src/lib/output');
            return loadModule(name);
        },
    };
    vm.runInNewContext(loaderSource, sandbox, { filename: 'desktop-keychain.js' });
    return sandbox.module.exports;
}

describe('desktop keychain module loading', function() {
    it('keeps a literal production require so pkg can discover the addon', function() {
        expect(loaderSource).toMatch(/\brequire\(\s*['"]@egnyte\/keyring['"]\s*\)/);
    });

    it('loads the default addon when no override is configured', function() {
        const addon = { getEgnyteToken: function() {} };
        const loadModule = jasmine.createSpy('loadModule').and.returnValue(addon);

        expect(loadKeychain({}, loadModule)._keychain).toBe(addon);
        expect(loadModule).toHaveBeenCalledOnceWith('@egnyte/keyring');
    });

    it('treats an empty override as the default addon', function() {
        const addon = { getEgnyteToken: function() {} };
        const loadModule = jasmine.createSpy('loadModule').and.returnValue(addon);

        expect(loadKeychain({ EGNYTE_KEYCHAIN_MODULE: '' }, loadModule)._keychain).toBe(addon);
        expect(loadModule).toHaveBeenCalledOnceWith('@egnyte/keyring');
    });

    it('loads only the override when configured', function() {
        const addon = { getEgnyteToken: function() {} };
        const loadModule = jasmine.createSpy('loadModule').and.returnValue(addon);
        const override = '/test/mock-keychain.js';

        expect(loadKeychain({ EGNYTE_KEYCHAIN_MODULE: override }, loadModule)._keychain).toBe(addon);
        expect(loadModule).toHaveBeenCalledOnceWith(override);
    });

    it('ignores the override inside a packaged binary', function() {
        const addon = { getEgnyteToken: function() {} };
        const loadModule = jasmine.createSpy('loadModule').and.returnValue(addon);
        const override = '/test/mock-keychain.js';
        const pkg = { entrypoint: '/snapshot/agentic-cli/bin/egnyte.js' };

        expect(loadKeychain({ EGNYTE_KEYCHAIN_MODULE: override }, loadModule, pkg)._keychain).toBe(addon);
        expect(loadModule).toHaveBeenCalledOnceWith('@egnyte/keyring');
    });

    it('does not fall back to an override when the addon is absent in a packaged binary', function() {
        const loadModule = jasmine.createSpy('loadModule').and.throwError('Module not found');
        const override = '/test/mock-keychain.js';
        const pkg = { entrypoint: '/snapshot/agentic-cli/bin/egnyte.js' };

        expect(loadKeychain({ EGNYTE_KEYCHAIN_MODULE: override }, loadModule, pkg)._keychain).toBeNull();
        expect(loadModule).toHaveBeenCalledOnceWith('@egnyte/keyring');
    });

    it('allows the CLI to load when the default addon is absent', async function() {
        const loadModule = jasmine.createSpy('loadModule').and.callFake(function() {
            const err = new Error('Module not found');
            err.code = 'MODULE_NOT_FOUND';
            throw err;
        });
        const loaded = loadKeychain({}, loadModule);

        expect(loaded._keychain).toBeNull();
        expect(loadModule).toHaveBeenCalledOnceWith('@egnyte/keyring');
        await expectAsync(loaded.resolveDesktopAppToken({ desktopCtx: {} }))
            .toBeRejectedWithError('@egnyte/keyring is not installed - desktop_app profiles are not supported here.');
    });

    it('allows the CLI to load when the native addon cannot be loaded', function() {
        const loadModule = jasmine.createSpy('loadModule').and.throwError('No native build was found');

        expect(loadKeychain({}, loadModule)._keychain).toBeNull();
    });

    it('does not fall back to the real addon when an override fails', function() {
        const loadModule = jasmine.createSpy('loadModule').and.throwError('Module not found');
        const override = '/test/missing-keychain.js';

        expect(loadKeychain({ EGNYTE_KEYCHAIN_MODULE: override }, loadModule)._keychain).toBeNull();
        expect(loadModule).toHaveBeenCalledOnceWith(override);
    });
});

describe('keyring distribution', function() {
    it('does not declare the internal addon as an npm dependency of the CLI', function() {
        const manifest = require('../package.json');
        ['dependencies', 'optionalDependencies', 'devDependencies'].forEach(function(field) {
            expect((manifest[field] || {})['@egnyte/keyring']).toBeUndefined();
        });
    });

    it('leaves keyring version pinning to the binary build, not the CLI lockfile', function() {
        const lock = require('../package-lock.json');
        expect(lock.packages['node_modules/@egnyte/keyring']).toBeUndefined();
        ['dependencies', 'optionalDependencies', 'devDependencies'].forEach(function(field) {
            expect((lock.packages[''][field] || {})['@egnyte/keyring']).toBeUndefined();
        });
    });
});