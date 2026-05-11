// Subprocess tests for --dry-run behaviour.
// Spawns the CLI binary with dummy env-var credentials — no real API calls are made.
// Agent rule protected: Rule 6 (--dry-run preview before every mutation) +
//                       Rule 7 (JSON-only output / token never leaked in preview).

var path = require("path");
var fs   = require("fs");
var os   = require("os");

describe("--dry-run output", function() {

    // Dummy credentials — resolveAuth reads env vars, no network call happens
    var OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    describe("fs action --dry-run", function() {
        it("prints a curl POST command to stdout", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
        });

        it("includes the correct Egnyte domain in the URL", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("testdomain.egnyte.com");
        });

        it("accepts a full Egnyte URL and does not duplicate the hostname", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                { token: "dummytoken123", domain: "https://testdomain.egnyte.com" }
            );
            expect(result.stdout).toContain("https://testdomain.egnyte.com/pubapi/v1/fs/Shared/NewFolder");
            expect(result.stdout).not.toContain("https://https://");
            expect(result.stdout).not.toContain("egnyte.com.egnyte.com");
        });

        it("includes the path in the URL", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("/pubapi/v1/fs/Shared/NewFolder");
        });

        it("NEVER leaks the bearer token — shows *** instead", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("Authorization: ***");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("includes the JSON body in the curl command", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("add_folder");
        });
    });

    describe("fs delete --dry-run", function() {
        it("prints a curl DELETE command to stdout", function() {
            var result = spawnCLI(["fs", "delete", "/Shared/old.pdf", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
        });

        it("includes the file path in the URL", function() {
            var result = spawnCLI(["fs", "delete", "/Shared/old.pdf", "--dry-run"], OPTS);
            expect(result.stdout).toContain("/pubapi/v1/fs/Shared/old.pdf");
        });

        it("NEVER leaks the bearer token", function() {
            var result = spawnCLI(["fs", "delete", "/Shared/old.pdf", "--dry-run"], OPTS);
            expect(result.stdout).toContain("Authorization: ***");
            expect(result.stdout).not.toContain("dummytoken123");
        });
    });

    describe("fs upload --dry-run", function() {
        var tmpFile;

        beforeEach(function() {
            // Create a temporary local file for the upload test
            tmpFile = path.join(os.tmpdir(), "egnyte-cli-test-" + Date.now() + ".txt");
            fs.writeFileSync(tmpFile, "test content");
        });

        afterEach(function() {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        });

        it("prints a curl POST command with multipart form data", function() {
            var result = spawnCLI(
                ["fs", "upload", "/Shared/test.txt", "--file", tmpFile, "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("multipart/form-data");
        });
    });

    describe("trash --dry-run", function() {
        it("trash restore prints a curl POST command", function() {
            var result = spawnCLI(
                ["trash", "restore", "--json", '{"ids":["id1"]}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs/trash");
            expect(result.stdout).toContain("RESTORE");
            expect(result.stdout).toContain("id1");
        });

        it("trash delete prints a curl POST command", function() {
            var result = spawnCLI(
                ["trash", "delete", "--json", '{"ids":["id1"]}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs/trash");
            expect(result.stdout).toContain("PURGE");
            expect(result.stdout).toContain("id1");
        });
    });

    describe("fs upload details --dry-run", function() {
        var tmpFile;

        beforeEach(function() {
            tmpFile = path.join(os.tmpdir(), "egnyte-cli-test-" + Date.now() + ".txt");
            fs.writeFileSync(tmpFile, "test content");
        });

        afterEach(function() {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        });

        it("references the local file path in the -F flag", function() {
            var result = spawnCLI(
                ["fs", "upload", "/Shared/test.txt", "--file", tmpFile, "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("-F 'file=@");
            expect(result.stdout).toContain(tmpFile);
        });

        it("uses the fs-content endpoint", function() {
            var result = spawnCLI(
                ["fs", "upload", "/Shared/test.txt", "--file", tmpFile, "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("/pubapi/v1/fs-content/");
        });

        it("NEVER leaks the bearer token", function() {
            var result = spawnCLI(
                ["fs", "upload", "/Shared/test.txt", "--file", tmpFile, "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain("Authorization: ***");
            expect(result.stdout).not.toContain("dummytoken123");
        });
    });

    describe("path validation fires before --dry-run output", function() {
        it("rejects a relative path and exits 1 before printing curl", function() {
            var result = spawnCLI(
                ["fs", "action", "relative/path", "--json", '{"action":"add_folder"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toMatch(/must start with \//);
        });

        it("rejects a path traversal attempt and exits 1", function() {
            var result = spawnCLI(
                ["fs", "delete", "/Shared/../etc/passwd", "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
        });
    });

    // ── --yes / --dry-run enforcement (requireConfirmation) ───────────────────
    // Agent rule protected: Rule 1 (all mutations require --yes or --dry-run at binary level)

    describe("mutation without --yes or --dry-run", function() {
        it("fs delete exits 1 with a clear error message", function() {
            var result = spawnCLI(["fs", "delete", "/Shared/test.txt"], OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toMatch(/--yes|--dry-run/);
        });

        it("fs action exits 1", function() {
            var result = spawnCLI(
                ["fs", "action", "/Shared/NewFolder", "--json", '{"action":"add_folder"}'],
                OPTS
            );
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err.error).toMatch(/--yes|--dry-run/);
        });

        it("fs mkdir exits 1", function() {
            var result = spawnCLI(["fs", "mkdir", "/Shared/NewFolder"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("fs rename exits 1", function() {
            var result = spawnCLI(["fs", "rename", "/Shared/a.txt", "--name", "b.txt"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("fs move exits 1", function() {
            var result = spawnCLI(["fs", "move", "/Shared/a.txt", "--to", "/Shared/b.txt"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("fs copy exits 1", function() {
            var result = spawnCLI(["fs", "copy", "/Shared/a.txt", "--to", "/Shared/b.txt"], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("egnyte request POST exits 1", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups", "-X", "POST", "--json", '{"displayName":"T"}'],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("notes add exits 1", function() {
            var result = spawnCLI(
                ["notes", "add", "/Shared/f.txt", "--json", '{"body":"test"}'],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });

        it("links create exits 1", function() {
            var result = spawnCLI(
                ["links", "create", "--json",
                    '{"path":"/Shared/f.txt","type":"file","accessibility":"anyone"}'],
                OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        });
    });

    // ── --dry-run for new wrapper commands ─────────────────────────────────────

    describe("fs mkdir --dry-run", function() {
        it("prints a curl POST without executing", function() {
            var result = spawnCLI(["fs", "mkdir", "/Shared/NewFolder", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("add_folder");
            expect(result.stdout).toContain("/pubapi/v1/fs/Shared/NewFolder");
            expect(result.stdout).not.toContain("dummytoken123");
        });
    });

    describe("fs rename --dry-run", function() {
        it("prints a curl POST (rename is a move to same parent)", function() {
            var result = spawnCLI(
                ["fs", "rename", "/Shared/old.txt", "--name", "new.txt", "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("move");
        });

        it("exits 1 when --name is missing", function() {
            var result = spawnCLI(["fs", "rename", "/Shared/old.txt", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    describe("fs move --dry-run", function() {
        it("prints a curl POST with move action", function() {
            var result = spawnCLI(
                ["fs", "move", "/Shared/a.txt", "--to", "/Shared/Archive/a.txt", "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("move");
        });

        it("exits 1 when --to is missing", function() {
            var result = spawnCLI(["fs", "move", "/Shared/a.txt", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

    describe("fs copy --dry-run", function() {
        it("prints a curl POST with copy action", function() {
            var result = spawnCLI(
                ["fs", "copy", "/Shared/a.txt", "--to", "/Shared/Archive/a.txt", "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("copy");
        });
    });

    describe("egnyte request --dry-run", function() {
        it("GET prints curl GET without executing", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v1/userinfo", "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("testdomain.egnyte.com");
            expect(result.stdout).toContain("/pubapi/v1/userinfo");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("POST prints curl POST with body", function() {
            var result = spawnCLI(
                ["request", "/pubapi/v2/groups", "-X", "POST",
                    "--json", '{"displayName":"Test"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("displayName");
        });

        it("exits 1 when no API path provided", function() {
            var result = spawnCLI(["request"], OPTS);
            expect(result.status).toBe(1);
        });

        it("exits 1 when path does not start with /", function() {
            var result = spawnCLI(["request", "pubapi/v1/userinfo", "--dry-run"], OPTS);
            expect(result.status).toBe(1);
        });
    });

});
