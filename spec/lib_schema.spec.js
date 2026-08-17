// Unit tests for src/lib/schema-registry.js
// Validates the schema registry structure — the contract agents rely on for runtime introspection.
// No network calls, no subprocess — pure in-process assertions.
// Agent rule protected: Rule 1 (schema command enables runtime introspection without pre-loaded docs).

var SCHEMA = require("../src/lib/schema-registry").SCHEMA;

describe("SCHEMA registry", function() {

    var EXPECTED_OPS = [
        // File System
        "fs.get", "fs.action", "fs.mkdir", "fs.rename", "fs.move", "fs.copy",
        "fs.delete", "fs.upload", "fs.upload-chunked", "fs.download", "fs.download-by-id",
        "fs.get-content", "fs.set-metadata", "fs.list-metadata-namespaces",
        // Search
        "search", "search.advanced",
        // User Info
        "userinfo",
        // Links
        "links.create", "links.list", "links.get", "links.delete",
        // Users
        "users.get", "users.list", "users.create", "users.update", "users.delete",
        // Groups
        "groups.get", "groups.list", "groups.create", "groups.update", "groups.delete",
        // Permissions
        "perms.get-user", "perms.set-user", "perms.delete-user",
        "perms.get-group", "perms.set-group", "perms.delete-group",
        "perms.get-by-user",
        // Events
        "events.get-cursor", "events.list",
        // Notes
        "notes.add", "notes.list", "notes.get", "notes.delete",
        // Locking
        "lock.lock", "lock.unlock", "lock.get",
        // Trash
        "trash.list", "trash.restore", "trash.delete",
        // Projects
        "projects.list", "projects.get", "projects.create", "projects.update", "projects.delete",
        // AI
        "ai.ask", "ai.status", "ai.ask-document", "ai.summarize", "ai.ask-kb", "ai.list-kbs", "ai.hybrid-search",
        // Agents
        "agents.list", "agents.ask", "agents.status",
    ];

    describe("operation inventory", function() {
        it("contains all expected operations", function() {
            EXPECTED_OPS.forEach(function(op) {
                expect(SCHEMA[op]).toBeDefined("Missing operation: " + op);
            });
        });

        it("contains no unexpected extra operations", function() {
            var actualOps   = Object.keys(SCHEMA).sort();
            var expectedOps = EXPECTED_OPS.slice().sort();
            expect(actualOps).toEqual(expectedOps);
        });
    });

    describe("required fields on every operation", function() {
        EXPECTED_OPS.forEach(function(op) {
            describe(op, function() {
                it("has a non-empty summary", function() {
                    expect(typeof SCHEMA[op].summary).toBe("string");
                    expect(SCHEMA[op].summary.length).toBeGreaterThan(0);
                });
                it("has a valid HTTP method", function() {
                    expect(["GET", "POST", "DELETE", "PUT", "PATCH"]).toContain(SCHEMA[op].method);
                });
                it("has an endpoint starting with /pubapi", function() {
                    expect(SCHEMA[op].endpoint).toMatch(/^\/pubapi/);
                });
                it("has a boolean mutating flag", function() {
                    expect(typeof SCHEMA[op].mutating).toBe("boolean");
                });
                it("has a copy-paste example string", function() {
                    expect(typeof SCHEMA[op].example).toBe("string");
                    expect(SCHEMA[op].example.length).toBeGreaterThan(0);
                });
            });
        });
    });

    describe("mutating flags — read operations are non-mutating", function() {
        var readOps = ["fs.get", "fs.download", "fs.download-by-id",
            "search", "userinfo", "links.list", "links.get",
            "users.get", "users.list", "groups.get", "groups.list",
            "perms.get-user", "perms.get-group", "perms.get-by-user",
            "events.get-cursor", "events.list",
            "notes.list", "notes.get",
            "lock.get",
            "trash.list",
            "projects.list", "projects.get",
            "ai.status", "ai.ask-document", "ai.summarize", "ai.ask-kb", "ai.list-kbs", "ai.hybrid-search"];
        readOps.forEach(function(op) {
            it(op + " is non-mutating", function() {
                expect(SCHEMA[op].mutating).toBe(false);
            });
        });
    });

    describe("mutating flags — write operations are mutating", function() {
        var writeOps = ["fs.action", "fs.mkdir", "fs.rename", "fs.move", "fs.copy",
            "fs.delete", "fs.upload", "fs.upload-chunked",
            "links.create", "links.delete",
            "users.create", "users.update", "users.delete",
            "groups.create", "groups.update", "groups.delete",
            "perms.set-user", "perms.delete-user", "perms.set-group", "perms.delete-group",
            "notes.add", "notes.delete",
            "lock.lock", "lock.unlock",
            "trash.restore", "trash.delete",
            "projects.create", "projects.update", "projects.delete",
            "ai.ask"];
        writeOps.forEach(function(op) {
            it(op + " is mutating", function() {
                expect(SCHEMA[op].mutating).toBe(true);
            });
        });
    });

    describe("HTTP methods", function() {
        it("fs.get uses GET",                function() { expect(SCHEMA["fs.get"].method).toBe("GET"); });
        it("fs.action uses POST",            function() { expect(SCHEMA["fs.action"].method).toBe("POST"); });
        it("fs.delete uses DELETE",          function() { expect(SCHEMA["fs.delete"].method).toBe("DELETE"); });
        it("search uses GET",                function() { expect(SCHEMA["search"].method).toBe("GET"); });
        it("fs.mkdir uses POST",             function() { expect(SCHEMA["fs.mkdir"].method).toBe("POST"); });
        it("fs.rename uses POST",            function() { expect(SCHEMA["fs.rename"].method).toBe("POST"); });
        it("fs.move uses POST",              function() { expect(SCHEMA["fs.move"].method).toBe("POST"); });
        it("fs.copy uses POST",              function() { expect(SCHEMA["fs.copy"].method).toBe("POST"); });
        it("links.create uses POST",         function() { expect(SCHEMA["links.create"].method).toBe("POST"); });
        it("links.delete uses DELETE",       function() { expect(SCHEMA["links.delete"].method).toBe("DELETE"); });
        it("users.create uses POST",         function() { expect(SCHEMA["users.create"].method).toBe("POST"); });
        it("users.update uses PATCH",        function() { expect(SCHEMA["users.update"].method).toBe("PATCH"); });
        it("users.delete uses DELETE",       function() { expect(SCHEMA["users.delete"].method).toBe("DELETE"); });
        it("groups.create uses POST",        function() { expect(SCHEMA["groups.create"].method).toBe("POST"); });
        it("groups.update uses PATCH",       function() { expect(SCHEMA["groups.update"].method).toBe("PATCH"); });
        it("perms.set-user uses POST",       function() { expect(SCHEMA["perms.set-user"].method).toBe("POST"); });
        it("perms.delete-user uses POST",  function() { expect(SCHEMA["perms.delete-user"].method).toBe("POST"); });
        it("perms.set-group uses POST",      function() { expect(SCHEMA["perms.set-group"].method).toBe("POST"); });
        it("perms.delete-group uses POST", function() { expect(SCHEMA["perms.delete-group"].method).toBe("POST"); });
    });

    describe("search params", function() {
        it("has required query param marked required", function() {
            expect(SCHEMA["search"].query_params.query.required).toBe(true);
        });
        it("documents count, offset, folder, type params", function() {
            ["count", "offset", "folder", "type"].forEach(function(p) {
                expect(SCHEMA["search"].query_params[p]).toBeDefined();
            });
        });
    });

    describe("links.create body_params", function() {
        it("has path, type, accessibility as required", function() {
            expect(SCHEMA["links.create"].body_params.path.required).toBe(true);
            expect(SCHEMA["links.create"].body_params.type.required).toBe(true);
            expect(SCHEMA["links.create"].body_params.accessibility.required).toBe(true);
        });
    });

    describe("users.create body_params", function() {
        it("has userName and email as required", function() {
            expect(SCHEMA["users.create"].body_params.userName.required).toBe(true);
            expect(SCHEMA["users.create"].body_params.email.required).toBe(true);
        });
    });

    describe("groups.create body_params", function() {
        it("has displayName as required", function() {
            expect(SCHEMA["groups.create"].body_params.displayName.required).toBe(true);
        });
    });

    describe("perms body_params", function() {
        it("perms.set-user requires users object", function() {
            expect(SCHEMA["perms.set-user"].body_params.users.required).toBe(true);
        });
        it("perms.set-group requires groups object", function() {
            expect(SCHEMA["perms.set-group"].body_params.groups.required).toBe(true);
        });
        it("perms.get-by-user requires folder query param", function() {
            expect(SCHEMA["perms.get-by-user"].query_params.folder.required).toBe(true);
        });
    });

    describe("events params", function() {
        it("events.list requires id param", function() {
            expect(SCHEMA["events.list"].query_params.id.required).toBe(true);
        });
        it("events.list documents count, folder, type, suppress params", function() {
            ["count", "folder", "type", "suppress"].forEach(function(p) {
                expect(SCHEMA["events.list"].query_params[p]).toBeDefined();
            });
        });
        it("events.get-cursor uses GET", function() {
            expect(SCHEMA["events.get-cursor"].method).toBe("GET");
        });
        it("events.list uses GET", function() {
            expect(SCHEMA["events.list"].method).toBe("GET");
        });
    });

    describe("notes params", function() {
        it("notes.add requires body param", function() {
            expect(SCHEMA["notes.add"].body_params.body.required).toBe(true);
        });
        it("notes.add uses POST", function() {
            expect(SCHEMA["notes.add"].method).toBe("POST");
        });
        it("notes.delete uses DELETE", function() {
            expect(SCHEMA["notes.delete"].method).toBe("DELETE");
        });
    });

    describe("lock params", function() {
        it("lock.lock uses POST", function() {
            expect(SCHEMA["lock.lock"].method).toBe("POST");
        });
        it("lock.unlock uses POST", function() {
            expect(SCHEMA["lock.unlock"].method).toBe("POST");
        });
        it("lock.get uses GET", function() {
            expect(SCHEMA["lock.get"].method).toBe("GET");
        });
        it("lock.lock documents lock_token and lock_timeout", function() {
            expect(SCHEMA["lock.lock"].body_params.lock_token).toBeDefined();
            expect(SCHEMA["lock.lock"].body_params.lock_timeout).toBeDefined();
        });
    });

    describe("shared bulk/progress flags", function() {
        it("documents bulk flags on representative mutating commands", function() {
            ["fs.delete", "users.update", "projects.delete"].forEach(function(op) {
                expect(SCHEMA[op].flags).toBeDefined();
                expect(SCHEMA[op].flags["bulk-file-path"]).toBeDefined();
                expect(SCHEMA[op].flags.parallelism).toBeDefined();
                expect(SCHEMA[op].flags.progress).toBeDefined();
                expect(SCHEMA[op].flags["json-progress"]).toBeDefined();
            });
        });

        it("documents transfer progress flags on long-running io commands", function() {
            ["fs.download", "fs.upload-chunked"].forEach(function(op) {
                expect(SCHEMA[op].flags).toBeDefined();
                expect(SCHEMA[op].flags.progress).toBeDefined();
                expect(SCHEMA[op].flags["json-progress"]).toBeDefined();
            });
        });
    });

    // Schema truthfulness against a real Assistant API payload captured during live QA.
    // Catches schema/API drift offline: every declared field must actually appear on a
    // real response, and every real field must be documented.
    describe("ai.status response_fields match a real captured payload", function() {
        var fixture = require("./fixtures/ai-status-completed.json");
        var declaredFields = Object.keys(SCHEMA["ai.status"].response_fields);

        it("every declared field is present on the real payload, except conditional pendingActions", function() {
            declaredFields.forEach(function(field) {
                if (field === "pendingActions") return; // only present on AWAITING_USER_CONFIRMATION, not captured live
                expect(fixture[field]).not.toBeUndefined("declared field '" + field + "' is missing from the real payload");
            });
        });

        it("every field on the real payload is documented in the schema", function() {
            Object.keys(fixture).forEach(function(field) {
                expect(declaredFields).toContain(field, "real payload field '" + field + "' is undocumented in ai.status.response_fields");
            });
        });
    });

});
