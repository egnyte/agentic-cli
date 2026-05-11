// Integration tests for egnyte links commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// Tests create a link, list it, retrieve it by ID, then delete it (full lifecycle).

var path = require("path");
var fs   = require("fs");
var os   = require("os");

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte links", function() {


    var OPTS       = { token: APIToken, domain: egnyteDomain };
    var runId      = Math.floor(10000 * Math.random());
    var uploadPath = testFolder + "/links-test-" + runId + ".txt";
    var localTmp   = path.join(os.tmpdir(), "egnyte-links-test-" + runId + ".txt");
    var createdLinkId;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    beforeAll(function() {
        // Upload a test file to create links against
        fs.writeFileSync(localTmp, "links integration test " + runId);

        // Ensure test folder exists
        spawnCLI(["fs", "action", testFolder, "--json", '{"action":"add_folder"}', "--yes"], OPTS);

        // Upload
        spawnCLI(["fs", "upload", uploadPath, "--file", localTmp, "--yes"], OPTS);
    });

    afterAll(function() {
        try { fs.unlinkSync(localTmp); } catch (_) {}
        spawnCLI(["fs", "delete", uploadPath, "--yes"], OPTS);
    });

    // ── links create ────────────────────────────────────────────────────────────

    describe("links create", function() {
        it("creates a link and exits 0", function() {
            var result = spawnCLI(["links", "create", "--json",
                JSON.stringify({ path: uploadPath, type: "file", accessibility: "anyone" }),
                "--yes"
            ], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json).not.toBeNull();
            // Save link ID for subsequent tests (create returns {links:[{id,...}],...})
            if (json && json.links && json.links[0]) createdLinkId = json.links[0].id;
        });

        it("returns a url in the response", function() {
            var result = spawnCLI(["links", "create", "--json",
                JSON.stringify({ path: uploadPath, type: "file", accessibility: "anyone" }),
                "--yes"
            ], OPTS);
            var json = result.json();
            if (json) {
                var hasUrl = (json.links && json.links[0] && json.links[0].url) || json.url;
                expect(hasUrl).toBeTruthy();
            }
        });

        it("--dry-run prints curl POST without making API call", function() {
            var result = spawnCLI(["links", "create", "--json",
                JSON.stringify({ path: uploadPath, type: "file", accessibility: "anyone" }),
                "--dry-run"
            ], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/links");
            expect(result.stdout).toContain("Authorization: ***");
        });

        it("exits 1 when path is missing from --json", function() {
            var result = spawnCLI(["links", "create", "--json",
                '{"type":"file","accessibility":"viewers"}'
            ], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/path/);
        });

        it("exits 1 when type is missing from --json", function() {
            var result = spawnCLI(["links", "create", "--json",
                JSON.stringify({ path: uploadPath, accessibility: "anyone" })
            ], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/type/);
        });

        it("exits 1 when accessibility is missing from --json", function() {
            var result = spawnCLI(["links", "create", "--json",
                JSON.stringify({ path: uploadPath, type: "file" })
            ], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/accessibility/);
        });
    });

    // ── links list ──────────────────────────────────────────────────────────────

    describe("links list", function() {
        it("lists links and exits 0", function() {
            var result = spawnCLI(["links", "list"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("accepts --json query params", function() {
            var result = spawnCLI(["links", "list",
                "--json", JSON.stringify({ path: uploadPath })
            ], OPTS);
            expect(result.status).toBe(0);
        });
    });

    // ── links get ───────────────────────────────────────────────────────────────

    describe("links get", function() {
        it("exits 1 when no id provided", function() {
            var result = spawnCLI(["links", "get"], OPTS);
            expect(result.status).toBe(1);
        });

        it("gets a link by ID when createdLinkId is available", function() {
            if (!createdLinkId) {
                pending("no link ID from create test");
                return;
            }
            var result = spawnCLI(["links", "get", createdLinkId], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });
    });

    // ── links delete ────────────────────────────────────────────────────────────

    describe("links delete", function() {
        it("--dry-run prints curl DELETE", function() {
            var result = spawnCLI(["links", "delete", "dummy-id", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v1/links/dummy-id");
        });

        it("deletes the created link when ID is available", function() {
            if (!createdLinkId) {
                pending("no link ID from create test");
                return;
            }
            var result = spawnCLI(["links", "delete", createdLinkId, "--yes"], OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.status).toBe("deleted");
        });
    });

});
