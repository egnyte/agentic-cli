// Integration tests for egnyte groups commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// Create/update/delete use --dry-run to avoid modifying real groups.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte groups", function() {


    var OPTS = { token: APIToken, domain: egnyteDomain };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── groups list ─────────────────────────────────────────────────────────────

    describe("groups list", function() {
        it("lists groups and exits 0", function() {
            var result = spawnCLI(["groups", "list", "--json", '{"count":5}'], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains Resources or totalResults", function() {
            var result = spawnCLI(["groups", "list", "--json", '{"count":5}'], OPTS);
            var json = result.json();
            expect(json).not.toBeNull();
            var hasGroups = json.Resources || json.totalResults !== undefined || Array.isArray(json);
            expect(hasGroups).toBeTruthy();
        });
    });

    // ── groups get ──────────────────────────────────────────────────────────────

    describe("groups get", function() {
        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["groups", "get"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 with JSON error for a non-existent group ID", function() {
            var result = spawnCLI(["groups", "get", "nonexistent-group-id-99999"], OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
        });
    });

    // ── groups create (dry-run only) ────────────────────────────────────────────

    describe("groups create --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var result = spawnCLI(["groups", "create", "--json",
                '{"displayName":"TestGroup-DryRun"}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v2/groups");
            expect(result.stdout).toContain("Authorization: ***");
        });

        it("exits 1 when displayName is missing", function() {
            var result = spawnCLI(["groups", "create", "--json",
                '{"members":[]}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/displayName/);
        });
    });

    // ── groups update (dry-run only) ────────────────────────────────────────────

    describe("groups update --dry-run", function() {
        it("prints curl PATCH without making API call", function() {
            var result = spawnCLI(["groups", "update", "group-123",
                "--json", '{"displayName":"Renamed"}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X PATCH");
            expect(result.stdout).toContain("/pubapi/v2/groups/group-123");
        });

        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["groups", "update",
                "--json", '{"displayName":"x"}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── groups delete (dry-run only) ────────────────────────────────────────────

    describe("groups delete --dry-run", function() {
        it("prints curl DELETE without making API call", function() {
            var result = spawnCLI(["groups", "delete", "group-123", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v2/groups/group-123");
        });

        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["groups", "delete"], OPTS);
            expect(result.status).toBe(1);
        });
    });

});
