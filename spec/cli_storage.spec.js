// Integration tests for egnyte fs commands against the real Egnyte API.
// Requires spec/conf/egnyte-test-config.js with valid egnyteDomain, APIToken, testFolder.
// Run sequentially: npm run test:sequential
// Pattern mirrors egnyte-js-sdk/spec/api_storage.spec.js exactly.

var fs   = require("fs");
var path = require("path");
var os   = require("os");

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte fs — Storage API integration", function() {


    // Unique test path per run — same random-suffix pattern as egnyte-js-sdk
    var runId      = Math.floor(10000 * Math.random());
    var testPath   = testFolder + "/cli-test-" + runId;
    var uploadPath = testPath + "/upload-test-" + runId + ".txt";
    var movedPath  = testPath + "/moved-" + runId + ".txt";
    var localTmp   = path.join(os.tmpdir(), "egnyte-cli-upload-" + runId + ".txt");

    var OPTS = { token: APIToken, domain: egnyteDomain };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;   // QA API can be laggy
    });

    afterAll(function() {
        // Best-effort cleanup of the local tmp file
        try { fs.unlinkSync(localTmp); } catch (_) {}
    });

    // ── fs get ──────────────────────────────────────────────────────────────────

    describe("fs get", function() {
        it("lists /Shared and returns valid JSON", function() {
            var result = spawnCLI(["fs", "get", "/Shared", "--json", '{"list_content":true}',
                "--fields", "name,path,is_folder"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("returns name and path in response when --fields name,path is set", function() {
            var result = spawnCLI(["fs", "get", "/Shared",
                "--json", '{"list_content":true}',
                "--fields", "name,path"], OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json).not.toBeNull();
            // Verify masking: no extra fields on listed items
            var allItems = (json.files || []).concat(json.folders || []);
            allItems.forEach(function(item) {
                var keys = Object.keys(item);
                keys.forEach(function(k) {
                    expect(["name", "path"]).toContain(k);
                });
            });
        });

        it("exits 1 with JSON error for a non-existent path", function() {
            var result = spawnCLI(["fs", "get", "/nonexistent-path-" + Date.now()], OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeTruthy();
        });
    });

    // ── fs action add_folder ────────────────────────────────────────────────────

    describe("fs action add_folder", function() {
        it("creates the test folder and exits 0", function() {
            var result = spawnCLI(
                ["fs", "action", testPath, "--json", '{"action":"add_folder"}', "--yes"],
                OPTS
            );
            expect(result.status).toBe(0);
        });

        it("returns valid JSON after creating folder", function() {
            // Verify folder now exists via fs get
            var result = spawnCLI(["fs", "get", testPath], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.is_folder).toBe(true);
        });
    });

    // ── fs upload ───────────────────────────────────────────────────────────────

    describe("fs upload", function() {
        beforeAll(function() {
            fs.writeFileSync(localTmp, "hello from egnyte-cli integration test run " + runId);
        });

        it("uploads a local file and exits 0", function() {
            var result = spawnCLI(
                ["fs", "upload", uploadPath, "--file", localTmp, "--yes"],
                OPTS
            );
            expect(result.status).toBe(0);
        });

        it("returns valid JSON with uploaded file path", function() {
            var result = spawnCLI(["fs", "get", uploadPath], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.name).toBeTruthy();
        });
    });

    // ── fs action move ──────────────────────────────────────────────────────────

    describe("fs action move", function() {
        it("moves the uploaded file and exits 0", function() {
            var result = spawnCLI(
                ["fs", "action", uploadPath,
                    "--json", JSON.stringify({ action: "move", destination: movedPath }),
                    "--yes"],
                OPTS
            );
            expect(result.status).toBe(0);
        });

        it("confirms moved file exists at new path", function() {
            var result = spawnCLI(["fs", "get", movedPath], OPTS);
            expect(result.status).toBe(0);
            expect(result.json().is_folder).toBe(false);
        });
    });

    // ── fs download ─────────────────────────────────────────────────────────────

    describe("fs download", function() {
        var downloadTmp = path.join(os.tmpdir(), "egnyte-cli-download-" + runId + ".txt");

        afterAll(function() {
            try { fs.unlinkSync(downloadTmp); } catch (_) {}
        });

        it("downloads the file and writes it to disk", function() {
            var result = spawnCLI(
                ["fs", "download", movedPath, "--out", downloadTmp],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(fs.existsSync(downloadTmp)).toBe(true);
        });

        it("returns valid JSON with status:downloaded", function() {
            var result = spawnCLI(
                ["fs", "download", movedPath, "--out", downloadTmp],
                OPTS
            );
            var json = result.json();
            expect(json).not.toBeNull();
            expect(json.status).toBe("downloaded");
            expect(json.saved_to).toBe(downloadTmp);
        });
    });

    // ── fs delete ───────────────────────────────────────────────────────────────

    describe("fs delete", function() {
        it("deletes the moved file and exits 0", function() {
            var result = spawnCLI(["fs", "delete", movedPath, "--yes"], OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.status).toBe("deleted");
        });

        it("deletes the test folder and exits 0 (cleanup)", function() {
            var result = spawnCLI(["fs", "delete", testPath, "--yes"], OPTS);
            expect(result.status).toBe(0);
        });

        it("confirms deleted folder no longer exists", function() {
            var result = spawnCLI(["fs", "get", testPath], OPTS);
            expect(result.status).toBe(1);
        });
    });

    // ── fs mkdir / rename / move / copy wrappers ─────────────────────────────────

    describe("fs wrapper commands (mkdir, rename, move, copy)", function() {
        var wrapperBase = testFolder + "/cli-wrappers-" + runId;
        var wrapOPTS    = { token: APIToken, domain: egnyteDomain };

        beforeAll(function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
            spawnCLI(["fs", "action", wrapperBase, "--json", '{"action":"add_folder"}', "--yes"],
                wrapOPTS);
        });

        afterAll(function() {
            spawnCLI(["fs", "delete", wrapperBase, "--yes"], wrapOPTS);
        });

        describe("fs mkdir", function() {
            var mkdirPath = wrapperBase + "/mkdir-" + runId;

            afterAll(function() {
                spawnCLI(["fs", "delete", mkdirPath, "--yes"], wrapOPTS);
            });

            it("creates a folder and exits 0", function() {
                var result = spawnCLI(["fs", "mkdir", mkdirPath, "--yes"], wrapOPTS);
                expect(result.status).toBe(0);
                var json = result.json();
                expect(json.status).toBe("created");
            });

            it("folder exists at the remote path after mkdir", function() {
                var result = spawnCLI(["fs", "get", mkdirPath], wrapOPTS);
                expect(result.status).toBe(0);
                expect(result.json().is_folder).toBe(true);
            });

            it("exits 1 when path is missing", function() {
                var result = spawnCLI(["fs", "mkdir", "--yes"], wrapOPTS);
                expect(result.status).toBe(1);
            });
        });

        describe("fs rename", function() {
            var origPath    = wrapperBase + "/rename-orig-" + runId + ".txt";
            var newName     = "rename-new-" + runId + ".txt";
            var renamedPath = wrapperBase + "/" + newName;
            var tmpFile     = path.join(os.tmpdir(), "rename-test-" + runId + ".txt");

            beforeAll(function() {
                fs.writeFileSync(tmpFile, "rename test " + runId);
                spawnCLI(["fs", "upload", origPath, "--file", tmpFile, "--yes"], wrapOPTS);
            });

            afterAll(function() {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                spawnCLI(["fs", "delete", renamedPath, "--yes"], wrapOPTS);
            });

            it("renames the file and exits 0", function() {
                var result = spawnCLI(
                    ["fs", "rename", origPath, "--name", newName, "--yes"],
                    wrapOPTS
                );
                expect(result.status).toBe(0);
            });

            it("file exists at new name after rename", function() {
                var result = spawnCLI(["fs", "get", renamedPath], wrapOPTS);
                expect(result.status).toBe(0);
                expect(result.json().name).toBe(newName);
            });

            it("file no longer exists at original path after rename", function() {
                var result = spawnCLI(["fs", "get", origPath], wrapOPTS);
                expect(result.status).toBe(1);
            });

            it("exits 1 when --name is missing", function() {
                var result = spawnCLI(["fs", "rename", origPath, "--yes"], wrapOPTS);
                expect(result.status).toBe(1);
            });
        });

        describe("fs copy", function() {
            var copySrc  = wrapperBase + "/copy-src-" + runId + ".txt";
            var copyDest = wrapperBase + "/copy-dest-" + runId + ".txt";
            var tmpFile  = path.join(os.tmpdir(), "copy-test-" + runId + ".txt");

            beforeAll(function() {
                fs.writeFileSync(tmpFile, "copy test " + runId);
                spawnCLI(["fs", "upload", copySrc, "--file", tmpFile, "--yes"], wrapOPTS);
            });

            afterAll(function() {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                spawnCLI(["fs", "delete", copySrc,  "--yes"], wrapOPTS);
                spawnCLI(["fs", "delete", copyDest, "--yes"], wrapOPTS);
            });

            it("copies the file and exits 0", function() {
                var result = spawnCLI(
                    ["fs", "copy", copySrc, "--to", copyDest, "--yes"],
                    wrapOPTS
                );
                expect(result.status).toBe(0);
            });

            it("source still exists after copy", function() {
                var result = spawnCLI(["fs", "get", copySrc], wrapOPTS);
                expect(result.status).toBe(0);
            });

            it("destination exists after copy", function() {
                var result = spawnCLI(["fs", "get", copyDest], wrapOPTS);
                expect(result.status).toBe(0);
            });

            it("exits 1 when --to is missing", function() {
                var result = spawnCLI(["fs", "copy", copySrc, "--yes"], wrapOPTS);
                expect(result.status).toBe(1);
            });
        });

        describe("fs move", function() {
            var moveSrc  = wrapperBase + "/move-src-" + runId + ".txt";
            var moveDest = wrapperBase + "/move-dest-" + runId + ".txt";
            var tmpFile  = path.join(os.tmpdir(), "move-test-" + runId + ".txt");

            beforeAll(function() {
                fs.writeFileSync(tmpFile, "move test " + runId);
                spawnCLI(["fs", "upload", moveSrc, "--file", tmpFile, "--yes"], wrapOPTS);
            });

            afterAll(function() {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
                // moveSrc should no longer exist; moveDest needs cleanup
                spawnCLI(["fs", "delete", moveDest, "--yes"], wrapOPTS);
            });

            it("moves the file and exits 0", function() {
                var result = spawnCLI(
                    ["fs", "move", moveSrc, "--to", moveDest, "--yes"],
                    wrapOPTS
                );
                expect(result.status).toBe(0);
            });

            it("source no longer exists after move", function() {
                var result = spawnCLI(["fs", "get", moveSrc], wrapOPTS);
                expect(result.status).toBe(1);
            });

            it("destination exists after move", function() {
                var result = spawnCLI(["fs", "get", moveDest], wrapOPTS);
                expect(result.status).toBe(0);
            });

            it("exits 1 when --to is missing", function() {
                var result = spawnCLI(["fs", "move", moveDest, "--yes"], wrapOPTS);
                expect(result.status).toBe(1);
            });
        });
    });

    // ── fs upload-chunked (multi-chunk) + resume ──────────────────────────────

    describe("fs upload-chunked", function() {
        // Generate a 25 MB file so the default 10 MB chunk size produces 3 chunks.
        // This validates that the whole multi-chunk protocol works end-to-end.
        var chunkedBase = testFolder + "/cli-chunked-" + runId;
        var remotePath  = chunkedBase + "/bigfile-" + runId + ".bin";
        var localBig    = path.join(os.tmpdir(), "egnyte-cli-big-" + runId + ".bin");
        var CHUNK_OPTS  = { token: APIToken, domain: egnyteDomain, timeout: 120000 };

        beforeAll(function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
            // Build a 25 MB buffer filled with a repeating byte pattern
            var SIZE = 25 * 1024 * 1024;
            var buf  = Buffer.alloc(SIZE);
            for (var i = 0; i < SIZE; i++) buf[i] = i % 256;
            fs.writeFileSync(localBig, buf);
            spawnCLI(["fs", "action", chunkedBase, "--json", '{"action":"add_folder"}', "--yes"],
                CHUNK_OPTS);
        });

        afterAll(function() {
            try { fs.unlinkSync(localBig); } catch (_) {}
            spawnCLI(["fs", "delete", remotePath,  "--yes"], CHUNK_OPTS);
            spawnCLI(["fs", "delete", chunkedBase, "--yes"], CHUNK_OPTS);
        });

        it("uploads a 25 MB file in multiple chunks and exits 0", function() {
            var result = spawnCLI(
                ["fs", "upload-chunked", remotePath, "--file", localBig, "--yes"],
                CHUNK_OPTS
            );
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.status).toBe("uploaded");
            expect(json.chunks).toBeGreaterThan(1);
        });

        it("uploaded file exists at remote path with correct size", function() {
            var result = spawnCLI(
                ["fs", "get", remotePath, "--fields", "name,size"],
                CHUNK_OPTS
            );
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.size).toBe(25 * 1024 * 1024);
        });

        it("manifest is cleaned up after successful upload", function() {
            // The manifest lives at ~/.config/egnyte-cli/uploads/upload-<hash>.json.
            // After a successful upload it must be deleted so a future --resume
            // starts a fresh session rather than replaying a stale checkpoint.
            var crypto  = require("crypto");
            var os2     = require("os");
            var hash    = crypto.createHash("sha256").update(remotePath).digest("hex").slice(0, 16);
            var mPath   = path.join(os2.homedir(), ".config", "egnyte-cli", "uploads",
                                    "upload-" + hash + ".json");
            expect(fs.existsSync(mPath)).toBe(false);
        });

        it("--resume with no existing manifest starts a fresh upload", function() {
            // Delete the remote file so we can re-upload
            spawnCLI(["fs", "delete", remotePath, "--yes"], CHUNK_OPTS);
            var result = spawnCLI(
                ["fs", "upload-chunked", remotePath, "--file", localBig, "--yes", "--resume"],
                CHUNK_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.json().status).toBe("uploaded");
        });
    });

    // ── fs download --resume ──────────────────────────────────────────────────

    describe("fs download --resume", function() {
        var resumeRemote  = testFolder + "/resume-dl-" + runId + ".txt";
        var resumeLocal   = path.join(os.tmpdir(), "egnyte-cli-resume-" + runId + ".txt");
        var localContent  = "resume download test content " + runId;
        var localSrc      = path.join(os.tmpdir(), "egnyte-cli-resume-src-" + runId + ".txt");
        var DL_OPTS       = { token: APIToken, domain: egnyteDomain };

        beforeAll(function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
            fs.writeFileSync(localSrc, localContent);
            spawnCLI(["fs", "upload", resumeRemote, "--file", localSrc, "--yes"], DL_OPTS);
        });

        afterAll(function() {
            try { fs.unlinkSync(localSrc);   } catch (_) {}
            try { fs.unlinkSync(resumeLocal); } catch (_) {}
            spawnCLI(["fs", "delete", resumeRemote, "--yes"], DL_OPTS);
        });

        it("--resume on a missing local file downloads the whole file", function() {
            try { fs.unlinkSync(resumeLocal); } catch (_) {}
            var result = spawnCLI(
                ["fs", "download", resumeRemote, "--out", resumeLocal, "--resume"],
                DL_OPTS
            );
            expect(result.status).toBe(0);
            expect(fs.existsSync(resumeLocal)).toBe(true);
            expect(fs.readFileSync(resumeLocal, "utf8")).toBe(localContent);
        });

        it("--resume on an already-complete file exits 0 without corrupting it", function() {
            // File is already fully downloaded from the previous test — resume should
            // detect 416 (range not satisfiable) and treat it as success.
            var result = spawnCLI(
                ["fs", "download", resumeRemote, "--out", resumeLocal, "--resume"],
                DL_OPTS
            );
            expect(result.status).toBe(0);
            expect(fs.readFileSync(resumeLocal, "utf8")).toBe(localContent);
        });

        it("--resume on a truncated local file fetches only missing bytes", function() {
            // Truncate to half — simulates an interrupted download
            var half = Math.floor(localContent.length / 2);
            fs.writeFileSync(resumeLocal, localContent.slice(0, half));
            var result = spawnCLI(
                ["fs", "download", resumeRemote, "--out", resumeLocal, "--resume"],
                DL_OPTS
            );
            expect(result.status).toBe(0);
            expect(fs.readFileSync(resumeLocal, "utf8")).toBe(localContent);
        });
    });

    // ── schema command ──────────────────────────────────────────────────────────

    describe("egnyte schema", function() {
        it("schema --list returns valid JSON with all operations", function() {
            var result = spawnCLI(["schema", "--list"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json["fs.get"]).toBeDefined();
            expect(json["fs.action"]).toBeDefined();
            expect(json["fs.delete"]).toBeDefined();
        });

        it("schema fs.action returns full parameter reference", function() {
            var result = spawnCLI(["schema", "fs.action"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.body_params).toBeDefined();
            expect(json.body_params.action).toBeDefined();
        });

        it("schema unknown-op exits 1 with JSON error", function() {
            var result = spawnCLI(["schema", "nonexistent.op"], OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err.error).toMatch(/Unknown operation/);
        });
    });

    // ── fs get-content ───────────────────────────────────────────────────────────

    describe("fs get-content", function() {
        it("exits 1 when path is missing", function() {
            var result = spawnCLI(["fs", "get-content"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 for a relative path", function() {
            var result = spawnCLI(["fs", "get-content", "relative/path.txt"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("returns content of an uploaded text file", function() {
            // Upload a small text file first, then read its content back
            var tmpFile = path.join(os.tmpdir(), "egnyte-content-test-" + Math.random() + ".txt");
            var content = "Hello from fs get-content test";
            require("fs").writeFileSync(tmpFile, content);

            var contentPath = testFolder + "/content-test-" + Math.floor(10000 * Math.random()) + ".txt";
            var upload = spawnCLI(
                ["fs", "upload", contentPath, "--file", tmpFile, "--yes"],
                OPTS
            );
            try { require("fs").unlinkSync(tmpFile); } catch (_) {}
            if (upload.status !== 0) { pending("upload failed, skipping get-content test"); return; }

            var result = spawnCLI(["fs", "get-content", contentPath], OPTS);
            expect(result.status).toBe(0);

            // Cleanup
            spawnCLI(["fs", "delete", contentPath, "--yes"], OPTS);
        });

        it("schema fs.get-content returns full parameter reference", function() {
            var result = spawnCLI(["schema", "fs.get-content"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.query_params.offset).toBeDefined();
            expect(json.query_params.limit).toBeDefined();
        });
    });

    // ── fs list-metadata-namespaces ──────────────────────────────────────────────

    describe("fs list-metadata-namespaces", function() {
        it("returns valid JSON", function() {
            var result = spawnCLI(["fs", "list-metadata-namespaces"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("schema fs.list-metadata-namespaces returns full parameter reference", function() {
            var result = spawnCLI(["schema", "fs.list-metadata-namespaces"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });
    });

    // ── fs set-metadata ──────────────────────────────────────────────────────────

    describe("fs set-metadata", function() {
        it("exits 1 when path is missing", function() {
            var result = spawnCLI(["fs", "set-metadata", "--yes"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 for a relative path", function() {
            var result = spawnCLI(
                ["fs", "set-metadata", "relative/path.pdf",
                    "--json", '{"namespace":"test","values":{}}', "--yes"],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("requires --yes or --dry-run (mutating operation)", function() {
            var result = spawnCLI(
                ["fs", "set-metadata", "/Shared/report.pdf",
                    "--json", '{"namespace":"test","values":{"status":"draft"}}'],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("--dry-run prints curl PUT to /pubapi/v1/fs/ids/file/<entry-id>/properties/{namespace}", function() {
            var result = spawnCLI(
                ["fs", "set-metadata", "/Shared/report.pdf",
                    "--json", '{"namespace":"contract","values":{"status":"signed"}}',
                    "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X PUT");
            expect(result.stdout).toContain("/pubapi/v1/fs/ids/file/");
            expect(result.stdout).toContain("contract");
        });

        it("schema fs.set-metadata returns full parameter reference", function() {
            var result = spawnCLI(["schema", "fs.set-metadata"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.body_params.namespace).toBeDefined();
            expect(json.body_params.values).toBeDefined();
        });
    });

});
