// End-to-end tests for `egnyte ai ask` / `egnyte ai status` against a live domain.
//
// Opt-in twice: requires credentials (spec/conf/egnyte-test-config.js OR the
// EGNYTE_TOKEN/EGNYTE_DOMAIN env vars) AND the AI_E2E=1 env var — every AI
// call spends the token's AI rate budget (10 calls/min, 100/day), so these
// must never run as part of a normal `npm test`.
//
//   AI_E2E=1 EGNYTE_TOKEN=<t> EGNYTE_DOMAIN=<url> npx jasmine spec/cli_ai_e2e.spec.js
//   AI_E2E=1 AI_E2E_FULL=1 ... npx jasmine spec/cli_ai_e2e.spec.js  # + full polled run (up to 5 min)
//
// Safety: Assistant tool-calls can create or modify content, so every question
// sent here is strictly read-only and explicitly forbids tool use.
//
// Fixtures: each test saves the raw parsed response to
// spec/fixtures/captures/<name>.json (gitignored). Once reviewed, promote a
// capture to a committed fixture file and assert structure against it —
// responseText is LLM output and differs per run, so fixtures must compare
// field presence and status values, never exact text.

var fs   = require("fs");
var path = require("path");

var E2E_TOKEN  = (typeof APIToken     !== "undefined" && APIToken)     || process.env.EGNYTE_TOKEN  || "";
var E2E_DOMAIN = (typeof egnyteDomain !== "undefined" && egnyteDomain) || process.env.EGNYTE_DOMAIN || "";

var e2eDescribe = (E2E_TOKEN && E2E_DOMAIN && process.env.AI_E2E === "1") ? describe : xdescribe;

var CAPTURE_DIR = path.join(__dirname, "fixtures", "captures");

function saveCapture(name, data) {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAPTURE_DIR, name + ".json"), JSON.stringify(data, null, 2) + "\n");
}

// Read-only by construction: no content question, no tool use.
var READ_ONLY_QUESTION = "Reply with the single word: pong. Do not use any tools and do not modify anything.";

e2eDescribe("egnyte ai assistant (e2e, live domain)", function() {

    var REAL_OPTS = { token: E2E_TOKEN, domain: E2E_DOMAIN };
    var executionId;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    });

    it("connectivity: userinfo returns the authenticated user", function() {
        var result = spawnCLI(["userinfo", "--fields", "username,email,user_type"], REAL_OPTS);
        expect(result.status).toBe(0);
        expect(result.stdout).toBeValidJSON();
        expect(result.json().username).toBeDefined();
        saveCapture("userinfo", result.json());
    });

    it("ai ask --yes --no-wait submits and returns an executionId", function() {
        var result = spawnCLI(
            ["ai", "ask", READ_ONLY_QUESTION, "--yes", "--no-wait"],
            REAL_OPTS
        );
        expect(result.status).toBe(0, "stderr: " + result.stderr);
        expect(result.stdout).toBeValidJSON();
        var json = result.json();
        expect(json.executionId).toBeDefined();
        executionId = json.executionId;
        saveCapture("ai-ask-no-wait", json);
    });

    it("ai status returns a status object for the submitted execution", function() {
        if (!executionId) return pending("no executionId — submit test did not pass");
        var result = spawnCLI(["ai", "status", executionId], REAL_OPTS);
        expect(result.status).toBe(0, "stderr: " + result.stderr);
        expect(result.stdout).toBeValidJSON();
        var json = result.json();
        expect(json.status).toBeDefined();
        saveCapture("ai-status", json);
    });

    // Full polled run — spends up to ~50 AI calls of the daily budget and can
    // take 5 minutes; opt-in separately via AI_E2E_FULL=1.
    if (process.env.AI_E2E_FULL === "1") {
        it("ai ask --yes polls to a terminal status", function() {
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 360000;
            var result = spawnCLI(
                ["ai", "ask", READ_ONLY_QUESTION, "--yes"],
                { token: E2E_TOKEN, domain: E2E_DOMAIN, timeout: 360000 }
            );
            expect(result.status).toBe(0, "stderr: " + result.stderr);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(["COMPLETED", "FAILED", "AWAITING_USER_CONFIRMATION"]).toContain(json.status);
            saveCapture("ai-ask-full-poll", json);
        });
    }

});
