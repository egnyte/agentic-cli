// Integration + dry-run tests for `egnyte request` — the escape-hatch command.
// Dry-run tests use dummy credentials (no network calls).
// Live tests require spec/conf/egnyte-test-config.js with valid credentials.
// Agent rule protected: Rule 6 (egnyte request for unlisted endpoints).

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte request", function() {


    var REAL_OPTS  = { token: APIToken, domain: egnyteDomain };
    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── dry-run output (no network) ──────────────────────────────────────────────

    describe("--dry-run", function() {
        it("GET prints curl GET with correct URL", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v1/userinfo", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("testdomain.egnyte.com");
            expect(result.stdout).toContain("/pubapi/v1/userinfo");
        });

        it("never leaks the bearer token in dry-run output", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v1/userinfo", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.stdout).toContain("Authorization: ***");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("GET with --json appends query string", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/users", "--dry-run",
                    "--json", '{"count":5}'],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("count");
        });

        it("POST --dry-run prints curl POST with body", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups", "-X", "POST",
                    "--json", '{"displayName":"TestGroup"}', "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("displayName");
            expect(result.stdout).toContain("/pubapi/v2/groups");
        });

        it("DELETE --dry-run prints curl DELETE", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups/42", "-X", "DELETE", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v2/groups/42");
        });
    });

    // ── argument validation (no network) ────────────────────────────────────────

    describe("argument validation", function() {
        it("exits 1 when no API path is given", function() {
            var result = spawnCLI(["request"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
        });

        it("exits 1 when path does not start with /", function() {
            var result = spawnCLI(["request", "pubapi/v1/userinfo", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("POST without --yes or --dry-run exits 1", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups", "-X", "POST",
                    "--json", '{"displayName":"X"}'],
                DUMMY_OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("DELETE without --yes exits 1", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups/99", "-X", "DELETE"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("GET does NOT require --yes", function() {
            // A GET to a non-existent dummy domain will fail on DNS, but the error
            // must NOT be about missing --yes — that would mean GET was treated as mutating.
            var result = spawnCLI(["request", "/pubapi/v1/userinfo"], DUMMY_OPTS);
            if (result.status !== 0) {
                var err = result.errorJson();
                if (err) expect(err.error).not.toMatch(/--yes/);
            }
        });
    });

    // ── live API calls ───────────────────────────────────────────────────────────

    describe("live GET calls", function() {
        it("GET /pubapi/v1/userinfo returns valid JSON", function() {
            var result = spawnCLI(["request", "/pubapi/v1/userinfo"], REAL_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json).not.toBeNull();
        });

        it("--fields restricts keys in the response", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v1/userinfo", "--fields", "username,email"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            var json = result.json();
            if (json) {
                var keys = Object.keys(json);
                keys.forEach(function(k) {
                    expect(["username", "email"]).toContain(k);
                });
            }
        });

        it("GET /pubapi/v2/users with --json count param returns valid JSON", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/users", "--json", '{"count":2}',
                    "--fields", "totalResults"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });
    });

});
