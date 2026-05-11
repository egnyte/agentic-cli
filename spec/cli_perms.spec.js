// Integration tests for egnyte perms commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// get-user / get-group run against real folders.
// set / delete use --dry-run to avoid modifying real permissions.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte perms", function() {


    var OPTS = { token: APIToken, domain: egnyteDomain };
    var currentUsername = APIUsername;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── perms get-user ──────────────────────────────────────────────────────────

    describe("perms get-user", function() {
        it("returns permissions for /Shared and exits 0", function() {
            var result = spawnCLI(["perms", "get-user", "/Shared"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains a users object", function() {
            var result = spawnCLI(["perms", "get-user", "/Shared"], OPTS);
            var json = result.json();
            expect(json).not.toBeNull();
            expect(json.users).toBeDefined();
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["perms", "get-user"], OPTS);
            expect(result.status).toBe(1);
        });

        it("rejects a relative path before API call", function() {
            var result = spawnCLI(["perms", "get-user", "relative/path"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });
    });

    // ── perms get-group ─────────────────────────────────────────────────────────

    describe("perms get-group", function() {
        it("returns group permissions for /Shared and exits 0", function() {
            var result = spawnCLI(["perms", "get-group", "/Shared"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["perms", "get-group"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── perms set-user (dry-run only) ───────────────────────────────────────────

    describe("perms set-user --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var result = spawnCLI(["perms", "set-user", "/Shared/Finance",
                "--json", '{"users":{"jsmith":"Viewer"}}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/perms/user/Shared/Finance");
            expect(result.stdout).toContain("Authorization: ***");
        });

        it("exits 1 when users is missing from --json", function() {
            var result = spawnCLI(["perms", "set-user", "/Shared/Finance",
                "--json", '{}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/users/);
        });

        it("rejects a relative path", function() {
            var result = spawnCLI(["perms", "set-user", "Shared/Finance",
                "--json", '{"users":{"jsmith":"Viewer"}}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });
    });

    // ── perms delete-user (dry-run only) ────────────────────────────────────────

    describe("perms delete-user --dry-run", function() {
        it("prints curl DELETE without making API call", function() {
            var result = spawnCLI(["perms", "delete-user", "/Shared/Finance",
                "--json", '{"users":["jsmith"]}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v1/perms/user/Shared/Finance");
        });

        it("exits 1 when users array is missing from --json", function() {
            var result = spawnCLI(["perms", "delete-user", "/Shared/Finance",
                "--json", '{}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/users/);
        });
    });

    // ── perms set-group (dry-run only) ──────────────────────────────────────────

    describe("perms set-group --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var result = spawnCLI(["perms", "set-group", "/Shared/Finance",
                "--json", '{"groups":{"Engineering":"Editor"}}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/perms/group/Shared/Finance");
        });

        it("exits 1 when groups is missing from --json", function() {
            var result = spawnCLI(["perms", "set-group", "/Shared/Finance",
                "--json", '{}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/groups/);
        });
    });

    // ── perms delete-group (dry-run only) ───────────────────────────────────────

    describe("perms delete-group --dry-run", function() {
        it("prints curl DELETE without making API call", function() {
            var result = spawnCLI(["perms", "delete-group", "/Shared/Finance",
                "--json", '{"groups":["Engineering"]}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v1/perms/group/Shared/Finance");
        });

        it("exits 1 when groups array is missing from --json", function() {
            var result = spawnCLI(["perms", "delete-group", "/Shared/Finance",
                "--json", '{}', "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/groups/);
        });
    });

    // ── perms get-by-user ───────────────────────────────────────────────────────

    describe("perms get-by-user", function() {
        it("returns permission level for a user on a folder and exits 0", function() {
            var result = spawnCLI(["perms", "get-by-user", currentUsername,
                "--json", '{"folder":"/Shared"}'], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains a permission field", function() {
            var result = spawnCLI(["perms", "get-by-user", currentUsername,
                "--json", '{"folder":"/Shared"}'], OPTS);
            var json = result.json();
            expect(json).not.toBeNull();
            expect(json.permission).toBeDefined();
        });

        it("exits 1 when folder is missing from --json", function() {
            var result = spawnCLI(["perms", "get-by-user", currentUsername,
                "--json", '{}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/folder/);
        });

        it("exits 1 when no username provided", function() {
            var result = spawnCLI(["perms", "get-by-user"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });
    });

});
