// Integration tests for egnyte search.
// Requires spec/conf/egnyte-test-config.js with valid credentials.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte search", function() {


    var OPTS = { token: APIToken, domain: egnyteDomain };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    it("returns valid JSON for a broad query", function() {
        var result = spawnCLI(["search", "test", "--json", '{"count":5}'], OPTS);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
    });

    it("response contains a results array or count field", function() {
        var result = spawnCLI(["search", "test", "--json", '{"count":5}'], OPTS);
        var json = result.json();
        expect(json).not.toBeNull();
        var hasResults = Array.isArray(json.results) || typeof json.count !== "undefined" || Array.isArray(json);
        expect(hasResults).toBe(true);
    });

    it("--fields masks result item fields", function() {
        var result = spawnCLI(["search", "test",
            "--json", '{"count":5}',
            "--fields", "name,path"], OPTS);
        expect(result.status).toBe(0);
        var json = result.json();
        if (json && Array.isArray(json.results) && json.results.length > 0) {
            var item = json.results[0];
            var keys = Object.keys(item);
            keys.forEach(function(k) {
                expect(["name", "path"]).toContain(k);
            });
        }
    });

    it("exits 1 with JSON error when query is missing", function() {
        var result = spawnCLI(["search"], OPTS);
        expect(result.status).toBe(1);
        var err = result.errorJson();
        expect(err).not.toBeNull();
        expect(err.error).toBeTruthy();
    });

    it("schema search returns full parameter reference", function() {
        var result = spawnCLI(["schema", "search"], OPTS);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
        var json = result.json();
        expect(json.query_params).toBeDefined();
        expect(json.query_params.query).toBeDefined();
    });

});

// ── search advanced ──────────────────────────────────────────────────────────

integrationDescribe("egnyte search advanced", function() {

    var OPTS      = { token: APIToken, domain: egnyteDomain };
    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    it("returns valid JSON for a broad query", function() {
        var result = spawnCLI(["search", "advanced", "test", "--json", '{"count":5}'], OPTS);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
    });

    it("accepts folder filter in --json", function() {
        var result = spawnCLI(
            ["search", "advanced", "test",
                "--json", JSON.stringify({ count: 5, folder: "/Shared" }),
                "--fields", "name,path"],
            OPTS
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
    });

    it("accepts date filter modified_after in --json", function() {
        var result = spawnCLI(
            ["search", "advanced", "report",
                "--json", JSON.stringify({ count: 5, modified_after: "2020-01-01" }),
                "--fields", "name,path"],
            OPTS
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
    });

    it("exits 1 with JSON error when query is missing", function() {
        var result = spawnCLI(["search", "advanced"], DUMMY_OPTS);
        expect(result.status).toBe(1);
        var err = result.errorJson();
        expect(err).not.toBeNull();
        expect(err.error).toBeTruthy();
    });

    it("schema search.advanced returns full parameter reference", function() {
        var result = spawnCLI(["schema", "search.advanced"], DUMMY_OPTS);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
        var json = result.json();
        expect(json.query_params).toBeDefined();
        expect(json.query_params.modified_after).toBeDefined();
        expect(json.query_params.custom_metadata).toBeDefined();
    });

});
