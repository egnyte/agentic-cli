// Integration + dry-run tests for `egnyte agents` commands.
// Dry-run and validation tests use dummy credentials (no network calls).
// Live tests require spec/conf/egnyte-test-config.js with valid credentials and
// the Egnyte.ai scope + agents feature enabled on the token.
//
// Agent responses are non-deterministic so live tests only verify structure,
// not content. Polling tests use --no-wait to avoid long waits in CI.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte agents", function() {


    var REAL_OPTS  = { token: APIToken, domain: egnyteDomain };
    var DUMMY_OPTS = { token: "dummytoken123", domain: "https://testdomain.egnyte.com" };

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000; // agent polling can be slow
    });

    // ── agents list ───────────────────────────────────────────────────────────

    describe("agents list", function() {
        it("--dry-run prints curl GET to /pubapi/v1/ai/agents/list", function() {
            var result = spawnCLI(["agents", "list", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("/pubapi/v1/ai/agents/list");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("--dry-run respects sortBy/sortOrder from --json", function() {
            var result = spawnCLI(
                ["agents", "list", "--json", '{"sortBy":"createdOn","sortOrder":"desc"}', "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("createdOn");
        });

        it("does NOT require --yes (read-only)", function() {
            var result = spawnCLI(["agents", "list", "--dry-run"], DUMMY_OPTS);
            expect(result.status).toBe(0);
        });

        it("schema agents.list returns full parameter reference", function() {
            var result = spawnCLI(["schema", "agents.list"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.query_params.sortBy).toBeDefined();
            expect(json.query_params.sortOrder).toBeDefined();
            expect(json.endpoint).toContain("/ai/agents/list");
        });

        it("returns valid JSON against live API", function() {
            var result = spawnCLI(
                ["agents", "list", "--fields", "agentId,name,status"],
                REAL_OPTS
            );
            // Feature may not be enabled on all domains — accept 0 or structured 1
            expect([0, 1]).toContain(result.status);
            if (result.status === 1) {
                expect(result.errorJson().error).not.toMatch(/--yes/);
            } else {
                expect(result.stdout).toBeValidJSON();
            }
        });
    });

    // ── agents ask ────────────────────────────────────────────────────────────

    describe("agents ask", function() {
        it("--dry-run prints curl POST to /pubapi/v1/ai/agents/<agentId>/ask", function() {
            var result = spawnCLI(
                ["agents", "ask", "agent-123", "What is the status?", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X POST");
            expect(result.stdout).toContain("/pubapi/v1/ai/agents/agent-123/ask");
            expect(result.stdout).toContain("What is the status?");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("--dry-run body includes question", function() {
            var result = spawnCLI(
                ["agents", "ask", "agent-abc", "Summarize Q3 results", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Summarize Q3 results");
        });

        it("--dry-run body includes extra fields from --json", function() {
            var result = spawnCLI(
                ["agents", "ask", "agent-abc", "Continue analysis",
                    "--json", '{"conversationId":"conv-456","instructions":"Be concise"}',
                    "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("conv-456");
            expect(result.stdout).toContain("Be concise");
        });

        it("--dry-run body includes selectedItems from --json", function() {
            var result = spawnCLI(
                ["agents", "ask", "agent-abc", "What are the risks?",
                    "--json", '{"selectedItems":{"files":[{"entryId":"e1","filePath":"/Shared/doc.pdf"}]}}',
                    "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("selectedItems");
            expect(result.stdout).toContain("e1");
        });

        it("exits 1 when agentId is missing", function() {
            var result = spawnCLI(["agents", "ask"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 when question is missing", function() {
            var result = spawnCLI(["agents", "ask", "agent-123"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(
                ["agents", "ask", "agent-123", "test question", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
        });

        it("schema agents.ask returns full parameter reference", function() {
            var result = spawnCLI(["schema", "agents.ask"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.body_params.question).toBeDefined();
            expect(json.body_params.conversationId).toBeDefined();
            expect(json.body_params.instructions).toBeDefined();
            expect(json.body_params.selectedItems).toBeDefined();
            expect(json.endpoint).toContain("/ai/agents/");
        });
    });

    // ── agents status ─────────────────────────────────────────────────────────

    describe("agents status", function() {
        it("--dry-run prints curl GET to /pubapi/v1/ai/agents/<agentId>/ask/<requestId>/status", function() {
            var result = spawnCLI(
                ["agents", "status", "agent-123", "req-456", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("curl -X GET");
            expect(result.stdout).toContain("/pubapi/v1/ai/agents/agent-123/ask/req-456/status");
            expect(result.stdout).not.toContain("dummytoken123");
        });

        it("exits 1 when agentId is missing", function() {
            var result = spawnCLI(["agents", "status"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("exits 1 when requestId is missing", function() {
            var result = spawnCLI(["agents", "status", "agent-123"], DUMMY_OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toBeTruthy();
        });

        it("does NOT require --yes (read-only operation)", function() {
            var result = spawnCLI(
                ["agents", "status", "agent-123", "req-456", "--dry-run"],
                DUMMY_OPTS
            );
            expect(result.status).toBe(0);
        });

        it("schema agents.status returns full parameter reference", function() {
            var result = spawnCLI(["schema", "agents.status"], DUMMY_OPTS);
            expect(result.status).toBe(0);
            var json = result.json();
            expect(json.response_fields.status).toBeDefined();
            expect(json.response_fields.responseText).toBeDefined();
            expect(json.response_fields.citations).toBeDefined();
            expect(json.endpoint).toContain("/status");
        });
    });

});
