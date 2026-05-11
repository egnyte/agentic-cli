// Unit tests for src/lib/validation.js
// Tests all 6 path validation rules.
// No network calls, no subprocess — pure in-process assertions.
// Agent rule protected: Rule 3 (paths must start with /) + Rule 4 (input hardening).

var validatePath = require("../src/lib/validation").validatePath;
var CLIError     = require("../src/lib/output").CLIError;

describe("validatePath", function() {

    describe("Rule 1 — must start with /", function() {
        it("rejects a relative path with no leading slash", function() {
            expect(function() { validatePath("docs/report.pdf"); })
                .toThrowError(CLIError, /must start with \//);
        });

        it("rejects an empty string", function() {
            expect(function() { validatePath(""); })
                .toThrowError(CLIError, /must start with \//);
        });

        it("accepts a path that starts with /", function() {
            expect(function() { validatePath("/Shared/docs/report.pdf"); }).not.toThrow();
        });

        it("accepts the root slash alone", function() {
            expect(function() { validatePath("/Shared"); }).not.toThrow();
        });
    });

    describe("Rule 2 — no path traversal (..)", function() {
        it("rejects /../ in the middle", function() {
            expect(function() { validatePath("/Shared/../etc/passwd"); })
                .toThrowError(CLIError, /path traversal/);
        });

        it("rejects /.. at the end", function() {
            expect(function() { validatePath("/Shared/docs/.."); })
                .toThrowError(CLIError, /path traversal/);
        });

        it("rejects a path whose only segment is ..", function() {
            expect(function() { validatePath("/.."); })
                .toThrowError(CLIError, /path traversal/);
        });

        it("accepts .. embedded inside a filename (release..notes.txt)", function() {
            expect(function() { validatePath("/Shared/release..notes.txt"); }).not.toThrow();
        });

        it("accepts .. embedded inside a directory name (v1..2)", function() {
            expect(function() { validatePath("/Shared/v1..2/report.pdf"); }).not.toThrow();
        });

        it("accepts a path with a single dot segment", function() {
            expect(function() { validatePath("/Shared/file.txt"); }).not.toThrow();
        });
    });

    describe("Rule 3 — no pre-encoded slashes (%2f / %2F)", function() {
        it("rejects lowercase %2f", function() {
            expect(function() { validatePath("/Shared%2ffile.pdf"); })
                .toThrowError(CLIError, /pre-encoded slash/);
        });

        it("rejects uppercase %2F", function() {
            expect(function() { validatePath("/Shared%2Ffile.pdf"); })
                .toThrowError(CLIError, /pre-encoded slash/);
        });
    });

    describe("Rule 4 — no embedded query strings (?)", function() {
        it("rejects a path with a query string", function() {
            expect(function() { validatePath("/Shared/file.pdf?foo=bar"); })
                .toThrowError(CLIError, /embedded query string/);
        });

        it("rejects a bare question mark", function() {
            expect(function() { validatePath("/Shared/?"); })
                .toThrowError(CLIError, /embedded query string/);
        });
    });

    describe("Rule 5 — no double-encoded characters (%25)", function() {
        it("rejects %25 in the path", function() {
            expect(function() { validatePath("/Shared/%25file"); })
                .toThrowError(CLIError, /double-encoded/);
        });
    });

    describe("Rule 6 — no null bytes or control characters", function() {
        it("rejects %00 (null byte)", function() {
            expect(function() { validatePath("/Shared/%00file"); })
                .toThrowError(CLIError, /null byte/);
        });

        it("rejects a path containing a literal control character", function() {
            expect(function() { validatePath("/Shared/\x01file"); })
                .toThrowError(CLIError, /control characters/);
        });
    });

    describe("Valid paths — no throw", function() {
        it("accepts a deeply nested path", function() {
            expect(function() { validatePath("/Shared/a/b/c/d/file.txt"); }).not.toThrow();
        });

        it("accepts a path with spaces (un-encoded)", function() {
            expect(function() { validatePath("/Shared/My Documents/report.pdf"); }).not.toThrow();
        });

        it("accepts a path with percent-encoded non-slash characters", function() {
            expect(function() { validatePath("/Shared/file%20name.pdf"); }).not.toThrow();
        });
    });

});
