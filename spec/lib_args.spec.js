// Unit tests for src/lib/args.js
// Tests the minimal argument parser.
// No network calls, no subprocess — pure in-process assertions.

var parseArgs = require("../src/lib/args").parseArgs;

describe("parseArgs", function() {

    describe("positional arguments", function() {
        it("captures a single positional arg", function() {
            expect(parseArgs(["fs"])._).toEqual(["fs"]);
        });

        it("captures multiple positional args", function() {
            expect(parseArgs(["fs", "get", "/Shared"])._).toEqual(["fs", "get", "/Shared"]);
        });

        it("returns empty _ array for no args", function() {
            expect(parseArgs([])._).toEqual([]);
        });
    });

    describe("string flags", function() {
        it("parses --domain value", function() {
            var result = parseArgs(["--domain", "mycompany"]);
            expect(result.domain).toBe("mycompany");
        });

        it("parses --fields value", function() {
            var result = parseArgs(["--fields", "name,path,size"]);
            expect(result.fields).toBe("name,path,size");
        });

        it("parses --json value", function() {
            var result = parseArgs(["--json", '{"list_content":true}']);
            expect(result.json).toBe('{"list_content":true}');
        });

        it("parses --file value", function() {
            var result = parseArgs(["--file", "./report.pdf"]);
            expect(result.file).toBe("./report.pdf");
        });

        it("parses --out value", function() {
            var result = parseArgs(["--out", "./download.pdf"]);
            expect(result.out).toBe("./download.pdf");
        });
    });

    describe("boolean flags", function() {
        it("parses --dry-run as true", function() {
            var result = parseArgs(["--dry-run"]);
            expect(result["dry-run"]).toBe(true);
        });

        it("parses --help as true", function() {
            var result = parseArgs(["--help"]);
            expect(result.help).toBe(true);
        });

        it("parses --list as true", function() {
            var result = parseArgs(["--list"]);
            expect(result.list).toBe(true);
        });
    });

    describe("mixed positional and flags", function() {
        it("correctly separates positional args and flags", function() {
            var result = parseArgs(["fs", "get", "/Shared", "--fields", "name,path", "--dry-run"]);
            expect(result._).toEqual(["fs", "get", "/Shared"]);
            expect(result.fields).toBe("name,path");
            expect(result["dry-run"]).toBe(true);
        });

        it("handles flags before positional args", function() {
            var result = parseArgs(["--domain", "myco", "login"]);
            expect(result.domain).toBe("myco");
            expect(result._).toEqual(["login"]);
        });
    });

    describe("flag without value followed by another flag", function() {
        it("treats the flag as boolean when next token starts with --", function() {
            var result = parseArgs(["--dry-run", "--list"]);
            expect(result["dry-run"]).toBe(true);
            expect(result.list).toBe(true);
        });
    });

});
