"use strict";

const auth = require("../src/lib/auth");
const http = require("../src/lib/http");
const { parseArgs } = require("../src/lib/args");
const { CLIError } = require("../src/lib/output");
const { SCHEMA } = require("../src/lib/schema-registry");
const submitted = require("./fixtures/ai-ask-submit.json");
const completed = require("./fixtures/ai-status-completed.json");

describe("Assistant ask/status handlers (offline)", function () {
  const modulePath = require.resolve("../src/commands/ai");
  let cli,
    cachedModule,
    originalExitCode,
    now,
    plans,
    requests,
    sleeps,
    stdout,
    stderr;

  beforeEach(function () {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    now = 0;
    plans = [];
    requests = [];
    sleeps = [];
    stdout = [];
    stderr = [];
    spyOn(auth, "resolveAuth").and.resolveTo({
      domain: "https://testdomain.egnyte.com",
    });
    spyOn(http, "apiRequest").and.callFake(async function (options) {
      requests.push(Object.assign({ at: now }, options));
      const plan = plans.length ? plans.shift() : { status: "IN_PROGRESS" };
      if (plan instanceof Error) throw plan;
      return typeof plan === "function" ? plan() : plan;
    });
    spyOn(Date, "now").and.callFake(function () {
      return now;
    });
    spyOn(global, "setTimeout").and.callFake(function (fn, ms) {
      sleeps.push(ms);
      now += ms;
      fn();
      return 0;
    });
    spyOn(process.stdout, "write").and.callFake(function (s) {
      stdout.push(s);
      return true;
    });
    spyOn(process.stderr, "write").and.callFake(function (s) {
      stderr.push(s);
      return true;
    });
    cachedModule = require.cache[modulePath];
    delete require.cache[modulePath];
    cli = require(modulePath);
  });

  afterEach(function () {
    process.exitCode = originalExitCode;
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
  });

  async function run(command, flags) {
    const args = parseArgs(
      ["ai", command, command === "ask" ? "Question?" : "exec/1"].concat(
        command === "ask" ? ["--yes"] : [],
        flags || [],
      ),
    );
    await cli[command === "ask" ? "cmdAiAsk" : "cmdAiStatus"](args);
    return stdout.length ? JSON.parse(stdout.join("")) : null;
  }

  it("submits once, then polls with the documented default interval", async function () {
    plans = [submitted, completed];
    const result = await run("ask");
    expect(
      requests.map(function (r) {
        return r.method;
      }),
    ).toEqual(["POST", "GET"]);
    expect(requests[0].body).toEqual({
      question: "Question?",
      selectedItems: { allEgnyteSearch: true },
    });
    expect(requests[1].apiPath).toBe(
      "/pubapi/v1/ai/assistant/" + submitted.executionId + "/status",
    );
    expect(sleeps).toEqual([
      SCHEMA["ai.ask"].flags["poll-interval"].default * 1000,
    ]);
    expect(result).toEqual(
      Object.assign(
        {
          executionId: submitted.executionId,
          conversationId: submitted.conversationId,
        },
        completed,
      ),
    );
  });

  it("--no-wait returns only the projected submit response, without polling", async function () {
    plans = [submitted];
    expect(await run("ask", ["--no-wait", "--fields", "executionId"])).toEqual({
      executionId: submitted.executionId,
    });
    expect(requests.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  ["COMPLETED", "FAILED", "AWAITING_USER_CONFIRMATION"].forEach(
    function (status) {
      [false, true].forEach(function (exitStatus) {
        it(
          status +
            " has the documented wait exit code (opt-in=" +
            exitStatus +
            ")",
          async function () {
            plans = [{ status }];
            expect(
              (
                await run(
                  "status",
                  ["--wait"].concat(exitStatus ? ["--exit-status"] : []),
                )
              ).status,
            ).toBe(status);
            expect(process.exitCode || 0).toBe(
              exitStatus
                ? { COMPLETED: 0, FAILED: 1, AWAITING_USER_CONFIRMATION: 3 }[
                    status
                  ]
                : 0,
            );
            expect(sleeps).toEqual([]);
            expect(requests.length).toBe(1);
          },
        );
      });
    },
  );

  it("a bare status performs one encoded GET and exits 0 even for FAILED", async function () {
    plans = [{ status: "FAILED" }];
    expect(await run("status")).toEqual({
      executionId: "exec/1",
      status: "FAILED",
    });
    expect(requests[0].apiPath).toBe("/pubapi/v1/ai/assistant/exec%2F1/status");
    expect(requests.length).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("continues on unknown states and spaces subsequent requests", async function () {
    plans = [{ status: "FUTURE_STATE" }, { status: "IN_PROGRESS" }, completed];
    await run("status", ["--wait", "--poll-interval", "10"]);
    expect(
      requests.map(function (r) {
        return r.at;
      }),
    ).toEqual([0, 10000, 20000]);
    expect(sleeps).toEqual([10000, 10000]);
  });

  [false, true].forEach(function (exitStatus) {
    it(
      "timeout is a local result, with opt-in=" + exitStatus,
      async function () {
        const result = await run(
          "status",
          ["--wait", "--timeout", "5", "--poll-interval", "60"].concat(
            exitStatus ? ["--exit-status"] : [],
          ),
        );
        expect(result).toEqual({ executionId: "exec/1", status: "TIMEOUT" });
        expect(requests.length).toBe(1);
        expect(sleeps).toEqual([5000]);
        expect(process.exitCode).toBe(exitStatus ? 2 : 1);
        expect(stderr.join("")).toContain("same executionId and profile");
      },
    );
  });

  it("does not start an ask poll when its budget is shorter than the first interval", async function () {
    plans = [submitted];
    expect((await run("ask", ["--timeout", "1"])).status).toBe("TIMEOUT");
    expect(requests.length).toBe(1);
    expect(sleeps).toEqual([1000]);
  });

  it("starts the ask polling budget after submission finishes", async function () {
    plans = [
      function () {
        now += 30000;
        return submitted;
      },
      completed,
    ];
    expect((await run("ask", ["--timeout", "7"])).status).toBe("COMPLETED");
    expect(
      requests.map(function (r) {
        return r.at;
      }),
    ).toEqual([0, 36000]);
    expect(sleeps).toEqual([6000]);
    expect(process.exitCode).toBeUndefined();
  });

  [false, true].forEach(function (exitStatus) {
    it(
      "returns TIMEOUT after a late non-terminal response without another poll (opt-in=" +
        exitStatus +
        ")",
      async function () {
        plans = [
          function () {
            now += 2000;
            return {
              status: "IN_PROGRESS",
              conversationId: "conversation-late",
            };
          },
        ];
        expect(
          await run(
            "status",
            ["--wait", "--timeout", "1"].concat(
              exitStatus ? ["--exit-status"] : [],
            ),
          ),
        ).toEqual({
          executionId: "exec/1",
          conversationId: "conversation-late",
          status: "TIMEOUT",
        });
        expect(requests.length).toBe(1);
        expect(sleeps).toEqual([]);
        expect(process.exitCode).toBe(exitStatus ? 2 : 1);
      },
    );
  });

  it("allows an in-flight success to finish after the polling budget", async function () {
    plans = [
      function () {
        now += 2000;
        return completed;
      },
    ];
    expect(
      (await run("status", ["--wait", "--timeout", "1", "--exit-status"]))
        .status,
    ).toBe("COMPLETED");
    expect(process.exitCode).toBe(0);
    expect(requests.length).toBe(1);
  });

  it("preserves an HTTP error at the deadline instead of reporting a timeout", async function () {
    plans = [
      function () {
        now += 2000;
        throw new CLIError("HTTP 403", {
          statusCode: 403,
          errorCode: "DENIED",
          requestId: "req-1",
        });
      },
    ];
    expect(
      await run("status", ["--wait", "--timeout", "1", "--exit-status"]),
    ).toBeNull();
    expect(JSON.parse(stderr.join(""))).toEqual({
      error: "HTTP 403",
      status: 403,
      code: "DENIED",
      request_id: "req-1",
      executionId: "exec/1",
    });
    expect(process.exitCode).toBe(1);
    expect(requests.length).toBe(1);
  });

  it("preserves the submit ID on an ask polling error", async function () {
    plans = [submitted, new Error("connection reset")];
    expect(await run("ask")).toBeNull();
    expect(stderr.join("")).toContain(
      '"executionId":"' + submitted.executionId + '"',
    );
    expect(stderr.join("")).toContain("connection reset");
    expect(process.exitCode).toBe(1);
    expect(requests.length).toBe(2);
  });

  [null, {}, { status: "" }, { status: 42 }].forEach(function (payload) {
    it(
      "rejects malformed status " + JSON.stringify(payload),
      async function () {
        plans = [payload];
        expect(await run("status", ["--wait"])).toBeNull();
        expect(JSON.parse(stderr.join("")).error).toContain(
          'non-empty "status"',
        );
        expect(process.exitCode).toBe(1);
        expect(requests.length).toBe(1);
      },
    );
  });

  [null, {}, { executionId: " " }].forEach(function (payload) {
    it(
      "rejects malformed submit " + JSON.stringify(payload),
      async function () {
        plans = [payload];
        await expectAsync(run("ask", ["--no-wait"])).toBeRejectedWithError(
          CLIError,
          /executionId/,
        );
        expect(requests.length).toBe(1);
      },
    );
  });

  it("merges the latest server IDs before projection and does not force IDs into --fields", async function () {
    plans = [
      submitted,
      { status: "COMPLETED", conversationId: "new-conversation" },
    ];
    expect(await run("ask", ["--fields", "status,conversationId"])).toEqual({
      status: "COMPLETED",
      conversationId: "new-conversation",
    });
  });

  it("keeps a conversation ID from a prior poll when later payloads omit it", async function () {
    plans = [
      { status: "IN_PROGRESS", conversationId: "conversation-1" },
      completed,
    ];
    expect(
      await run("status", ["--wait", "--fields", "conversationId"]),
    ).toEqual({ conversationId: "conversation-1" });
  });

  it("projects timeout results and retains a supplied conversation ID without changing the ask scope", async function () {
    plans = [{ executionId: "exec-2" }];
    const result = await run("ask", [
      "--timeout",
      "1",
      "--json",
      '{"conversationId":"conversation-2"}',
      "--fields",
      "executionId,conversationId",
    ]);
    expect(result).toEqual({
      executionId: "exec-2",
      conversationId: "conversation-2",
    });
    expect(requests[0].body).toEqual({
      question: "Question?",
      conversationId: "conversation-2",
    });
    expect(process.exitCode).toBe(1);
  });

  [
    ["ask", ["--no-wait", "--timeout", "30"], /only applies while waiting/],
    [
      "ask",
      ["--no-wait", "--poll-interval", "30"],
      /only applies while waiting/,
    ],
    ["ask", ["--no-wait", "--exit-status"], /only applies while waiting/],
    ["status", ["--timeout", "30"], /only applies while waiting/],
    ["status", ["--poll-interval", "30"], /only applies while waiting/],
    ["status", ["--exit-status"], /only applies while waiting/],
    ["ask", ["--wait"], /only applies to ai status/],
    ["status", ["--no-wait"], /only applies to ai ask/],
    ["ask", ["--no-wait", "false"], /takes no value/],
    ["ask", ["--exit-status", "false"], /takes no value/],
    ["status", ["--wait", "60"], /takes no value/],
  ].forEach(function (test) {
    it(
      "rejects incompatible flags: " + test[0] + " " + test[1].join(" "),
      async function () {
        await expectAsync(run(test[0], test[1])).toBeRejectedWithError(
          CLIError,
          test[2],
        );
        expect(requests).toEqual([]);
      },
    );
  });

  ["timeout", "poll-interval"].forEach(function (flag) {
    ["0", "-1", "0.5", "86401", "abc", ""].forEach(function (value) {
      it("rejects --" + flag + " " + value, async function () {
        await expectAsync(
          run("status", ["--wait", "--" + flag, value]),
        ).toBeRejectedWithError(CLIError, /whole number of seconds/);
        expect(requests).toEqual([]);
      });
    });
  });

  it("honours the schema default budget and the upper time limits", async function () {
    await run("status", ["--wait"]);
    expect(now).toBe(SCHEMA["ai.status"].flags.timeout.default * 1000);
    plans = [completed];
    stdout = [];
    expect(
      (
        await run("status", [
          "--wait",
          "--timeout",
          "86400",
          "--poll-interval",
          "86400",
        ])
      ).status,
    ).toBe("COMPLETED");
  });

  ["ask", "status"].forEach(function (command) {
    const warning = "may exceed the AI API budget of 10 calls/min";

    it(command + " warns on stderr for --poll-interval 5", async function () {
      plans = command === "ask" ? [submitted, completed] : [completed];
      const result = await run(
        command,
        ["--poll-interval", "5"].concat(command === "status" ? ["--wait"] : []),
      );
      expect(result.status).toBe("COMPLETED");
      expect(stderr.join("")).toContain(warning);
      expect(stdout.join("")).not.toContain(warning);
    });

    ["6", "7"].forEach(function (interval) {
      it(
        command + " does not warn for --poll-interval " + interval,
        async function () {
          plans = command === "ask" ? [submitted, completed] : [completed];
          const result = await run(
            command,
            ["--poll-interval", interval].concat(
              command === "status" ? ["--wait"] : [],
            ),
          );
          expect(result.status).toBe("COMPLETED");
          expect(stderr.join("")).not.toContain(warning);
          expect(stdout.join("")).not.toContain(warning);
        },
      );
    });

    it(
      command +
        " dry-run with --poll-interval 5 previews without warning, submitting or polling",
      async function () {
        const args = parseArgs(
          [
            "ai",
            command,
            "example",
            "--dry-run",
            "--timeout",
            "60",
            "--poll-interval",
            "5",
            "--exit-status",
          ].concat(command === "status" ? ["--wait"] : []),
        );
        await cli[command === "ask" ? "cmdAiAsk" : "cmdAiStatus"](args);
        expect(stdout.join("")).toContain(
          "curl -X " + (command === "ask" ? "POST" : "GET"),
        );
        expect(stderr.join("")).not.toContain(warning);
        expect(stdout.join("")).not.toContain(warning);
        expect(requests).toEqual([]);
        expect(sleeps).toEqual([]);
      },
    );
  });

  describe("agents ask/status reuse the wait contract", function () {
    const agentsPath = require.resolve("../src/commands/agents");
    let agents;

    beforeEach(function () {
      delete require.cache[agentsPath];
      agents = require(agentsPath);
    });
    afterEach(function () {
      delete require.cache[agentsPath];
    });

    it("keeps the 2 s default and agent status path; exit code opt-in", async function () {
      plans = [{ requestId: "r1" }, { status: "FAILED" }];
      await agents.cmdAgentsAsk(
        parseArgs(["agents", "ask", "a/1", "Q?", "--exit-status"]),
      );
      expect(requests[1].apiPath).toBe(
        "/pubapi/v1/ai/agents/a%2F1/ask/r1/status",
      );
      expect(sleeps).toEqual([2000]);
      expect(JSON.parse(stdout.join(""))).toEqual({
        requestId: "r1",
        status: "FAILED",
      });
      expect(process.exitCode).toBe(1);
    });

    it("AWAITING_USER_CONFIRMATION exits 3 and timeout exits 2 with --exit-status", async function () {
      plans = [{ requestId: "r1" }, { status: "AWAITING_USER_CONFIRMATION" }];
      await agents.cmdAgentsAsk(
        parseArgs(["agents", "ask", "a", "Q?", "--exit-status"]),
      );
      expect(process.exitCode).toBe(3);

      stdout = [];
      plans = [{ requestId: "r2" }];
      await agents.cmdAgentsAsk(
        parseArgs(["agents", "ask", "a", "Q?", "--exit-status", "--timeout", "4"]),
      );
      expect(JSON.parse(stdout.join("")).status).toBe("TIMEOUT");
      expect(process.exitCode).toBe(2);
    });

    it("status is one-shot unless --wait; wait flags rejected otherwise", async function () {
      plans = [{ status: "RUNNING" }];
      await agents.cmdAgentsStatus(parseArgs(["agents", "status", "a", "r"]));
      expect(requests.length).toBe(1);
      await expectAsync(
        agents.cmdAgentsStatus(parseArgs(["agents", "status", "a", "r", "--timeout", "5"])),
      ).toBeRejectedWithError(CLIError, /only applies while waiting/);
    });
  });

  it("ask still requires confirmation before any request", async function () {
    await expectAsync(
      cli.cmdAiAsk(parseArgs(["ai", "ask", "Question?"])),
    ).toBeRejectedWithError(CLIError, /requires confirmation/);
    expect(requests).toEqual([]);
  });
});
