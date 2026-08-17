# Egnyte CLI — Agent Instructions

This file is read by AI coding agents (Cursor, Cline, Continue, Aider, OpenAI Codex, and others).
For Claude Code, the equivalent file is `CLAUDE.md`.

## Installation

```bash
npm install -g @egnyte/agentic-cli
```

## Authentication

### No credentials yet?

Run `egnyte whoami` first. If it returns nothing or an error, no credentials are stored.

1. Check env vars: `echo $EGNYTE_TOKEN $EGNYTE_DOMAIN` — if both set, CLI uses them automatically; skip `egnyte login`.
2. No env vars: run `egnyte login --domain https://<subdomain>.egnyte.com` — the CLI has a built-in OAuth app, no client credentials needed.

> **An AI agent must never navigate to developers.egnyte.com or attempt to register an OAuth app automatically.**

```bash
# Interactive login — only --domain required (built-in OAuth app used automatically)
egnyte login --domain https://<subdomain>.egnyte.com

# After running, the CLI opens a browser. User approves and the authorization code
# is captured automatically via a local callback server — no copy-pasting required.

# Using a custom OAuth app (optional — overrides the built-in app)
# Falls back to manual flow: after browser approval, copy the `code` from the redirect URL
# and paste it in the terminal when prompted.
egnyte login --domain https://<subdomain>.egnyte.com --client-id <id> --client-secret <secret>

# Restrict scopes if needed (space-separated)
egnyte login --domain https://<subdomain>.egnyte.com --client-id <id> --client-secret <secret> \
  --scope "Egnyte.filesystem Egnyte.user"

# CI / headless / Docker — use environment variables instead
export EGNYTE_TOKEN=<bearer-token>
export EGNYTE_DOMAIN=https://<subdomain>.egnyte.com

# Check current auth status
egnyte whoami

# Manage multiple profiles
egnyte profiles list
egnyte profiles use <name>
egnyte profiles remove <name>

# Log out
egnyte logout
```

Auth precedence (highest → lowest):
1. `--token` / `--domain` flags on the command
2. `EGNYTE_TOKEN` / `EGNYTE_DOMAIN` environment variables
3. Stored profile at `~/.config/egnyte-cli/config.json`

## Discover available operations

**Always run this first** when unsure what's available:

```bash
egnyte schema --list
egnyte schema fs.get    # full parameter reference for any operation
```

## Core rules

1. **All mutations require `--yes` or `--dry-run`** — enforced at the binary level. Always: (a) run `--dry-run` first, (b) show output to user, (c) **stop and wait for explicit user confirmation**, (d) only then run `--yes`. Never self-confirm. Never jump to `--yes` after a CLI error.
2. **Always `--fields` on list/get calls** — never return full responses. Use explicit dotted-path for envelope responses (e.g. `events.id,events.actor` not `id,actor`).
3. **Paths must start with `/`** — never pass a relative path.
4. **Never guess file IDs** — retrieve them first with `egnyte fs get`.
5. **Output is always JSON** — parse it directly, never scrape text.
6. **Use `egnyte request` for any endpoint not covered by a named command.**

## Bulk and progress

- Use `--bulk-file-path <csv>` (or `--from-csv <csv>`) on supported mutating commands to execute one CSV row per API call.
- Bulk mutations still require `--dry-run` or `--yes`.
- Use `--parallelism <n>` to control in-flight bulk requests. Default is `2` to stay within typical token QPS limits.
- Use `--progress` for human-readable stderr updates and `--json-progress` for newline-delimited machine-readable progress events.
- Keep final command results on `stdout` as JSON. Treat progress output as `stderr` only.

## Common patterns

