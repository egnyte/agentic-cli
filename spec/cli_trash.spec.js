'use strict';

// Tests for trash command group.
// Spawns the CLI binary with dummy credentials — focus on dry-run and validation.

var path = require("path");
var fs   = require("fs");
var os   = require("os");

describe("egnyte trash — Trash API", function() {

    // Dummy credentials for dry-run tests
    var OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    describe("trash restore", function() {
        it("fails if ids array is missing in --json", function() {
            var result = spawnCLI(["trash", "restore", "--json", '{}'], OPTS);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("ids");
            expect(result.stderr).toContain("array is required");
        });

        it("prints a curl POST command with RESTORE action (v1 endpoint)", function() {
            var result = spawnCLI(
                ["trash", "restore", "--json", '{"ids":["id1"]}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs/trash");
            expect(result.stdout).toContain('"action":"RESTORE"');
            expect(result.stdout).toContain('"ids":["id1"]');
        });

        it("unconditionally sets action to RESTORE even if user provides PURGE", function() {
            var result = spawnCLI(
                ["trash", "restore", "--json", '{"ids":["id1"],"action":"PURGE"}', "--dry-run"],
                OPTS
            );
            expect(result.stdout).toContain('"action":"RESTORE"');
            expect(result.stdout).not.toContain('"action":"PURGE"');
        });
    });

    describe("trash delete", function() {
        it("fails if ids array is missing in --json", function() {
            var result = spawnCLI(["trash", "delete", "--json", '{}'], OPTS);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("ids");
            expect(result.stderr).toContain("array is required");
        });

        it("prints a curl POST command with PURGE action (v1 endpoint)", function() {
            var result = spawnCLI(
                ["trash", "delete", "--json", '{"ids":["id1"]}', "--dry-run"],
                OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/fs/trash");
            expect(result.stdout).toContain('"action":"PURGE"');
            expect(result.stdout).toContain('"ids":["id1"]');
        });
    });

    describe("validation order", function() {
        it("shows validation error before auth error", function() {
            // Run without OPTS (no token/domain) — should still hit validation first
            var result = spawnCLI(["trash", "restore", "--json", '{}'], {});
            expect(result.stderr).toContain("ids");
            expect(result.stderr).toContain("array is required");
            expect(result.stderr).not.toContain('Not authenticated');
        });
    });

});
