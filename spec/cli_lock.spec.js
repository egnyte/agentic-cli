// Integration tests for egnyte lock commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// lock and unlock use --dry-run to avoid modifying real files.
// lock get runs against a real file (read-only).

var path = require("path");
var fs   = require("fs");
var os   = require("os");

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte lock", function() {


    var OPTS       = { token: APIToken, domain: egnyteDomain };
    var runId      = Math.floor(10000 * Math.random());
    var uploadPath = testFolder + "/lock-test-" + runId + ".txt";
    var localTmp   = path.join(os.tmpdir(), "egnyte-lock-test-" + runId + ".txt");

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    beforeAll(function() {
        fs.writeFileSync(localTmp, "lock integration test " + runId);
        spawnCLI(["fs", "action", testFolder, "--json", '{"action":"add_folder"}', "--yes"], OPTS);
        spawnCLI(["fs", "upload", uploadPath, "--file", localTmp, "--yes"], OPTS);
    });

    afterAll(function() {
        try { fs.unlinkSync(localTmp); } catch (_) {}
        spawnCLI(["fs", "delete", uploadPath, "--yes"], OPTS);
    });

    // ── lock lock (dry-run only) ────────────────────────────────────────────────

    describe("lock lock --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var result = spawnCLI(["lock", "lock", uploadPath,
                "--json", '{"lock_token":"test-token","lock_timeout":300}',
                "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs");
            expect(result.stdout).toContain("Authorization: ***");
            expect(result.stdout).toContain('"action":"lock"');
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["lock", "lock", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });

        it("rejects a relative path", function() {
            var result = spawnCLI(["lock", "lock", "relative/path", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });
    });

    // ── lock unlock (dry-run only) ──────────────────────────────────────────────

    describe("lock unlock --dry-run", function() {
        it("prints curl POST without making API call", function() {
            var result = spawnCLI(["lock", "unlock", uploadPath,
                "--json", '{"lock_token":"test-token"}',
                "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs");
            expect(result.stdout).toContain('"action":"unlock"');
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["lock", "unlock", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── lock get ────────────────────────────────────────────────────────────────

    describe("lock get", function() {
        it("returns file metadata and exits 0", function() {
            var result = spawnCLI(["lock", "get", uploadPath], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["lock", "get"], OPTS);
            expect(result.status).toBe(1);
        });

        it("rejects a relative path", function() {
            var result = spawnCLI(["lock", "get", "relative/path"], OPTS);
            expect(result.status).toBe(1);
        });

        it("--fields restricts response keys", function() {
            var result = spawnCLI(["lock", "get", uploadPath,
                "--fields", "name,path,locked"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            if (json) {
                var keys = Object.keys(json);
                keys.forEach(function(k) {
                    expect(["name", "path", "locked"]).toContain(k);
                });
            }
        });

        it("schema lock.lock returns full parameter reference", function() {
            var result = spawnCLI(["schema", "lock.lock"], OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params).toBeDefined();
            expect(json.body_params.lock_token).toBeDefined();
            expect(json.body_params.lock_timeout).toBeDefined();
        });
    });

});
