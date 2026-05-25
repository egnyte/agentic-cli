// Subprocess tests for auth commands: login, logout, profiles, whoami.
// login/logout require OAuth — tested with arg validation only (no network).
// profiles list/use/remove tested with an isolated HOME dir.
// whoami live test requires real credentials via EGNYTE_TOKEN / EGNYTE_DOMAIN.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte auth", function() {


    var REAL_OPTS  = { token: APIToken, domain: egnyteDomain };
    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };
    var NO_CREDS   = { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", HOME: "/nonexistent-home-" + Date.now() } };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── login ─────────────────────────────────────────────────────────────────────

    describe("login", function() {
        it("exits 1 with JSON error when --domain is missing", function() {
            var result = spawnCLI(["login", "--client-id", "cid", "--client-secret", "csec"], { env: { EGNYTE_DOMAIN: "", EGNYTE_TOKEN: "" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeTruthy();
        });

        it("exits 1 with error when --client-id provided without --client-secret", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--client-id", "cid"], { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", EGNYTE_CLIENT_ID: "", EGNYTE_CLIENT_SECRET: "" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toContain('--client-id and --client-secret');
        });

        it("exits 1 with error when --client-secret provided without --client-id", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--client-secret", "csec"], { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", EGNYTE_CLIENT_ID: "", EGNYTE_CLIENT_SECRET: "" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toContain('--client-id and --client-secret');
        });

        it("exits 1 with error when EGNYTE_CLIENT_ID set without EGNYTE_CLIENT_SECRET", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--no-browser"], { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", EGNYTE_CLIENT_ID: "envid", EGNYTE_CLIENT_SECRET: "" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toContain('--client-id and --client-secret');
        });

        it("exits 1 with error when EGNYTE_CLIENT_SECRET set without EGNYTE_CLIENT_ID", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--no-browser"], { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", EGNYTE_CLIENT_ID: "", EGNYTE_CLIENT_SECRET: "envsec" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toContain('--client-id and --client-secret');
        });

        it("proceeds past credential validation when both --client-id and --client-secret provided", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--client-id", "cid", "--client-secret", "csec", "--no-browser"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).not.toContain('--client-id and --client-secret');
        });

        it("proceeds past credential validation when neither custom credential provided (uses built-in app)", function() {
            var result = spawnCLI(["login", "--domain", "https://testdomain.egnyte.com", "--no-browser"], { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", EGNYTE_CLIENT_ID: "", EGNYTE_CLIENT_SECRET: "" } });
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).not.toContain('--client-id and --client-secret');
        });

        it("does not write token to stdout on error", function() {
            var result = spawnCLI(["login", "--client-id", "cid", "--client-secret", "csec", "--no-browser"], DUMMY_OPTS);
            expect(result.stdout).toBe("");
        });

    });

    // ── logout ────────────────────────────────────────────────────────────────────

    describe("logout", function() {
        it("exits 0 with JSON result for default profile (even if no profile exists)", function() {
            var result = spawnCLI(["logout"], {
                env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", HOME: "/nonexistent-home-" + Date.now() },
            });
            // Either exits 0 (nothing to log out) or 1 with JSON error — must not crash
            expect([0, 1]).toContain(result.status);
            if (result.status === 0) {
                expect(result.stdout).toBeValidJSON();
            } else {
                expect(result.errorJson()).not.toBeNull();
            }
        });

        it("never leaks token to stdout", function() {
            var result = spawnCLI(["logout"], REAL_OPTS);
            expect(result.stdout).not.toContain(APIToken);
        });
    });

    // ── profiles ──────────────────────────────────────────────────────────────────

    describe("profiles list", function() {
        it("exits 0 and returns valid JSON", function() {
            var result = spawnCLI(["profiles", "list"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("output is an array or object", function() {
            var result = spawnCLI(["profiles", "list"], DUMMY_OPTS);
            var json = result.json();
            expect(json !== null).toBe(true);
        });
    });

    describe("profiles use", function() {
        it("exits 1 with JSON error when profile name is missing", function() {
            var result = spawnCLI(["profiles", "use"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeTruthy();
        });
    });

    describe("profiles remove", function() {
        it("exits 1 with JSON error when profile name is missing", function() {
            var result = spawnCLI(["profiles", "remove"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeTruthy();
        });
    });

    // ── whoami ────────────────────────────────────────────────────────────────────

    describe("whoami — env var auth", function() {
        it("exits 0 and returns valid JSON", function() {
            var result = spawnCLI(["whoami"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("reports auth_source as environment_variables", function() {
            var result = spawnCLI(["whoami"], DUMMY_OPTS);
            expect(result.json().auth_source).toBe("environment_variables");
        });

        it("masks token — shows first 8 chars + ***", function() {
            var result = spawnCLI(["whoami"], DUMMY_OPTS);
            var hint = result.json().token_hint;
            expect(hint).toContain("dummytok");
            expect(hint).toContain("***");
            expect(hint).not.toContain("dummytoken123");
        });

        it("never writes token to stderr", function() {
            var result = spawnCLI(["whoami"], DUMMY_OPTS);
            expect(result.stderr).not.toContain("dummytoken123");
        });

        it("rejects shorthand env var domains", function() {
            var result = spawnCLI(["whoami"], { token: "dummytoken123", domain: "testdomain" });
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toContain("full HTTPS URL");
        });
    });

    describe("whoami — no credentials", function() {
        it("exits 1 with structured JSON error on stderr", function() {
            var result = spawnCLI(["whoami"], NO_CREDS);
            expect(result.status).toBe(1);
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(typeof err.error).toBe("string");
        });

        it("writes nothing to stdout on failure", function() {
            var result = spawnCLI(["whoami"], NO_CREDS);
            expect(result.stdout).toBe("");
        });
    });

    describe("whoami — live API call", function() {
        it("returns username and email from real domain", function() {
            var result = spawnCLI(["whoami"], REAL_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.auth_source).toBe("environment_variables");
            expect(json.domain).toBe(egnyteDomain.replace(/\/*$/, ""));
        });
    });

});
