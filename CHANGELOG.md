### 2.2.0
- New stored-profile type: `desktop_app` — resolves the access token via the `@egnyte/keyring` native library (in-process, reads the macOS Keychain / Windows Credential Manager directly) instead of reading it from `config.json`, so accounts already signed into Desktop App don't need a separate CLI login; `whoami` reports `auth_source: "desktop_app"` for these profiles
- `desktop_app` profiles authenticate with `Authorization: OAUTH oauth_token=...` and are routed from `/pubapi/...` to the OAuth-compatible `/api/...` endpoints, including `--dry-run` previews and `request`; other auth sources keep `Bearer` on `/pubapi/...`
- Keep the internal keyring addon out of npm dependencies; official macOS/Windows installer builds supply the pinned addon separately, and a static production import makes it discoverable by the binary packager
- Packaged binaries ignore the test-only `EGNYTE_KEYCHAIN_MODULE` override and always load the bundled `@egnyte/keyring`; the signed macOS CLI holds the Keychain access-group entitlement, so an injected module could otherwise read existing Desktop App tokens. The override still works in a plain Node.js checkout (test suite)
- `ai status --wait` checks immediately, then polls like `ai ask`. `--timeout <s>` / `--poll-interval <s>` configure waiting (defaults 300 / 6; whole seconds 1–86400). This is a soft polling budget, not a hard command deadline: it starts after submission for `ai ask`, and an in-flight request and its retries may finish later. Other commands and shared HTTP behaviour are unchanged.
- Optional `--exit-status` while waiting: `0` COMPLETED, `1` FAILED/API error, `2` timeout, `3` AWAITING_USER_CONFIRMATION. Without it, existing exit codes remain: `0` for a stopped execution, `1` for an error or timeout. Wait-only flags are rejected when not waiting.
- Assistant status results include `executionId` and `conversationId` when known, before normal `--fields` filtering. A local timeout returns `status: "TIMEOUT"` with those IDs; it does not cancel the execution. Status request errors retain API diagnostics and executionId on stderr. Malformed status responses fail fast.
- `fs download` / `fs download-by-id` now retry a rate-limited (`429`) or transient `5xx` response up to 3 times, honouring `Retry-After` and falling back to exponential backoff, matching the behaviour every other API call already had. Only failures raised before the first byte is written are retried, so a `--resume` download is never corrupted.
- `agents ask` / `agents status` get the same wait flags as `ai`: `--timeout <s>` (default 300), `--poll-interval <s>` (default 2), `--exit-status`, and `--wait` for `agents status`. Wait-only flags are rejected when not waiting. A local timeout now returns `status: "TIMEOUT"` with `requestId` on stdout instead of only an error.

### 2.1.1
- Every request now sends a `User-Agent` header identifying the CLI, its version, OS/architecture, and Node.js version (e.g. `agentic-cli/2.1.0 (darwin arm64) node/v22.15.1`)

### 2.1.0
- New command: `version` — print the CLI version as JSON (append-only schema; honors `--fields`)
- New flag: `--version` / `-v` — print one plain semver line (frozen format for scripts); must be the only argument; works offline with no auth or config
- Fixed `events.list` schema: `type` filter accepts event categories (`file_system`, `note`, `permission_change`), not per-event `action` values (`create`, `move`, `delete`, ...) which the API rejects; `count` documented max of 100 to match the API limit. Reported by @brodkin (GitHub PR #2).
- `events list` now returns `{"events": []}` instead of bare `null` when no events match, so callers can always read `.events` (GitHub issue #4)
- `schema` now accepts the space form used everywhere else (`egnyte schema events list` or `"events list"`) in addition to the dotted `events.list` (GitHub issue #4)
- Input-validation errors (e.g. out-of-range `count`) now surface the per-field message instead of the raw backend envelope with its internal validator code (GitHub issue #4)

### 2.0.0
- **Note:** the npm tarball for 2.0.0 contains a docs-only README fix (the path-traversal example string was changed to `secret.txt` because npm's registry content scanner rejected uploads containing the original example); the source at tag `v2.0.0` is canonical and the difference does not affect any code
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
