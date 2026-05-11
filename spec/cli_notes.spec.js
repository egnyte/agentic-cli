// Integration tests for egnyte notes commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// Full lifecycle: upload test file → add note → list → get → delete.
// File is cleaned up in afterAll.

var path = require("path");
var fs   = require("fs");
var os   = require("os");

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte notes", function() {


    var OPTS        = { token: APIToken, domain: egnyteDomain };
    var runId       = Math.floor(10000 * Math.random());
    var uploadPath  = testFolder + "/notes-test-" + runId + ".txt";
    var localTmp    = path.join(os.tmpdir(), "egnyte-notes-test-" + runId + ".txt");
    var createdNoteId;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    beforeAll(function() {
        fs.writeFileSync(localTmp, "notes integration test " + runId);
        spawnCLI(["fs", "action", testFolder, "--json", '{"action":"add_folder"}', "--yes"], OPTS);
        spawnCLI(["fs", "upload", uploadPath, "--file", localTmp, "--yes"], OPTS);
    });

    afterAll(function() {
        try { fs.unlinkSync(localTmp); } catch (_) {}
        spawnCLI(["fs", "delete", uploadPath, "--yes"], OPTS);
    });

    // ── notes add ───────────────────────────────────────────────────────────────

    describe("notes add", function() {
        it("--dry-run prints curl POST without making API call", function() {
            var result = spawnCLI(["notes", "add", uploadPath,
                "--json", '{"body":"dry-run test note"}', "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/notes");
            expect(result.stdout).toContain("Authorization: ***");
        });

        it("exits 1 when body is missing from --json", function() {
            var result = spawnCLI(["notes", "add", uploadPath,
                "--json", '{}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/body/);
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["notes", "add",
                "--json", '{"body":"test"}'], OPTS);
            expect(result.status).toBe(1);
        });

        it("rejects a relative path", function() {
            var result = spawnCLI(["notes", "add", "relative/path",
                "--json", '{"body":"test"}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("adds a note and exits 0", function() {
            var result = spawnCLI(["notes", "add", uploadPath,
                "--json", '{"body":"Integration test note ' + runId + '"}', "--yes"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            if (json && json.id) createdNoteId = json.id;
        });
    });

    // ── notes list ──────────────────────────────────────────────────────────────

    describe("notes list", function() {
        it("lists notes for a file and exits 0", function() {
            var result = spawnCLI(["notes", "list", uploadPath], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("exits 1 when no path provided", function() {
            var result = spawnCLI(["notes", "list"], OPTS);
            expect(result.status).toBe(1);
        });

        it("rejects a relative path", function() {
            var result = spawnCLI(["notes", "list", "relative/path"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── notes get ───────────────────────────────────────────────────────────────

    describe("notes get", function() {
        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["notes", "get"], OPTS);
            expect(result.status).toBe(1);
        });

        it("gets a note by ID when createdNoteId is available", function() {
            if (!createdNoteId) {
                pending("no note ID from add test");
                return;
            }
            var result = spawnCLI(["notes", "get", createdNoteId], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });
    });

    // ── notes delete ────────────────────────────────────────────────────────────

    describe("notes delete", function() {
        it("--dry-run prints curl DELETE", function() {
            var result = spawnCLI(["notes", "delete", "dummy-note-id", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v1/notes/dummy-note-id");
        });

        it("exits 1 when no ID provided", function() {
            var result = spawnCLI(["notes", "delete"], OPTS);
            expect(result.status).toBe(1);
        });

        it("deletes the created note when ID is available", function() {
            if (!createdNoteId) {
                pending("no note ID from add test");
                return;
            }
            var result = spawnCLI(["notes", "delete", createdNoteId, "--yes"], OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.status).toBe("deleted");
        });
    });

});
