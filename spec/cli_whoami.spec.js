// Subprocess tests for egnyte whoami.
// Validates JSON-only output, auth_source field, and token masking.
// Uses env-var auth — no OAuth login required.
// Agent rule protected: Rule 7 (JSON-only output, token never fully exposed).

const fs   = require("fs");
const os   = require("os");
const path = require("path");

/**
 * Write a minimal egnyte-cli config.json to a temp HOME dir.
 * Returns the temp HOME path.
 */
function makeTempProfile(profileData) {
    const tmpHome   = fs.mkdtempSync(path.join(os.tmpdir(), "egnyte-whoami-test-"));
    const configDir = path.join(tmpHome, ".config", "egnyte-cli");
    fs.mkdirSync(configDir, { recursive: true });
    const config = {
        default_profile: "default",
        profiles: { default: profileData },
    };
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(config));
    return tmpHome;
}

/** spawnCLI opts that suppress env-var auth and use the given HOME. */
function profileOpts(tmpHome) {
    return { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", HOME: tmpHome } };
}

describe("egnyte whoami", function() {

    describe("with env var credentials", function() {
        it("exits 0", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.status).toBe(0);
        });

        it("writes valid JSON to stdout", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.stdout).toBeValidJSON();
        });

        it("reports auth_source as environment_variables", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.json().auth_source).toBe("environment_variables");
        });

        it("reports the correct domain", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.json().domain).toBe("https://mycompany.egnyte.com");
        });

        it("keeps a full Egnyte URL in normalized base-url form", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.json().domain).toBe("https://mycompany.egnyte.com");
        });

        it("masks the token — shows first 8 chars + ***", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            var hint = result.json().token_hint;
            expect(hint).toContain("abcdefgh");
            expect(hint).toContain("***");
            expect(hint).not.toContain("abcdefghij");
        });

        it("writes nothing to stderr on success", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "https://mycompany.egnyte.com" });
            expect(result.stderr).toBe("");
        });

        it("rejects shorthand domains to match the SDK", function() {
            var result = spawnCLI(["whoami"], { token: "abcdefghij", domain: "mycompany" });
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.errorJson().error).toContain("full HTTPS URL");
        });
    });

    describe("without any credentials", function() {
        it("exits 1 when no token, no domain, no stored profile", function() {
            var result = spawnCLI(["whoami"], {
                env: {
                    EGNYTE_TOKEN:  "",
                    EGNYTE_DOMAIN: "",
                    HOME: "/nonexistent-home-" + Date.now(),   // ensures no stored profile is found
                },
            });
            expect(result.status).toBe(1);
        });

        it("writes a structured JSON error to stderr", function() {
            var result = spawnCLI(["whoami"], {
                env: {
                    EGNYTE_TOKEN:  "",
                    EGNYTE_DOMAIN: "",
                    HOME: "/nonexistent-home-" + Date.now(),
                },
            });
            var err = result.errorJson();
            expect(err).not.toBeNull();
            expect(err.error).toBeDefined();
            expect(typeof err.error).toBe("string");
        });

        it("writes nothing to stdout on failure", function() {
            var result = spawnCLI(["whoami"], {
                env: {
                    EGNYTE_TOKEN:  "",
                    EGNYTE_DOMAIN: "",
                    HOME: "/nonexistent-home-" + Date.now(),
                },
            });
            expect(result.stdout).toBe("");
        });
    });

    describe("--help flag", function() {
        it("exits 0 and prints usage to stdout", function() {
            var result = spawnCLI(["--help"], { token: "x", domain: "https://y.egnyte.com" });
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("egnyte");
        });
    });

    describe("with --token and --domain flags", function() {
        it("reports auth_source as cli_flags", function() {
            var result = spawnCLI(
                ["whoami", "--token", "flagtoken123", "--domain", "https://flagco.egnyte.com"],
                { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "" } }
            );
            expect(result.status).toBe(0);
            expect(result.json().auth_source).toBe("cli_flags");
        });

        it("reports the correct domain from flag", function() {
            var result = spawnCLI(
                ["whoami", "--token", "flagtoken123", "--domain", "https://flagco.egnyte.com"],
                { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "" } }
            );
            expect(result.json().domain).toBe("https://flagco.egnyte.com");
        });

        it("masks the flag token", function() {
            var result = spawnCLI(
                ["whoami", "--token", "flagtoken123", "--domain", "https://flagco.egnyte.com"],
                { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "" } }
            );
            var hint = result.json().token_hint;
            expect(hint).toContain("flagtoke");
            expect(hint).toContain("***");
            expect(hint).not.toContain("flagtoken123");
        });
    });

    describe("with valid stored profile", function() {
        var tmpHome;

        beforeEach(function() {
            tmpHome = makeTempProfile({
                domain:       "https://stored.egnyte.com",
                access_token: "storedtoken9999",
                scope:        "Egnyte.filesystem Egnyte.user",
                expires_at:   Date.now() + 60 * 60 * 1000,  // 1 hour from now
            });
        });

        afterEach(function() {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        });

        it("exits 0", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.status).toBe(0);
        });

        it("reports auth_source as stored_profile", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().auth_source).toBe("stored_profile");
        });

        it("reports token_status as valid", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().token_status).toBe("valid");
        });

        it("reports correct domain", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().domain).toBe("https://stored.egnyte.com");
        });

        it("reports scope", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().scope).toBe("Egnyte.filesystem Egnyte.user");
        });

        it("masks the stored token", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            var hint = result.json().token_hint;
            expect(hint).toContain("storedto");
            expect(hint).toContain("***");
            expect(hint).not.toContain("storedtoken9999");
        });

        it("reports profile name", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().profile).toBe("default");
        });
    });

    describe("with expired stored profile", function() {
        var tmpHome;

        beforeEach(function() {
            tmpHome = makeTempProfile({
                domain:       "https://expired.egnyte.com",
                access_token: "expiredtoken000",
                scope:        "Egnyte.filesystem",
                expires_at:   Date.now() - 60 * 1000,  // expired 1 min ago
            });
        });

        afterEach(function() {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        });

        it("exits 0 — does not throw on expired token", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.status).toBe(0);
        });

        it("reports token_status as expired", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().token_status).toBe("expired");
        });

        it("still reports domain and scope from stored profile", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            var json = result.json();
            expect(json.domain).toBe("https://expired.egnyte.com");
            expect(json.scope).toBe("Egnyte.filesystem");
        });

        it("writes nothing to stderr — no error thrown", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.stderr).toBe("");
        });
    });

    describe("with stored profile and no expires_at", function() {
        var tmpHome;

        beforeEach(function() {
            tmpHome = makeTempProfile({
                domain:       "https://noexpiry.egnyte.com",
                access_token: "noexpirytoken1",
                scope:        "Egnyte.filesystem",
                // expires_at intentionally omitted
            });
        });

        afterEach(function() {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        });

        it("reports expires as unknown", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().expires).toBe("unknown");
        });

        it("reports token_status as valid when no expiry set", function() {
            var result = spawnCLI(["whoami"], profileOpts(tmpHome));
            expect(result.json().token_status).toBe("valid");
        });
    });

    describe("--fields filtering", function() {
        it("returns only requested fields", function() {
            var result = spawnCLI(["whoami", "--fields", "auth_source,domain"], {
                token: "abcdefghij", domain: "https://mycompany.egnyte.com",
            });
            var json = result.json();
            expect(json.auth_source).toBeDefined();
            expect(json.domain).toBeDefined();
            expect(json.token_hint).toBeUndefined();
        });
    });

});
