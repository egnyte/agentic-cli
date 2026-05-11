// Integration tests for egnyte users commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// Read-only tests (list, get) run against real data.
// Create/update/delete use --dry-run to avoid modifying real users.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte users", function() {


    var OPTS = { token: APIToken, domain: egnyteDomain };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── users list ──────────────────────────────────────────────────────────────

    describe("users list", function() {
        it("lists users and exits 0", function() {
            var result = spawnCLI(["users", "list", "--json", '{"count":5}'], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains a Resources array or totalResults field", function() {
            var result = spawnCLI(["users", "list", "--json", '{"count":5}'], OPTS);
            var json = result.json();
            expect(json).not.toBeNull();
            var hasUsers = json.Resources || json.totalResults !== undefined || Array.isArray(json);
            expect(hasUsers).toBeTruthy();
        });

        it("--fields masks response fields", function() {
            var result = spawnCLI(["users", "list",
                "--json", '{"count":5}',
                "--fields", "userName,active"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });
    });

    // ── users get ───────────────────────────────────────────────────────────────

    describe("users get", function() {
        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["users", "get"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 with JSON error for a non-existent user ID", function() {
            var result = spawnCLI(["users", "get", "999999999"], OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeTruthy();
        });
    });

    // ── users create (dry-run only — avoid creating real users in tests) ────────

    describe("users create --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var body = JSON.stringify({
                userName: "testuser-dryrun@example.com",
                email:    { value: "testuser-dryrun@example.com" },
                active:   true,
            });
            var result = spawnCLI(["users", "create", "--json", body, "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v2/users");
            expect(result.stdout).toContain("Authorization: ***");
        });

        it("exits 1 when userName is missing", function() {
            var result = spawnCLI(["users", "create", "--json",
                '{"email":{"value":"x@x.com"}}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/userName/);
        });

        it("exits 1 when email is missing", function() {
            var result = spawnCLI(["users", "create", "--json",
                '{"userName":"x@x.com"}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/email/);
        });
    });

    // ── users update (dry-run only) ─────────────────────────────────────────────

    describe("users update --dry-run", function() {
        it("prints curl PATCH without making API call", function() {
            var result = spawnCLI(["users", "update", "123",
                "--json", '{"active":false}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X PATCH");
            expect(result.stdout).toContain("/pubapi/v2/users/123");
        });

        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["users", "update",
                "--json", '{"active":false}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── users delete (dry-run only) ─────────────────────────────────────────────

    describe("users delete --dry-run", function() {
        it("prints curl DELETE without making API call", function() {
            var result = spawnCLI(["users", "delete", "123", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v2/users/123");
        });

        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["users", "delete"], OPTS);
            expect(result.status).toBe(1);
        });
    });

});
