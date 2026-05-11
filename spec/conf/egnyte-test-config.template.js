// Configuration for integration tests.
// Copy this file to egnyte-test-config.js and fill in real values.
// egnyte-test-config.js is gitignored — never commit real credentials.
//
// egnyteDomain : full URL, e.g. "https://mycompany.egnyte.com"
// APIToken     : a valid Egnyte bearer token with Egnyte.filesystem scope
// testFolder   : base folder the tests will create/delete inside (must exist)
testConfig.egnyteTestConfig = {
    egnyteDomain: "https://YOURDOMAIN.egnyte.com",
    APIToken:     "YOUR_ACCESS_TOKEN",
    APIUsername:  "YOUR_USERNAME",
    testFolder:   "TEST_FOLDER_NAME", //Example: /Shared/CLITests
};
