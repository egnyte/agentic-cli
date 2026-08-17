### 2.0.0
- **Breaking:** `ai ask` migrates from the synchronous Copilot endpoint (`/pubapi/v1/ai/copilot/ask`) to the asynchronous Assistant endpoint (`/pubapi/v1/ai/assistant/ask`) — the old endpoint is deprecated and will be removed by Egnyte on 2026-09-30
- **Breaking:** `ai ask` now submits and polls for a result (every 6 s, up to 5 min) instead of returning the answer synchronously; use `--no-wait` to return immediately with an `executionId` and check later with the new `ai status <executionId>` command
- **Breaking:** `ai ask` now requires `--yes` or `--dry-run` — Assistant executions can run tool-calls that create or modify content, so the command joins the CLI's mutation gate; the schema's `mutating` flag changes from `false` to `true` to match
- **Breaking:** the response shape changes from `{ response }` to a status object (`status`, `responseText`, `citations`, `executionId`, `conversationId`, `intent`, `pendingActions`) — scripts must check `status` before reading `responseText`
- New command: `ai status <executionId>` — check a running or abandoned `ai ask` execution
- New flag: `--no-wait` on `ai ask` — submit and return immediately, skip polling
- New `ai ask` request fields: `conversationId` (multi-turn), `mcpSelectionId`, `modelDetails`
- `ai ask` now sends an explicit whole-domain default scope (`selectedItems: {"allEgnyteSearch": true}`) when no scope is given, matching the previous endpoint's implicit behavior
- The shared poll loop used by `agents ask` is now also used by `ai ask` (extracted to `src/lib/poll.js`); `agents ask` behavior is unchanged
- `agents ask`/`agents status` now URL-encode `agentId`/`requestId`, fail clearly if the submit response lacks a `requestId`, and `--no-wait` now returns the full submit response through `--fields` instead of a fixed two-field object
- AI commands (`ai *`, `agents *`), `search`, and file content reads (`fs download`, `fs download-by-id`, `fs get-content`) now send `X-Egnyte-Ai-Safeguards-Enabled: true` so AI Safeguards policies are evaluated server-side
- OAuth login with the built-in app now captures the authorization code automatically via a local callback server on `127.0.0.1` (RFC 8252) — no manual copy-paste required, and the `state` parameter is validated to reject mismatched callbacks
- Custom `--client-id` / `--client-secret` still falls back to the previous manual copy-paste flow
- Fixed OAuth login on Windows: the browser is now launched via `rundll32 url.dll,FileProtocolHandler` so the authorization URL is no longer mangled by shell interpretation

### 1.0.0
- Initial release of @egnyte/agentic-cli — agent-first CLI for the Egnyte File System API
- Zero runtime dependencies — Node.js stdlib only (Node 14+)
- Commands: login, logout, whoami, profiles, fs get/action/delete/upload/download/download-by-id, schema
- OAuth 2.0 Authorization Code flow with multi-profile support and auto-refresh
- Agent-first design: --json passthrough, schema introspection, --fields masking, --dry-run preview, JSON-only output, input hardening, CLAUDE.md skill file
- Jasmine test suite: unit tests for validation/fields/args/schema + integration tests against real API
