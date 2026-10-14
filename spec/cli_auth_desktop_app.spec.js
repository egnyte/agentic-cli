// Subprocess tests for resolveAuth's desktop_app branch, via fs mkdir --dry-run
// (no network call), and profile guards shared with whoami. Only the native
// library is mocked (EGNYTE_KEYCHAIN_MODULE).

const fs   = require("fs");
const os   = require("os");
const path = require("path");

const mockKeychainPath = path.join(__dirname, "fixtures", "mock-egnyte-keychain.js");
const desktopAppFixture = require("./fixtures/desktop-app-profile.sample.json");

/** Writes a config.json with one desktop_app profile to a temp HOME dir. */
function makeDesktopAppProfile() {
    const tmpHome   = fs.mkdtempSync(path.join(os.tmpdir(), "egnyte-desktop-app-test-"));
    const configDir = path.join(tmpHome, ".config", "egnyte-cli");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(desktopAppFixture));
    return tmpHome;
}

describe("desktop_app profile authentication", function() {
    var tmpHome;

    beforeEach(function() {
        tmpHome = makeDesktopAppProfile();
    });

    afterEach(function() {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function opts() {
        return { env: { EGNYTE_TOKEN: "", EGNYTE_DOMAIN: "", HOME: tmpHome, EGNYTE_KEYCHAIN_MODULE: mockKeychainPath } };
    }

    it("exits 0", function() {
        var result = spawnCLI(["fs", "mkdir", "/Shared/DesktopAppTest", "--dry-run"], opts());
        expect(result.status).toBe(0);
    });

    it("resolves the token via the library and builds the request against the profile's domain", function() {
        var result = spawnCLI(["fs", "mkdir", "/Shared/DesktopAppTest", "--dry-run"], opts());
        expect(result.stdout).toContain("curl -X POST");
        expect(result.stdout).toContain("https://test.egnyte.com/api/v1/fs/Shared/DesktopAppTest");
    });

    it("does not leak the resolved token in the dry-run preview", function() {
        var result = spawnCLI(["fs", "mkdir", "/Shared/DesktopAppTest", "--dry-run"], opts());
        expect(result.stdout).not.toContain("mock-keychain-token-9999");
    });

    [
        ['agents', 'list'],
        ['ai', 'status', 'exec'],
        ['groups', 'delete', 'group'],
        ['links', 'delete', 'link'],
        ['lock', 'lock', '/Shared/file.txt'],
        ['notes', 'delete', 'note'],
        ['perms', 'set-user', '/Shared/folder', '--json', '{"users":{"test":"Viewer"}}'],
        ['projects', 'delete', 'project'],
        ['request', '/pubapi/v1/search', '--json', '{"query":"some text"}'],
        ['trash', 'restore', '--json', '{"ids":["entry"]}'],
        ['users', 'delete', 'user'],
    ].forEach(function(command) {
        it(command.slice(0, 2).join(' ') + ' previews the DA route without leaking the token', function() {
            const result = spawnCLI(command.concat(['--dry-run']), opts());
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('https://test.egnyte.com/api/');
            expect(result.stdout).not.toContain('/pubapi/');
            expect(result.stdout).not.toContain('mock-keychain-token-9999');
        });
    });

    it('bulk previews use the same DA route as single commands', function() {
        const csv = path.join(tmpHome, 'delete.csv');
        fs.writeFileSync(csv, 'path\n/Shared/a.txt\n/Shared/b.txt\n');
        const result = spawnCLI(['fs', 'delete', '--bulk-file-path', csv, '--dry-run'], opts());
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('/api/v1/fs/Shared/a.txt');
        expect(result.stdout).toContain('/api/v1/fs/Shared/b.txt');
        expect(result.stdout).not.toContain('mock-keychain-token-9999');
    });

    it('environment overrides a DA profile and keeps the public route', function() {
        const options = opts();
        options.env.EGNYTE_TOKEN = 'test-env-token';
        options.env.EGNYTE_DOMAIN = 'https://env.egnyte.com';
        const result = spawnCLI(['fs', 'mkdir', '/Shared/test', '--dry-run'], options);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('https://env.egnyte.com/pubapi/v1/fs/Shared/test');
        expect(result.stdout).not.toContain('test-env-token');
    });

    it("fails clearly when the library isn't installed", function() {
        var badOpts = opts();
        badOpts.env.EGNYTE_KEYCHAIN_MODULE = "/nonexistent/module-" + Date.now() + ".js";
        var result = spawnCLI(["fs", "mkdir", "/Shared/DesktopAppTest", "--dry-run"], badOpts);
        expect(result.status).toBe(1);
        expect(result.errorJson().error).toContain("@egnyte/keyring is not installed");
    });

    [
        ["whoami", "--fields", "auth_source"],
        ["fs", "mkdir", "/Shared/DesktopAppTest", "--dry-run"],
    ].forEach(function(args) {
        it(args[0] + " rejects a missing selected profile", function() {
            var result = spawnCLI(args.concat(["--profile", "missing-profile"]), opts());
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.errorJson().error).toContain("Not authenticated. Run: egnyte login");
        });

        it(args[0] + " rejects a non-desktop profile without a token instead of using the keyring", function() {
            const config = JSON.parse(JSON.stringify(desktopAppFixture));
            delete config.profiles[config.default_profile].source;
            fs.writeFileSync(
                path.join(tmpHome, ".config", "egnyte-cli", "config.json"), JSON.stringify(config)
            );

            var result = spawnCLI(args, opts());
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.errorJson().error).toContain("Not authenticated. Run: egnyte login");
        });
    });

    describe("profile lifecycle", function() {
        const profileName = desktopAppFixture.default_profile;

        it("login rejects overwriting a DA profile before starting OAuth", function() {
            const configPath = path.join(tmpHome, ".config", "egnyte-cli", "config.json");
            const before = fs.readFileSync(configPath, "utf8");
            const result = spawnCLI(["login", "--domain", "https://example.egnyte.com", "--profile", profileName], opts());
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toContain("set by DesktopApp");
            expect(fs.readFileSync(configPath, "utf8")).toBe(before);
        });

        [
            ["logout", ["logout"]],
            ["profiles remove", ["profiles", "remove", profileName]],
        ].forEach(function(c) {
            it(c[0] + " keeps the existing ability to remove a local profile", function() {
                const configPath = path.join(tmpHome, ".config", "egnyte-cli", "config.json");
                var result = spawnCLI(c[1], opts());
                expect(result.status).toBe(0);
                expect(JSON.parse(fs.readFileSync(configPath, "utf8")).profiles[profileName]).toBeUndefined();
            });
        });
    });
});
