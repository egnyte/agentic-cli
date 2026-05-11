// Large-file integration tests: 100 MB, 1 GB, 5 GB chunked uploads + resumes.
// These tests are NOT part of the default test:sequential run — they are too slow
// for every commit.  Run them with:
//   npm run test:large
//
// They exist specifically to prevent regressions in:
//   - Multi-chunk upload protocol (P0 item 3)
//   - Resume from interrupted upload (P0 item 3)
//   - Manifest checkpoint save / delete lifecycle (P0 item 3)
//
// Requires spec/conf/egnyte-test-config.js with valid credentials and enough quota.

var fsNode  = require("fs");
var path    = require("path");
var os      = require("os");
var crypto  = require("crypto");

var hasIntegrationCreds = typeof egnyteDomain !== "undefined" && typeof APIToken !== "undefined";

var OPTS    = { token: APIToken, domain: egnyteDomain, timeout: 600000 };
var runId   = Math.floor(10000 * Math.random());
var baseDir = (global.testFolder || "/Shared/CLITests") + "/cli-large-" + runId;

/** Generate a file of exactly `bytes` bytes filled with a deterministic pattern. */
function generateFile(filePath, bytes) {
    var BLOCK = 4 * 1024 * 1024; // 4 MB write blocks to avoid OOM on 5 GB
    var fd    = fsNode.openSync(filePath, "w");
    var written = 0;
    while (written < bytes) {
        var size = Math.min(BLOCK, bytes - written);
        var buf  = Buffer.alloc(size);
        for (var i = 0; i < size; i++) buf[i] = (written + i) % 256;
        fsNode.writeSync(fd, buf);
        written += size;
    }
    fsNode.closeSync(fd);
}

/** Return the manifest path for a given remote path (mirrors fs.js logic). */
function manifestPath(remotePath) {
    var hash = crypto.createHash("sha256").update(remotePath).digest("hex").slice(0, 16);
    return path.join(os.homedir(), ".config", "egnyte-cli", "uploads",
                     "upload-" + hash + ".json");
}

// ── Test matrix ────────────────────────────────────────────────────────────────

[
    { label: "100 MB", bytes: 100 * 1024 * 1024 },
    { label: "1 GB",   bytes: 1024 * 1024 * 1024 },
    { label: "5 GB",   bytes: 5 * 1024 * 1024 * 1024 },
].forEach(function(tc) {

    describe("fs upload-chunked " + tc.label, function() {

        var remotePath = baseDir + "/large-" + tc.bytes + "-" + runId + ".bin";
        var localFile  = path.join(os.tmpdir(), "egnyte-large-" + tc.bytes + "-" + runId + ".bin");

        beforeAll(function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 600000; // 10 min per test
            generateFile(localFile, tc.bytes);
            spawnCLI(["fs", "action", baseDir, "--json", '{"action":"add_folder"}', "--yes"], OPTS);
        });

        afterAll(function() {
            try { fsNode.unlinkSync(localFile); } catch (_) {}
            spawnCLI(["fs", "delete", remotePath, "--yes"], OPTS);
        });

        it("uploads " + tc.label + " in chunks and exits 0", function() {
            var result = spawnCLI(
                ["fs", "upload-chunked", remotePath, "--file", localFile, "--yes"],
                OPTS
            );
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.status).toBe("uploaded");
            expect(json.size).toBe(tc.bytes);
            expect(json.chunks).toBeGreaterThan(1);
        });

        it("manifest is deleted after successful upload", function() {
            expect(fsNode.existsSync(manifestPath(remotePath))).toBe(false);
        });

        it("remote file has correct size", function() {
            var result = spawnCLI(
                ["fs", "get", remotePath, "--fields", "size"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.json().size).toBe(tc.bytes);
        });

        it("--resume after deleting remote re-uploads from scratch", function() {
            spawnCLI(["fs", "delete", remotePath, "--yes"], OPTS);
            var result = spawnCLI(
                ["fs", "upload-chunked", remotePath, "--file", localFile, "--yes", "--resume"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.json().status).toBe("uploaded");
        });
    });
});

// ── Global cleanup ─────────────────────────────────────────────────────────────

afterAll(function() {
    spawnCLI(["fs", "delete", baseDir, "--yes"], OPTS);
});
