'use strict';

const { CLIError } = require('./output');

// EGNYTE_KEYCHAIN_MODULE overrides which module to load in place of the real
// native library - used by tests (a fake JS module standing in for the
// native addon) under a plain Node.js checkout only. Packaged binaries
// (process.pkg) ignore it: the signed macOS CLI carries the Keychain
// access-group entitlement, so loading an arbitrary module there would let
// any process that controls the environment read existing Desktop App tokens.
let keychain = null;
try {
    // Keep the production require literal so pkg discovers the CI-supplied addon.
    const override = process.pkg ? '' : process.env.EGNYTE_KEYCHAIN_MODULE;
    keychain = override
        ? require(override)
        : require('@egnyte/keyring');
} catch (err) {
    keychain = null;
}

/**
 * Resolves the access token for a desktop_app profile via the @egnyte/keyring
 * native library (in-process - no subprocess). desktopCtx is passed through
 * opaque: {accountId, username, domain} maps directly onto the library's
 * options shape (accountId used on macOS, domain+username on Windows).
 *
 * @egnyte/keyring is supplied by the macOS/Windows binary build, not declared
 * as an npm dependency of the CLI. Its absence in npm installs or on unsupported
 * platforms is expected; other authentication methods remain available.
 */
async function resolveDesktopAppToken(profile) {
    if (!module.exports._keychain) {
        throw new CLIError('@egnyte/keyring is not installed - desktop_app profiles are not supported here.');
    }

    let token;
    try {
        token = module.exports._keychain.getEgnyteToken(profile.desktopCtx);
    } catch (err) {
        let msg = 'Keychain lookup failed: ' + (err.code ? err.code + ': ' : '') + err.message;
        // -34018 is errSecMissingEntitlement: the process lacks the Keychain access-group entitlement.
        if (/native status -34018\b/.test(err.message)) {
            msg += ' - on macOS, desktop_app profiles require the signed egnyte CLI binary.';
        }
        throw new CLIError(msg);
    }
    if (typeof token !== 'string' || token === '') {
        throw new CLIError('Keychain lookup failed: no Desktop App token returned for this profile.');
    }
    return token;
}

module.exports = { resolveDesktopAppToken, _keychain: keychain };
