// Loaded by Jasmine before all tests (see spec/support/jasmine.json).
// Initialises global testConfig, loads spec/conf/egnyte-test-config.js,
// and exports convenience globals used in every spec file.

if (typeof global !== "undefined" && typeof testConfig === "undefined") {
    global.testConfig = {};
}

try { require("../conf/egnyte-test-config"); } catch (e) { /* integration creds not present — unit tests still run */ }

if (
    typeof global !== "undefined" &&
    typeof testConfig !== "undefined" &&
    testConfig.egnyteTestConfig
) {
    global.egnyteDomain = testConfig.egnyteTestConfig.egnyteDomain;
    global.APIToken     = testConfig.egnyteTestConfig.APIToken;
    global.APIUsername  = testConfig.egnyteTestConfig.APIUsername;
    global.testFolder   = testConfig.egnyteTestConfig.testFolder;
}

// Ensure globals always exist so describe-level var declarations don't throw
// when integration creds are absent. beforeAll(pending()) prevents actual execution.
if (typeof global !== "undefined") {
    if (typeof global.egnyteDomain === "undefined") global.egnyteDomain = "";
    if (typeof global.APIToken     === "undefined") global.APIToken     = "";
    if (typeof global.APIUsername  === "undefined") global.APIUsername  = "";
    if (typeof global.testFolder   === "undefined") global.testFolder   = "";
}
