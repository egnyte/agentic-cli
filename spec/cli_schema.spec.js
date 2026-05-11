// CLI subprocess tests for the `egnyte schema` command.
// All tests use DUMMY_OPTS — no network calls are made.
// The schema command introspects the in-process SCHEMA registry, so real credentials
// are not needed.

describe("egnyte schema", function() {

    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    });

    // ── schema --list ─────────────────────────────────────────────────────────────

    describe("schema --list", function() {
        it("exits 0", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            expect(result.status).toBe(0);
        });

        it("returns valid JSON", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            expect(result.stdout).toBeValidJSON();
        });

        it("output is a non-empty object", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            var json = result.json();
            expect(typeof json).toBe("object");
            expect(Object.keys(json).length).toBeGreaterThan(0);
        });

        it("contains core fs operations", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            var json = result.json();
            ["fs.get", "fs.upload", "fs.download", "fs.delete",
             "fs.mkdir", "fs.rename", "fs.move", "fs.copy"].forEach(function(op) {
                expect(json[op]).toBeDefined("Expected " + op + " in schema --list output");
            });
        });

        it("contains search, links, users, groups, perms, ai, events, notes, lock, trash, projects", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            var json = result.json();
            ["search", "search.advanced",
             "links.create", "users.list", "groups.list",
             "perms.get-user", "ai.ask", "ai.list-kbs",
             "events.list", "notes.add", "lock.lock",
             "trash.list", "projects.list"].forEach(function(op) {
                expect(json[op]).toBeDefined("Expected " + op + " in schema --list output");
            });
        });

        it("each entry has a summary field", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            var json = result.json();
            Object.keys(json).forEach(function(op) {
                expect(typeof json[op].summary).toBe("string");
                expect(json[op].summary.length).toBeGreaterThan(0);
            });
        });

        it("does not leak token or domain to stdout", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("writes nothing to stderr on success", function() {
            var result = spawnCLI(["schema", "--list"], DUMMY_OPTS);
            expect(result.stderr).toBe("");
        });
    });

    // ── schema <op> ───────────────────────────────────────────────────────────────

    describe("schema <op>", function() {
        it("exits 0 for a known operation", function() {
            var result = spawnCLI(["schema", "fs.get"], DUMMY_OPTS);
            expect(result.status).toBe(0);
        });

        it("returns valid JSON for fs.get", function() {
            var result = spawnCLI(["schema", "fs.get"], DUMMY_OPTS);
            expect(result.stdout).toBeValidJSON();
        });

        it("fs.get schema has query_params with list_content", function() {
            var result = spawnCLI(["schema", "fs.get"], DUMMY_OPTS);
            var json = result.json();
            expect(json.query_params).toBeDefined();
            expect(json.query_params.list_content).toBeDefined();
        });

        it("fs.upload schema has body_params with file", function() {
            var result = spawnCLI(["schema", "fs.upload"], DUMMY_OPTS);
            var json = result.json();
            expect(json.body_params).toBeDefined();
            expect(json.body_params.file).toBeDefined();
        });

        it("fs.mkdir schema is mutating", function() {
            var result = spawnCLI(["schema", "fs.mkdir"], DUMMY_OPTS);
            expect(result.json().mutating).toBe(true);
        });

        it("fs.rename schema has body_params with name", function() {
            var result = spawnCLI(["schema", "fs.rename"], DUMMY_OPTS);
            var json = result.json();
            expect(json.body_params.name).toBeDefined();
        });

        it("fs.move schema has body_params with to", function() {
            var result = spawnCLI(["schema", "fs.move"], DUMMY_OPTS);
            var json = result.json();
            expect(json.body_params.to).toBeDefined();
        });

        it("fs.delete schema documents bulk and progress flags", function() {
            var result = spawnCLI(["schema", "fs.delete"], DUMMY_OPTS);
            var json = result.json();
            expect(json.flags["bulk-file-path"]).toBeDefined();
            expect(json.flags.parallelism).toBeDefined();
            expect(json.flags.progress).toBeDefined();
            expect(json.flags["json-progress"]).toBeDefined();
        });

        it("search schema has query_params with query marked required", function() {
            var result = spawnCLI(["schema", "search"], DUMMY_OPTS);
            var json = result.json();
            expect(json.query_params.query.required).toBe(true);
        });

        it("has an example field for every operation", function() {
            var list = spawnCLI(["schema", "--list"], DUMMY_OPTS).json();
            Object.keys(list).forEach(function(op) {
                var detail = spawnCLI(["schema", op], DUMMY_OPTS).json();
                expect(typeof detail.example).toBe("string");
                expect(detail.example.length).toBeGreaterThan(0);
            });
        });
    });

    // ── schema unknown-op ─────────────────────────────────────────────────────────

    describe("schema <unknown-op>", function() {
        it("exits 1", function() {
            var result = spawnCLI(["schema", "does.not.exist"], DUMMY_OPTS);
            expect(result.status).toBe(1);
        });

        it("writes structured JSON error to stderr", function() {
            var result = spawnCLI(["schema", "does.not.exist"], DUMMY_OPTS);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(typeof err.error).toBe("string");
            expect(err.error.length).toBeGreaterThan(0);
        });

        it("writes nothing to stdout on error", function() {
            var result = spawnCLI(["schema", "does.not.exist"], DUMMY_OPTS);
            expect(result.stdout).toBe("");
        });
    });

});
