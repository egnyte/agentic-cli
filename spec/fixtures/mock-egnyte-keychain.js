'use strict';

// Stand-in for the real @egnyte/keyring native library, used via
// EGNYTE_KEYCHAIN_MODULE in subprocess tests. Skips the real Keychain/
// Credential Manager lookup entirely - always returns a fixed token.
module.exports = {
    getEgnyteToken: function(options) {
        return 'mock-keychain-token-9999';
    },
};
