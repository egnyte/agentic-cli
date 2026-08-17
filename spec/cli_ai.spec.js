// Integration + dry-run tests for `egnyte ai` commands.
// Dry-run and validation tests use dummy credentials (no network calls).
// Live tests require spec/conf/egnyte-test-config.js with valid credentials and
// the Egnyte.ai scope enabled on the token.
//
// AI responses are non-deterministic so live tests only verify structure,
// not content.

var path = require("path");

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte ai", function() {


    var REAL_OPTS  = { token: APIToken, domain: egnyteDomain };
    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000; // AI calls can be slow
    });

    // ── ai ask (assistant) ────────────────────────────────────────────────────────

    describe("ai ask", function() {
        it("--dry-run prints curl POST to /pubapi/v1/ai/assistant/ask", function() {
            var result = spawnCLI(
                ["ai", "ask", "What files were modified last week?", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/assistant/ask");
            expect(result.stdout).toContain("What files were modified last week?");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("--dry-run body includes the explicit whole-domain default scope", function() {
            var result = spawnCLI(
                ["ai", "ask", "What changed?", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('"allEgnyteSearch":true');
        });

        it("--json selectedItems replaces the default scope wholesale", function() {
            var result = spawnCLI(
                ["ai", "ask", "Q3 revenue?",
                    "--json", '{"selectedItems":{"folders":[{"id":"f1"}]}}', "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('"folders":[{"id":"f1"}]');
            expect(result.stdout).not.toContain("allEgnyteSearch");
        });

        it("--json conversationId alone suppresses the default scope", function() {
            var result = spawnCLI(
                ["ai", "ask", "Now compare that to Q2",
                    "--json", '{"conversationId":"c1"}', "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('"conversationId":"c1"');
            expect(result.stdout).not.toContain("selectedItems");
        });

        it("exits 1 when question is missing", function() {
            var result = spawnCLI(["ai", "ask", "--yes"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/question/i);
        });

        it("requires --yes or --dry-run, and the guard error explains why", function() {
            var result = spawnCLI(["ai", "ask", "test question"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            var err = result.errorJson().error;
            expect(err).toMatch(/requires confirmation/i);
            expect(err).toMatch(/tool-calls that create or modify content/);
        });

        it("guard error fires before any network call (dummy domain, no ENOTFOUND)", function() {
            var result = spawnCLI(["ai", "ask", "test question"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).not.toMatch(/ENOTFOUND|network|socket/i);
        });

        it("schema ai.ask reflects the Assistant endpoint and mutating flag", function() {
            var result = spawnCLI(["schema", "ai.ask"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.endpoint).toContain("/ai/assistant/ask");
            expect(json.mutating).toBe(true);
            expect(json.body_params.question).toBeDefined();
            expect(json.body_params.selectedItems).toBeDefined();
            expect(json.body_params.conversationId).toBeDefined();
            expect(json.flags["no-wait"]).toBeDefined();
        });
    });

    // ── ai status ────────────────────────────────────────────────────────────────

    describe("ai status", function() {
        it("--dry-run prints curl GET to /pubapi/v1/ai/assistant/<executionId>/status", function() {
            var result = spawnCLI(["ai", "status", "exec-123", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("/pubapi/v1/ai/assistant/exec-123/status");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("URL-encodes the executionId in the status path", function() {
            var result = spawnCLI(["ai", "status", "exec/../123", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("/pubapi/v1/ai/assistant/exec%2F..%2F123/status");
        });

        it("exits 1 when executionId is missing", function() {
            var result = spawnCLI(["ai", "status"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/executionId/i);
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(["ai", "status", "exec-123", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
        });

        it("schema ai.status returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.status"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.response_fields.status).toBeDefined();
            expect(json.response_fields.responseText).toBeDefined();
            expect(json.response_fields.citations).toBeDefined();
            expect(json.response_fields.toolCalls).toBeDefined();
            expect(json.endpoint).toContain("/ai/assistant/");
        });
    });

    // ── ai ask-document ──────────────────────────────────────────────────────────

    describe("ai ask-document", function() {
        var aiDocPath;

        beforeAll(function() {
            // Upload a small temp file for dry-run tests that need a real entry_id
            var runId = Math.floor(Math.random() * 1e9);
            aiDocPath = testFolder + "/ai-doc-dryrun-" + runId + ".txt";
            var localTmp = require("os").tmpdir() + "/ai-doc-dryrun-" + runId + ".txt";
            require("fs").writeFileSync(localTmp, "dry-run test fixture");
            spawnCLI(["fs", "upload", aiDocPath, "--file", localTmp, "--yes"], REAL_OPTS);
        });

        afterAll(function() {
            if (aiDocPath) spawnCLI(["fs", "delete", aiDocPath, "--yes"], REAL_OPTS);
        });

        it("--dry-run prints curl POST with placeholder entry-id, no live API call", function() {
            var result = spawnCLI(
                ["ai", "ask-document", aiDocPath, "What are the key findings?", "--dry-run"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/document/<entry-id>/ask");
            expect(result.stdout).toContain("key findings");
        });

        it("--dry-run body contains the question", function() {
            var result = spawnCLI(
                ["ai", "ask-document", aiDocPath, "Payment terms?", "--dry-run"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Payment terms?");
        });

        it("exits 1 when path is missing", function() {
            var result = spawnCLI(["ai", "ask-document"], DUMMY_OPTS);
            expect(result.status).toBe(1);
        });

        it("exits 1 when question is missing", function() {
            var result = spawnCLI(["ai", "ask-document", "/Shared/report.pdf"], DUMMY_OPTS);
            expect(result.status).toBe(1);
        });

        it("exits 1 for a relative path", function() {
            var result = spawnCLI(
                ["ai", "ask-document", "relative/path.pdf", "question?", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("schema ai.ask-document returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.ask-document"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params.question).toBeDefined();
            expect(json.body_params.includeCitations).toBeDefined();
        });
    });

    // ── ai summarize ─────────────────────────────────────────────────────────────

    describe("ai summarize", function() {
        var sumDocPath;

        beforeAll(function() {
            var runId = Math.floor(Math.random() * 1e9);
            sumDocPath = testFolder + "/ai-sum-dryrun-" + runId + ".txt";
            var localTmp = require("os").tmpdir() + "/ai-sum-dryrun-" + runId + ".txt";
            require("fs").writeFileSync(localTmp, "summarize dry-run test fixture");
            spawnCLI(["fs", "upload", sumDocPath, "--file", localTmp, "--yes"], REAL_OPTS);
        });

        afterAll(function() {
            if (sumDocPath) spawnCLI(["fs", "delete", sumDocPath, "--yes"], REAL_OPTS);
        });

        it("--dry-run prints curl POST with placeholder entry-id, no live API call", function() {
            var result = spawnCLI(
                ["ai", "summarize", sumDocPath, "--dry-run"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/document/<entry-id>/summary");
        });

        it("exits 1 when path is missing", function() {
            var result = spawnCLI(["ai", "summarize"], DUMMY_OPTS);
            expect(result.status).toBe(1);
        });

        it("exits 1 for a relative path", function() {
            var result = spawnCLI(
                ["ai", "summarize", "relative/path.pdf", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/must start with \//);
        });

        it("schema ai.summarize returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.summarize"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.endpoint).toContain("/summary");
        });
    });

    // ── ai ask-kb ────────────────────────────────────────────────────────────────

    describe("ai ask-kb", function() {
        it("--dry-run prints curl POST to /pubapi/v1/ai/kb/<kb-id>/ask", function() {
            var result = spawnCLI(
                ["ai", "ask-kb", "kb-123", "What is the refund policy?", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/kb/kb-123/ask");
            expect(result.stdout).toContain("refund policy");
        });

        it("--dry-run includes includeCitations when set via --json", function() {
            var result = spawnCLI(
                ["ai", "ask-kb", "kb-123", "What is the policy?",
                    "--json", '{"includeCitations":true}', "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("includeCitations");
        });

        it("exits 1 when kb-id is missing", function() {
            var result = spawnCLI(["ai", "ask-kb"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 when question is missing", function() {
            var result = spawnCLI(["ai", "ask-kb", "kb-123"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(
                ["ai", "ask-kb", "kb-123", "test question", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
        });

        it("schema ai.ask-kb returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.ask-kb"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params.question).toBeDefined();
            expect(json.body_params.includeCitations).toBeDefined();
            expect(json.endpoint).toContain("/kb/");
        });
    });

    // ── ai list-kbs ──────────────────────────────────────────────────────────────

    describe("ai list-kbs", function() {
        it("--dry-run prints curl POST to /pubapi/v1/ai/kb/list", function() {
            var result = spawnCLI(["ai", "list-kbs", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/kb/list");
        });

        it("returns valid JSON", function() {
            var result = spawnCLI(["ai", "list-kbs"], REAL_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("accepts sort and filter params via --json", function() {
            var result = spawnCLI(
                ["ai", "list-kbs",
                    "--json", JSON.stringify({ status: ["ACTIVE"], sortBy: ["name"], sortDirection: ["ASC"] }),
                    "--fields", "content"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(["ai", "list-kbs"], REAL_OPTS);
            expect([0, 1]).toContain(result.status);
            if (result.status === 1) {
                expect(result.errorJson().error).not.toMatch(/--yes/);
            }
        });

        it("schema ai.list-kbs returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.list-kbs"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params.status).toBeDefined();
            expect(json.body_params.sortBy).toBeDefined();
            expect(json.endpoint).toContain("/kb/list");
        });
    });

    // ── ai hybrid-search ──────────────────────────────────────────────────────────

    describe("ai hybrid-search", function() {
        it("--dry-run prints curl POST to /pubapi/v1/hybrid-search", function() {
            var result = spawnCLI(
                ["ai", "hybrid-search", "quarterly report", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/hybrid-search");
            expect(result.stdout).toContain("quarterly report");
        });

        it("--dry-run includes semanticWeight and folderPath from --json", function() {
            var result = spawnCLI(
                ["ai", "hybrid-search", "contract",
                    "--json", '{"semanticWeight":0.8,"folderPath":"/Shared/Legal","limit":5}',
                    "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("semanticWeight");
            expect(result.stdout).toContain("Legal");
        });

        it("exits 1 when query is missing", function() {
            var result = spawnCLI(["ai", "hybrid-search"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(
                ["ai", "hybrid-search", "test query", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
        });

        it("schema ai.hybrid-search returns full parameter reference", function() {
            var result = spawnCLI(["schema", "ai.hybrid-search"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params.query).toBeDefined();
            expect(json.body_params.semanticWeight).toBeDefined();
            expect(json.body_params.folderPath).toBeDefined();
            expect(json.endpoint).toContain("/hybrid-search");
        });
    });

    // ── live API calls ───────────────────────────────────────────────────────────
    // These tests require the Egnyte.ai scope on the token and a file in testFolder.
    // Assistant tool-calls can write content — live tests must only ever send
    // read-only questions, and use --no-wait to conserve the AI rate budget
    // (10 calls/min, 100/day per token).

    describe("live AI calls", function() {
        it("ai ask --yes --no-wait submits and returns an executionId", function() {
            var result = spawnCLI(
                ["ai", "ask", "What types of files are stored here?", "--yes", "--no-wait"],
                REAL_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            expect(result.json().executionId).toBeDefined();
        });
    });

});