```bash
# ── File System ────────────────────────────────────────────────────────────────

# List folder
egnyte fs get /Shared --json '{"list_content": true}' --fields files.name,files.path,files.size,folders.name,folders.path,folders.is_folder

# Get file metadata
egnyte fs get /Shared/report.pdf --fields name,size,entry_id,checksum

# Create folder
egnyte fs mkdir /Shared/NewFolder --dry-run
egnyte fs mkdir /Shared/NewFolder --yes

# Rename / Move / Copy
egnyte fs rename /Shared/old.pdf --name new.pdf --dry-run
egnyte fs rename /Shared/old.pdf --name new.pdf --yes
egnyte fs move /Shared/old.pdf --to /Shared/Archive/old.pdf --yes
egnyte fs copy /Shared/old.pdf --to /Shared/Archive/old.pdf --yes

# Delete
egnyte fs delete /Shared/old.pdf --dry-run
egnyte fs delete /Shared/old.pdf --yes

# Bulk delete / upload
egnyte fs delete --bulk-file-path ./delete.csv --dry-run
egnyte fs delete --bulk-file-path ./delete.csv --parallelism 2 --progress --yes
egnyte fs upload --bulk-file-path ./uploads.csv --parallelism 2 --json-progress --yes

# Upload / Download
egnyte fs upload /Shared/report.pdf --file ./report.pdf --yes
egnyte fs upload-chunked /Shared/bigfile.zip --file ./bigfile.zip --progress --yes
egnyte fs download /Shared/report.pdf --out ./report.pdf --progress

# Resume interrupted transfer
egnyte fs upload-chunked /Shared/bigfile.zip --file ./bigfile.zip --yes --resume --progress
egnyte fs download /Shared/report.pdf --out ./report.pdf --resume --progress

# Download by group_id (from upload response or fs get metadata)
egnyte fs download-by-id <group-id> --out ./report.pdf
egnyte fs download-by-id <group-id> --out ./report.pdf --resume

# ── Projects ──────────────────────────────────────────────────────────────────

# List all projects
egnyte projects list --fields name,id,status

# Get project details by ID
egnyte projects get a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --fields name,status

# Create project from template (v2 API)
egnyte projects create --json '{"name":"HQ Redesign","status":"pending","parentFolderId":"p1","templateFolderId":"t1","folderName":"HQ_2024"}' --yes

# Mark existing folder as project (v1 API)
egnyte projects create --json '{"name":"Site Audit","status":"in-progress","rootFolderId":"f1"}' --yes

# Update project metadata
egnyte projects update a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --json '{"status":"completed"}' --yes

# Delete project metadata (demote back to folder)
egnyte projects delete a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --yes

# ── Trash ─────────────────────────────────────────────────────────────────────

# List items in the trash (v2 API)
egnyte trash list --json '{"count": 50}' --fields items.id,items.name,items.path

# Restore items (v1 API, requires array of IDs)
egnyte trash restore --json '{"ids": ["id1", "id2"]}' --dry-run
egnyte trash restore --json '{"ids": ["id1"]}' --yes

# Permanently delete items (v1 API, action=PURGE)
egnyte trash delete --json '{"ids": ["id1"]}' --dry-run
egnyte trash delete --json '{"ids": ["id1"]}' --yes

# ── Agents ────────────────────────────────────────────────────────────────────

# List available agents
egnyte agents list --fields agentId,name,status,category

# Ask an agent (polls until COMPLETED/FAILED, up to 5 min)
egnyte agents ask <agentId> "Summarize the Q3 results" --fields responseText,citations
egnyte agents ask <agentId> "Continue our analysis" --json '{"conversationId":"<id>"}' --fields responseText

# Ask with file/folder context
egnyte agents ask <agentId> "What are the risks?" --json '{"selectedItems":{"files":[{"entryId":"<id>","filePath":"/Shared/doc.pdf"}]}}' --fields responseText,citations

# Fire-and-forget — returns requestId immediately, no polling
egnyte agents ask <agentId> "Long running task" --no-wait --fields requestId,conversationId

# Check status of a prior ask
egnyte agents status <agentId> <requestId> --fields status,responseText,citations

# ── File Content & Metadata ───────────────────────────────────────────────────

# Read text content of a file (no disk write — returns JSON string)
egnyte fs get-content /Shared/report.txt --json '{"offset":0,"limit":5000}'

# List all custom metadata namespaces and their field definitions
egnyte fs list-metadata-namespaces --fields namespace,fields

# Set custom metadata on a file (dry-run first, always)
egnyte fs set-metadata /Shared/contract.pdf --json '{"namespace":"contract","values":{"status":"signed"}}' --dry-run
egnyte fs set-metadata /Shared/contract.pdf --json '{"namespace":"contract","values":{"status":"signed"}}' --yes

# Bulk metadata updates
egnyte fs set-metadata --bulk-file-path ./metadata.csv --dry-run
egnyte fs set-metadata --bulk-file-path ./metadata.csv --parallelism 2 --yes

# ── Search ────────────────────────────────────────────────────────────────────

egnyte search "quarterly report" --json '{"count": 20}' --fields results.name,results.path,results.size

# Advanced search — metadata filters, date ranges, folder scoping
egnyte search advanced "contract" --json '{"folder":"/Shared","modified_after":"2024-01-01","custom_metadata":{"status":"signed"}}' --fields results.name,results.path

# ── Links ─────────────────────────────────────────────────────────────────────

egnyte links create --json '{"path":"/Shared/report.pdf","type":"file","accessibility":"anyone"}' --yes
egnyte links list --fields ids,total_count
egnyte links get <link-id>
egnyte links delete <link-id> --yes

# ── Users ─────────────────────────────────────────────────────────────────────

egnyte users list --fields resources.id,resources.userName,resources.email,resources.active
egnyte users get <id> --fields username,email,active
egnyte users create --json '{"userName":"jsmith","email":{"value":"j@co.com"}}' --yes
egnyte users update <id> --json '{"active": false}' --yes
egnyte users delete <id> --yes

# ── Groups ────────────────────────────────────────────────────────────────────

egnyte groups list --fields resources.id,resources.displayName
egnyte groups get <id>
egnyte groups create --json '{"displayName":"Engineering"}' --yes
egnyte groups update <id> --json '{"displayName":"Eng Team"}' --yes
egnyte groups delete <id> --yes

# ── Permissions ───────────────────────────────────────────────────────────────

egnyte perms get-user /Shared/Finance --fields users
egnyte perms set-user /Shared/Finance --json '{"users":{"jsmith":"Viewer"}}' --yes
egnyte perms delete-user /Shared/Finance --json '{"users":["jsmith"]}' --yes
egnyte perms get-group /Shared/Finance --fields groups
egnyte perms set-group /Shared/Finance --json '{"groups":{"Engineering":"Editor"}}' --yes
egnyte perms delete-group /Shared/Finance --json '{"groups":["Engineering"]}' --yes
egnyte perms get-by-user jsmith --json '{"folder":"/Shared"}'

# ── Events (Audit Trail) ──────────────────────────────────────────────────────

egnyte events get-cursor
egnyte events list --json '{"id":12345,"count":20}' --fields events.id,events.action,events.actor,events.timestamp

# ── Notes / Comments ──────────────────────────────────────────────────────────

egnyte notes add /Shared/report.pdf --json '{"body":"Please review section 3"}' --yes
egnyte notes list /Shared/report.pdf
egnyte notes get <note-id>
egnyte notes delete <note-id> --yes

# ── File Locking ──────────────────────────────────────────────────────────────

egnyte lock lock /Shared/report.pdf --yes
egnyte lock unlock /Shared/report.pdf --yes
egnyte lock get /Shared/report.pdf

# ── AI ────────────────────────────────────────────────────────────────────────

# Ask the AI Assistant (optionally scope to files or folders) — requires --yes or --dry-run;
# async: submits, then polls every 6 s (up to 5 min) unless --no-wait is used
egnyte ai ask "What are the key metrics in Q3?" --yes --fields status,responseText,citations
egnyte ai ask "Revenue trends?" --yes --json '{"selectedItems":{"folders":[{"id":"<folder-id>"}]},"includeCitations":true}' --fields status,responseText,citations
egnyte ai ask "Long-running analysis" --yes --no-wait --fields executionId
egnyte ai status <executionId> --fields status,responseText,citations

# Ask a question about a specific file (path auto-resolved to entry-id)
egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" --fields response
egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" --json '{"includeCitations":true}' --fields response,citations

# Summarize a file (path auto-resolved to entry-id)
egnyte ai summarize /Shared/Reports/annual-report.pdf --fields response

# List available Knowledge Bases
egnyte ai list-kbs --json '{"status":["ACTIVE"],"sortBy":["name"],"sortDirection":["ASC"]}' --fields content

# Query a specific Knowledge Base
egnyte ai ask-kb <kb-id> "What is the refund policy?" --json '{"includeCitations":true}' --fields response,citations

# Hybrid semantic + keyword search
egnyte ai hybrid-search "quarterly report" --json '{"semanticWeight":0.7,"folderPath":"/Shared/Finance","limit":10}' --fields results

# ── Current user info ─────────────────────────────────────────────────────────

egnyte userinfo --fields username,email,user_type

# ── Call any API endpoint directly ────────────────────────────────────────────

egnyte request /pubapi/v1/userinfo
egnyte request /pubapi/v2/users -X GET --json '{"count":10}' --fields resources.id,resources.userName
egnyte request /pubapi/v2/groups/42/members -X POST --json '{"id":7}' --yes
```

## Pagination

```bash
egnyte fs get /Shared \
  --json '{"list_content": true, "count": 50, "offset": 0}' \
  --fields files.name,files.path,files.size,folders.name,folders.path,folders.is_folder
```

Increment `offset` by `count` until `files` and `folders` are both empty.

## Rate limiting

Egnyte enforces a per-token QPS limit (varies by plan). Add `--verbose` to surface remaining quota:

```bash
egnyte fs get /Shared/report.pdf --verbose
# includes: "_ratelimit": { "qps_limit": 200, "qps_used": 1, "qps_remaining": 199, "quota_limit": 20000000, "quota_used": 42 }
```

Check `_ratelimit.qps_remaining` in bulk loops and pause when it hits 0.

## AI Safeguards

AI commands (`ai *`, `agents *`), `search`, and file content reads (`fs download`, `fs download-by-id`, `fs get-content`) automatically send `X-Egnyte-Ai-Safeguards-Enabled: true` so server-side AI Safeguards policies apply. When active, safeguarded entries are filtered from search results without updating `total_count` — paginate by `offset` until results come back empty, never by counting toward `total_count`. Downloads of safeguarded files may be redacted or denied.
