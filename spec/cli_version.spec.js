// CLI subprocess tests for `egnyte --version` / `-v` and `egnyte version`.
// No network calls, no auth required — version must work offline on a clean machine.
// Contract under test (see README.md, "Version" section):
//   --version → exactly one plain semver line on stdout, exit 0, empty stderr;
//               honored only as the sole argument, errors (exit 1) otherwise
//   version   → JSON with a "version" field (append-only schema)

var os   = require("os");
var path = require("path");

var pkg = require("../package.json");

var FLAGS = ["--version", "-v"];

// Independent format guard: the plain line is frozen for external tooling, so a
// non-semver package.json version (e.g. "v2.1.0") must fail here, not at release.
var SEMVER_LINE = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?\n$/;

describe("egnyte version", function() {

    // ── --version / -v (frozen plain-text contract + sole-argument rule) ──────────

    FLAGS.forEach(function(flag) {
        describe("egnyte " + flag, function() {
            var result;

            beforeAll(function() {
                result = spawnCLI([flag]);
            });

            it("prints exactly one plain semver line matching package.json, exit 0, clean stderr", function() {
                expect(result.status).toBe(0);
                expect(result.stdout).toMatch(SEMVER_LINE);
                expect(result.stdout).toBe(pkg.version + "\n");
                expect(result.stderr).toBe("");
            });

            it("errors when combined with anything else instead of guessing", function() {
                // A version line + exit 0 while a command was skipped would look
                // like success in scripts — the CLI must refuse loudly.
                var r = spawnCLI([flag, "whoami"]);
                expect(r.status).toBe(1);
                expect(r.stdout).toBe("");
                expect(r.errorJson().error).toMatch(/must be the only argument/);
            });

            it("never displaces a command it trails", function() {
                // whoami is the probe: it reports the env credentials without a
                // network call, proving the command ran instead of the fast path.
                var r = spawnCLI(["whoami", flag]);
                expect(r.status).toBe(0);
                expect(r.json().auth_source).toBe("environment_variables");
            });
        });
    });

    it("works with no credentials and no config file", function() {
        // A nonexistent HOME / USERPROFILE hides ~/.config/egnyte-cli/config.json,
        // and empty token/domain vars prove nothing reads credentials on startup.
        var noHome  = path.join(os.tmpdir(), "egnyte-cli-no-home");
        var cleanEnv = { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", HOME: noHome, USERPROFILE: noHome };

        var flagResult = spawnCLI(["--version"], { env: cleanEnv });
        expect(flagResult.status).toBe(0);
        expect(flagResult.stdout).toBe(pkg.version + "\n");
        expect(flagResult.stderr).toBe("");

        // The subcommand traverses parseArgs → DISPATCH, so cover it too.
        var cmdResult = spawnCLI(["version"], { env: cleanEnv });
        expect(cmdResult.status).toBe(0);
        expect(cmdResult.json().version).toBe(pkg.version);
    });

    it("bare `egnyte` still prints help, not a version", function() {
        var result = spawnCLI([]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Usage: egnyte");
    });

    // ── version subcommand (JSON, append-only) ────────────────────────────────────

    describe("egnyte version (subcommand)", function() {
        var result;

        beforeAll(function() {
            result = spawnCLI(["version"]);
        });

        it("exits 0 with valid JSON on stdout", function() {
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("contains a version field matching package.json", function() {
            expect(result.json().version).toBe(pkg.version);
        });

        it("honors --fields like every other JSON command", function() {
            // A non-existent field must filter everything out — this fails if
            // cmdVersion ever stops passing args.fields through applyFields.
            var filtered = spawnCLI(["version", "--fields", "nope"]);
            expect(filtered.json()).toEqual({});
        });
    });
});
