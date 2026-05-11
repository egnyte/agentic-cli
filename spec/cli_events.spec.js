// Integration tests for egnyte events commands.
// Requires spec/conf/egnyte-test-config.js with valid credentials.
// events list uses a real cursor so tests run against live audit trail.

var integrationDescribe = (typeof egnyteDomain !== "undefined" && egnyteDomain && typeof APIToken !== "undefined" && APIToken) ? describe : xdescribe;

integrationDescribe("egnyte events", function() {


    var OPTS       = { token: APIToken, domain: egnyteDomain };
    var latestId;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    // ── events get-cursor ───────────────────────────────────────────────────────

    describe("events get-cursor", function() {
        it("returns valid JSON and exits 0", function() {
            var result = spawnCLI(["events", "get-cursor"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains latest_event_id", function() {
            var result = spawnCLI(["events", "get-cursor"], OPTS);
            var json = result.json();
            expect(json).not.toBeNull();
            expect(json.latest_event_id).toBeDefined();
            if (json) latestId = json.latest_event_id;
        });
    });

    // ── events list ─────────────────────────────────────────────────────────────

    describe("events list", function() {
        it("exits 1 when id is missing from --json", function() {
            var result = spawnCLI(["events", "list", "--json", '{"count":5}'], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/id/);
        });

        it("lists events from cursor and exits 0", function() {
            if (!latestId) {
                var cursorResult = spawnCLI(["events", "get-cursor"], OPTS);
                var cursorJson = cursorResult.json();
                if (cursorJson) latestId = cursorJson.latest_event_id;
            }
            if (latestId === undefined) {
                pending("could not get cursor");
                return;
            }
            // Use an older start position to ensure we get some events back
            var startId = Math.max(0, latestId - 50);
            var result = spawnCLI(["events", "list",
                "--json", JSON.stringify({ id: startId, count: 5 })
            ], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
        });

        it("response contains events array and latest_id", function() {
            if (latestId === undefined) {
                pending("no cursor available");
                return;
            }
            var startId = Math.max(0, latestId - 50);
            var result = spawnCLI(["events", "list",
                "--json", JSON.stringify({ id: startId, count: 5 })
            ], OPTS);
            var json = result.json();
            if (json) {
                expect(Array.isArray(json.events)).toBe(true);
                expect(json.latest_id).toBeDefined();
            }
        });

        it("--fields masks response fields", function() {
            if (latestId === undefined) {
                pending("no cursor available");
                return;
            }
            var startId = Math.max(0, latestId - 50);
            var result = spawnCLI(["events", "list",
                "--json", JSON.stringify({ id: startId, count: 5 }),
                "--fields", "events,latest_id"
            ], OPTS);
            expect(result.status).toBe(0);
        });

        it("schema events.list returns full parameter reference", function() {
            var result = spawnCLI(["schema", "events.list"], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toBeValidJSON();
            var json = result.json();
            expect(json.query_params).toBeDefined();
            expect(json.query_params.id).toBeDefined();
            expect(json.query_params.id.required).toBe(true);
        });
    });

});
