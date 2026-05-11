'use strict';

// Tests for projects command group.
// Spawns the CLI binary with dummy credentials — focus on dry-run and validation.

var path = require("path");
var fs   = require("fs");
var os   = require("os");

describe("egnyte projects — Projects API", function() {

    // Dummy credentials for dry-run tests
    var OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    describe("projects list", function() {
        it("calls v2/project-folders endpoint", function() {
            var result = spawnCLI(["projects", "list", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("/pubapi/v2/project-folders");
        });
    });

    describe("projects get", function() {
        it("fails if project_id is missing", function() {
            var result = spawnCLI(["projects", "get"], OPTS);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("Project ID is required");
        });

        it("calls v2/project-folders/{id} endpoint", function() {
            var result = spawnCLI(["projects", "get", "p123", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("/pubapi/v2/project-folders/p123");
        });
    });

    describe("projects create", function() {
        it("fails if name or status is missing in --json", function() {
            var result = spawnCLI(["projects", "create", "--json", '{"name":"P"}'], OPTS);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("name");
            expect(result.stderr).toContain("status");
            expect(result.stderr).toContain("required");
        });

        it("uses v1 endpoint for marking existing folder (no templateFolderId)", function() {
            var result = spawnCLI(
                ["projects", "create", "--json", '{"name":"P","status":"pending","rootFolderId":"f1"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/project-folders");
        });

        it("uses v2 endpoint for creating from template (templateFolderId present)", function() {
            var result = spawnCLI(
                ["projects", "create", "--json", '{"name":"P","status":"pending","parentFolderId":"p1","templateFolderId":"t1","folderName":"new"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v2/project-folders");
        });

        it("fails if rootFolderId is missing when not using a template", function() {
            var result = spawnCLI(
                ["projects", "create", "--json", '{"name":"P","status":"pending"}'],
                OPTS
            );
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("rootFolderId");
            expect(result.stderr).toContain("required");
        });
    });

    describe("projects update", function() {
        it("fails if project_id is missing", function() {
            var result = spawnCLI(["projects", "update"], OPTS);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("Project ID is required");
        });

        it("calls v2/project-folders/{id} PATCH endpoint", function() {
            var result = spawnCLI(
                ["projects", "update", "p123", "--json", '{"status":"completed"}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X PATCH");
            expect(result.stdout).toContain("/pubapi/v2/project-folders/p123");
        });
    });

    describe("projects delete", function() {
        it("calls v2/project-folders/{id} DELETE endpoint", function() {
            var result = spawnCLI(["projects", "delete", "p123", "--dry-run"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X DELETE");
            expect(result.stdout).toContain("/pubapi/v2/project-folders/p123");
        });
    });

    describe("validation order", function() {
        it("shows validation error before auth error", function() {
            var result = spawnCLI(["projects", "get"], {});
            expect(result.stderr).toContain("Project ID is required");
            expect(result.stderr).not.toContain('Not authenticated');
        });
    });

});
