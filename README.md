# @egnyte/agentic-cli

[![npm version](https://img.shields.io/npm/v/@egnyte/agentic-cli.svg)](https://www.npmjs.com/package/@egnyte/agentic-cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14-brightgreen.svg)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()

An **agent-first** CLI for the Egnyte API — zero runtime dependencies, JSON-only output, built-in schema introspection, and `--dry-run` safety on every mutation.

Designed for two audiences:

- **AI agents** (Claude Code, Cursor, Copilot Workspace) — self-describing schema, always-JSON output, `--fields` response masking to reduce token cost, `--dry-run` confirmation before any mutation
- **Terminal users & scripts** — clean JSON piped to `jq`, headless CI via env vars, named multi-domain profiles

## How the CLI Differs from MCP and REST APIs

Three ways to give an AI agent access to Egnyte: a REST API, an MCP server, or this CLI. They are not equivalent.

| | REST API | MCP Server | **Egnyte CLI** |
|---|---|---|---|
| **Setup** | Integrate SDK into agent runtime | Run sidecar process, wire into agent host | `npm install -g @egnyte/agentic-cli` — done |
| **Discovery** | Read API docs or OpenAPI spec | MCP tool manifest at startup | `egnyte schema --list` at runtime, no docs needed |
| **Output** | Raw HTTP response (any shape) | Tool result (host-dependent format) | Always JSON on `stdout`, errors on `stderr` |
| **Token cost** | Full response unless you parse it | Full tool result | `--fields` masks to only what you need |
| **Mutation safety** | No built-in guard | Depends on implementation | `--dry-run` on every mutating command — mandatory |
| **Auth** | Manage tokens yourself | Managed by MCP host | OAuth stored at `~/.config/egnyte-cli/config.json`, env vars for CI |
| **Dependencies** | SDK + your glue code | MCP runtime + server process | Zero runtime deps |

**REST API** — you control the full stack and need raw HTTP semantics (streaming, custom headers, webhook callbacks). Most integration work.

**MCP server** — your agent host (Cursor, Claude Desktop) supports MCP natively and you want tool-call semantics without subprocess invocation.

**This CLI** — you want an agent to operate Egnyte from any environment (terminal, CI, Claude Code, Copilot Workspace) with no runtime integration, built-in safety guards, and self-describing schema. The right default for agentic scripting and AI-assisted workflows.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Installation](#installation)
- [Authentication](#authentication)
- [Common Use Cases](#common-use-cases)
- [Commands](#commands)
  - [Schema / Discovery](#schema--discovery)
  - [File System](#file-system)
  - [Search](#search)
  - [AI](#ai)
  - [Agents](#agents)
  - [Links](#links)
  - [Users](#users)
  - [Groups](#groups)
  - [Permissions](#permissions)
  - [Events](#events)
  - [Notes](#notes)
  - [File Locking](#file-locking)
  - [Trash](#trash)
  - [Projects](#projects)
  - [User Info](#user-info)
- [Agentic Design Principles](#agentic-design-principles)
- [Using with Claude Code](#using-with-claude-code)
- [Security](#security)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Getting Started

```bash
# Install globally
npm install -g @egnyte/agentic-cli

# Authenticate — built-in OAuth app, no registration needed
egnyte login --domain https://mycompany.egnyte.com

# Verify
egnyte whoami

# List a folder
egnyte fs get /Shared --json '{"list_content": true}' --fields files.name,files.path,files.size,folders.name,folders.path,folders.is_folder
```

---

## Installation

**Requirements:** Node.js ≥ 14, npm ≥ 6

```bash
npm install -g @egnyte/agentic-cli
```

To upgrade: `npm install -g @egnyte/agentic-cli@latest`

Verify the install:

```bash
egnyte --help
egnyte schema --list   # lists all 64 available operations
```

---

## Authentication

### Option 1 — Interactive login (recommended for local use)

The CLI ships with a built-in OAuth app — no app registration required. Only `--domain` is needed:

```bash
egnyte login --domain https://mycompany.egnyte.com
```

**What happens:**
1. Browser opens to the Egnyte authorization page.
2. Log in and click **Allow**. The CLI captures the authorization code automatically via a local callback server — no copy-pasting required.
3. The token is saved and you're done.

The access token is stored at `~/.config/egnyte-cli/config.json` (file mode `0600` — owner read/write only).
If the token response omits `scope`, the CLI preserves the scopes it requested and shows the raw `scope` string in `egnyte login` / `egnyte whoami`.

**Using your own OAuth app** (optional — for custom redirect URIs, restricted scopes, or enterprise app policies):

```bash
egnyte login \
  --domain https://mycompany.egnyte.com \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET

# Equivalent via env vars
EGNYTE_DOMAIN=https://mycompany.egnyte.com \
EGNYTE_CLIENT_ID=YOUR_CLIENT_ID \
EGNYTE_CLIENT_SECRET=YOUR_CLIENT_SECRET \
egnyte login
```

When using a custom OAuth app, the CLI falls back to the manual flow: after approving in the browser, copy the `code` value from the redirect URL and paste it in the terminal when prompted.

Register your own app at [developers.egnyte.com](https://developers.egnyte.com) if needed. See the [getting started guide](https://developers.egnyte.com/api-docs/read/getting-started) for reference.

### Option 2 — Environment variables (CI / headless / AI agents)

```bash
# Runtime auth — replaces stored profile entirely
export EGNYTE_TOKEN=<bearer-token>
export EGNYTE_DOMAIN=https://mycompany.egnyte.com

# Login-time vars — alternatives to passing flags to `egnyte login`
export EGNYTE_CLIENT_ID=<client-id>
export EGNYTE_CLIENT_SECRET=<client-secret>
export EGNYTE_SCOPE="Egnyte.filesystem Egnyte.user"   # space-separated; omit for all scopes
export EGNYTE_REDIRECT_URI=https://www.egnyte.com      # default; only set if your app uses a different URI
```

No config file is read or written when `EGNYTE_TOKEN` + `EGNYTE_DOMAIN` are present.

### Auth precedence

```
--token / --domain flags
        ↓
EGNYTE_TOKEN / EGNYTE_DOMAIN env vars
        ↓
stored profile  (~/.config/egnyte-cli/config.json)
```

### Named profiles (multiple domains)

```bash
# Log in to two domains as separate profiles
egnyte login --domain https://mycompany-staging.egnyte.com --client-id <id> --client-secret <s> --profile staging
egnyte login --domain https://mycompany.egnyte.com         --client-id <id> --client-secret <s> --profile prod

# By default, login requests all scopes.
# Use --scope to restrict (space-separated) if you need limited access.
egnyte login --domain https://mycompany.egnyte.com --client-id <id> --client-secret <s> \
  --scope "Egnyte.filesystem Egnyte.user" --profile prod-readonly

# Switch the active profile
egnyte profiles use staging

# List all profiles
egnyte profiles list

# Remove a profile
egnyte profiles remove staging
```

### Token auto-refresh

If a stored token is within 5 minutes of expiry and a `refresh_token` is present, the CLI silently refreshes it before the request.

---

## Common Use Cases

**Organise files from the terminal**
Move, rename, copy, and delete files without opening the browser. Every action shows you exactly what it will do before running.
```bash
egnyte fs move /Shared/Inbox/report.pdf --to /Shared/Finance/2026/report.pdf --dry-run
egnyte fs move /Shared/Inbox/report.pdf --to /Shared/Finance/2026/report.pdf --yes
```

**Ask questions about your content**
Use the built-in AI commands to summarise documents or ask questions scoped to a specific file or folder — no separate AI setup required.
```bash
egnyte ai summarize /Shared/Contracts/acme.pdf --fields response
egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" --fields response
```

**Automate repetitive admin tasks**
Run bulk operations from a CSV — upload hundreds of files, delete a list of old folders, or update metadata across many items in one command.
```bash
egnyte fs upload --bulk-file-path ./uploads.csv --parallelism 4 --progress --yes
egnyte fs delete --bulk-file-path ./cleanup.csv --dry-run
egnyte fs delete --bulk-file-path ./cleanup.csv --parallelism 4 --progress --yes
```

**Let an AI agent manage files on your behalf**
Pair the CLI with Claude Code, Cursor, or any AI coding assistant. The agent can list, search, upload, and reorganise files — and must always show you the exact API call before touching anything.
```bash
# In Claude Code — just describe what you want:
# "Archive all PDFs older than 2024 from /Shared/Projects to /Shared/Archive/2023"
```

**Monitor file activity**
Pull the audit trail to see who changed what and when — useful for compliance checks or debugging unexpected changes.
```bash
egnyte events get-cursor
egnyte events list --json '{"id": 12345678, "count": 50}' --fields events.action,events.actor,events.timestamp
```

**Manage users and permissions from a script**
Onboard new team members, adjust folder access, or clean up stale accounts — all scriptable, all with dry-run safety.
```bash
egnyte users create --json '{"userName":"jsmith@co.com","email":{"value":"jsmith@co.com"},"active":true}' --dry-run
egnyte perms set-group /Shared/Finance --json '{"groups":{"Engineering":"Viewer"}}' --yes
```

---

## Commands

Every command outputs JSON to `stdout`. Errors are written as `{"error":"..."}` to `stderr`. Exit code is `0` on success, `1` on error.

### Global flags

| Flag | Description |
|---|---|
| `--json '{}'` | JSON request body or query params |
| `--fields a,b,c` | Return only these fields (reduces response size) |
| `--dry-run` | Print the equivalent `curl` command; do not execute |
| `--yes` | Execute a mutating command without a confirmation prompt |
| `--bulk-file-path <csv>` | Execute supported commands in bulk from a CSV file |
| `--from-csv <csv>` | Alias for `--bulk-file-path` |
| `--parallelism <n>` | Max in-flight bulk operations (default: `2`) |
| `--progress` | Human-readable progress updates on `stderr` |
| `--json-progress` | Newline-delimited JSON progress events on `stderr` |
| `--profile <name>` | Use a named profile instead of the default |
| `--token` / `--domain` | Override stored credentials for one call |

---

### Schema / Discovery

Inspect any operation at runtime — no documentation required.

```bash
# List all 64 available operations
egnyte schema --list

# Full parameter reference for a specific operation
egnyte schema fs.action
egnyte schema users.create
egnyte schema events.list
egnyte schema search.advanced
egnyte schema ai.ask-kb
```

Example output:

```json
{
  "summary": "Perform a file/folder operation: add_folder | move | copy | rename",
  "method": "POST",
  "endpoint": "/pubapi/v1/fs/{path}",
  "mutating": true,
  "body_params": {
    "action":      { "type": "string", "required": true,  "description": "add_folder | move | copy | rename" },
    "destination": { "type": "string", "required": false, "description": "Destination path (required for move and copy)" },
    "new_name":    { "type": "string", "required": false, "description": "New filename (required for rename)" }
  },
  "example": "egnyte fs action /Shared/NewFolder --json '{\"action\": \"add_folder\"}' --dry-run"
}
```

---

### File System

#### Get metadata or list folder contents

```bash
egnyte fs get <path> [--json '{}'] [--fields a,b,c]
```

```bash
# File metadata
egnyte fs get /Shared/report.pdf --fields name,path,size,entry_id

# List folder contents
egnyte fs get /Shared --json '{"list_content": true}' --fields files.name,files.path,files.size,folders.name,folders.path,folders.is_folder

# Paginate (increment offset by count until files + folders are both empty)
egnyte fs get /Shared \
  --json '{"list_content": true, "count": 50, "offset": 0}' \
  --fields files.name,files.path,files.size,folders.name,folders.path,folders.is_folder
```

#### Folder and file actions

Named subcommands (preferred):

```bash
# Create folder
egnyte fs mkdir /Shared/NewFolder --dry-run
egnyte fs mkdir /Shared/NewFolder --yes

# Rename
egnyte fs rename /Shared/report.pdf --name report-final.pdf --dry-run
egnyte fs rename /Shared/report.pdf --name report-final.pdf --yes

# Move
egnyte fs move /Shared/report.pdf --to /Shared/Archive/report.pdf --dry-run
egnyte fs move /Shared/report.pdf --to /Shared/Archive/report.pdf --yes

# Copy
egnyte fs copy /Shared/report.pdf --to /Shared/Backup/report.pdf --dry-run
egnyte fs copy /Shared/report.pdf --to /Shared/Backup/report.pdf --yes
```

Or use the lower-level `fs action` command directly:

```bash
egnyte fs action <path> --json '{"action": "<action>", ...}' [--dry-run]
```

#### Upload

```bash
# Standard upload (recommended for files ≤ 10 MB)
egnyte fs upload /Shared/docs/report.pdf --file ./report.pdf --dry-run
egnyte fs upload /Shared/docs/report.pdf --file ./report.pdf --yes

# Chunked upload (recommended for files > 10 MB)
# Minimum chunk size enforced by the Egnyte API: 10 MB (except the final chunk)
egnyte fs upload-chunked /Shared/bigfile.iso --file ./bigfile.iso --dry-run
egnyte fs upload-chunked /Shared/bigfile.iso --file ./bigfile.iso --yes

# Custom chunk size (bytes) — must be ≥ 10485760 (10 MB) except for single-chunk files
egnyte fs upload-chunked /Shared/bigfile.iso --file ./bigfile.iso --chunk-size 15728640
```

Files smaller than one chunk size automatically fall back to the standard `/fs-content` endpoint.

#### Download

Downloads are streamed directly to disk — safe for files of any size.

```bash
# Download by path
egnyte fs download /Shared/report.pdf --out ./report.pdf

# Download by group_id (from upload response or fs get metadata)
egnyte fs download-by-id <group-id> --out ./report.pdf
egnyte fs download-by-id <group-id> --out ./report.pdf --resume
```

#### Delete

```bash
egnyte fs delete <path> [--dry-run | --yes]
```

```bash
egnyte fs delete /Shared/old-report.pdf --dry-run
egnyte fs delete /Shared/old-report.pdf --yes
```

#### Read text content

Fetch file content as text without writing to disk — useful for reading docs or CSVs in an agent workflow.

```bash
egnyte fs get-content <path> [--json '{"offset":0,"limit":5000}']
```

```bash
egnyte fs get-content /Shared/notes.txt
egnyte fs get-content /Shared/data.csv --json '{"offset":0,"limit":10000}'
```

#### Custom metadata

```bash
# List all metadata namespaces and their field definitions
egnyte fs list-metadata-namespaces --fields namespace,fields

# Set custom metadata on a file — dry-run first
egnyte fs set-metadata /Shared/contract.pdf \
  --json '{"namespace":"contract","values":{"status":"signed","reviewed_by":"jsmith"}}' \
  --dry-run
egnyte fs set-metadata /Shared/contract.pdf \
  --json '{"namespace":"contract","values":{"status":"signed","reviewed_by":"jsmith"}}' \
  --yes
```

---

### Search

```bash
# Basic full-text search
egnyte search <query> [--json '{}'] [--fields a,b,c]

# Advanced search with metadata filters, date ranges, and folder scoping
egnyte search advanced <query> [--json '{}'] [--fields a,b,c]
```

```bash
# Basic search
egnyte search "quarterly report" --fields results.name,results.path,results.size

# Scoped to a folder, with pagination
egnyte search "budget" \
  --json '{"count": 20, "offset": 0, "folder": "/Shared/Finance", "type": "file"}' \
  --fields results.name,results.path,results.size

# Advanced search — date filter
egnyte search advanced "contract" \
  --json '{"folder":"/Shared/Legal","modified_after":"2024-01-01","type":"file"}' \
  --fields results.name,results.path,results.size

# Advanced search — custom metadata filter
egnyte search advanced "NDA" \
  --json '{"custom_metadata":{"status":"signed"},"namespaces":["contract"]}' \
  --fields results.name,results.path
```

---

### AI

`ai ask` runs the AI Assistant, which can execute tool-calls that create or modify content — it requires `--yes` or `--dry-run`, and submits then polls until a terminal status (up to 5 minutes; use `--no-wait` to skip waiting). Every other AI command below is read-only.

```bash
# Ask the AI Assistant (optionally scope to files or folders) — requires --yes or --dry-run
egnyte ai ask "<question>" --yes [--json '{}'] [--fields status,responseText,citations]

# Check a running or abandoned execution
egnyte ai status <executionId> [--fields status,responseText,citations]

# Ask about a specific file (path auto-resolved to entry-id)
egnyte ai ask-document <path> "<question>" [--json '{}'] [--fields a,b,c]

# Summarize a file (path auto-resolved to entry-id)
egnyte ai summarize <path> [--fields response]

# List available Knowledge Bases
egnyte ai list-kbs [--json '{}'] [--fields content]

# Query a specific Knowledge Base
egnyte ai ask-kb <kb-id> "<question>" [--json '{}'] [--fields response,citations]

# Semantic + keyword hybrid search
egnyte ai hybrid-search "<query>" [--json '{}'] [--fields results]
```

```bash
# Ask the Assistant — polls every 6 s (up to 5 min), searches the whole domain by default
egnyte ai ask "What are the key metrics in Q3?" --yes --fields status,responseText,citations

# Scope to specific files/folders (replaces the whole-domain default)
egnyte ai ask "Revenue trends?" --yes \
  --json '{"selectedItems":{"folders":[{"id":"<folder-id>"}]},"includeCitations":true}' \
  --fields status,responseText,citations

# Fire-and-forget — returns executionId immediately, check status later
egnyte ai ask "Long-running analysis" --yes --no-wait --fields executionId
egnyte ai status <executionId> --fields status,responseText,citations

# Multi-turn: continue a prior conversation
egnyte ai ask "Now compare that to Q2" --yes \
  --json '{"conversationId":"<id from prior response>"}' \
  --fields status,responseText

# Preview the request without executing (shows the request and its scope, not the tool-calls,
# which the server decides at runtime)
egnyte ai ask "What are the key metrics in Q3?" --dry-run

# Ask about a specific file
egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" --fields response
egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" \
  --json '{"includeCitations":true}' --fields response,citations

# Summarize a file
egnyte ai summarize /Shared/Reports/annual-report.pdf --fields response

# List active Knowledge Bases
egnyte ai list-kbs \
  --json '{"status":["ACTIVE"],"sortBy":["name"],"sortDirection":["ASC"]}' \
  --fields content

# Query a Knowledge Base with citations
egnyte ai ask-kb kb-abc123 "What is the refund policy?" \
  --json '{"includeCitations":true}' \
  --fields response,citations

# Hybrid search — balance semantic vs keyword matching with semanticWeight (0.0–1.0)
egnyte ai hybrid-search "quarterly report" \
  --json '{"semanticWeight":0.7,"folderPath":"/Shared/Finance","limit":10}' \
  --fields results
```

**Response status values (`ai ask` / `ai status`):** `COMPLETED` | `FAILED` | `AWAITING_USER_CONFIRMATION` — check `status` before reading `responseText`. `AWAITING_USER_CONFIRMATION` means a tool-call needs authorization that can only be granted in the Egnyte Web UI; the CLI prints `pendingActions` and exits cleanly.

`ai ask` requires `--yes` or `--dry-run` — Assistant tool-calls can create or modify content. All other AI commands (`ask-document`, `summarize`, `ask-kb`, `list-kbs`, `hybrid-search`) are read-only — `--yes` is not required.

---

### Agents

Multi-step reasoning and conversation-aware queries powered by configured Egnyte AI agents. Use agents instead of `ai ask` when you need:

- Multi-turn conversation continuity (`conversationId`)
- Custom agent behavior via `instructions`
- Complex workflows that require the agent's built-in context and tooling

The `agents ask` command is **synchronous by default** — it submits the question and polls until the agent responds (up to 5 minutes). Use `--no-wait` to fire-and-forget and check status separately.

```bash
# List all available agents
egnyte agents list --fields agentId,name,status,category

# Ask an agent — blocks until complete (polls every 2 s, 5 min timeout)
egnyte agents ask <agentId> "Summarize the Q3 results" --fields responseText,citations

# Multi-turn: continue a prior conversation
egnyte agents ask <agentId> "Now compare that to Q2" \
  --json '{"conversationId":"<id from prior response>"}' \
  --fields responseText

# Custom agent behavior for this call
egnyte agents ask <agentId> "Draft a summary" \
  --json '{"instructions":"Respond in bullet points, no more than 5 items"}' \
  --fields responseText

# Scope to specific files
egnyte agents ask <agentId> "What are the key risks?" \
  --json '{"selectedItems":{"files":[{"entryId":"<id>","filePath":"/Shared/contract.pdf"}]}}' \
  --fields responseText,citations

# Fire-and-forget — returns requestId + conversationId immediately
egnyte agents ask <agentId> "Long running analysis task" \
  --no-wait --fields requestId,conversationId

# Check status later
egnyte agents status <agentId> <requestId> --fields status,responseText,citations
```

**Response status values:** `PENDING` | `RUNNING` | `COMPLETED` | `FAILED`

All agent commands are read-only — `--yes` is not required.

---

### Links

```bash
# Create a shared link — dry-run first
egnyte links create \
  --json '{"path":"/Shared/report.pdf","type":"file","accessibility":"domain"}' \
  --dry-run

egnyte links create \
  --json '{"path":"/Shared/report.pdf","type":"file","accessibility":"anyone","expiry_date":"2026-12-31"}' \
  --fields id,url,path,accessibility --yes

# List links for a path
egnyte links list --json '{"path":"/Shared/report.pdf"}' --fields ids,total_count

# Get a link
egnyte links get <link-id> --fields id,url,path,accessibility

# Delete a link — dry-run first
egnyte links delete <link-id> --dry-run
egnyte links delete <link-id> --yes
```

`accessibility` values: `anyone` | `domain` | `password` | `recipients`

---

### Users

Uses the SCIM-compatible `/pubapi/v2/users` endpoint.

```bash
# List users
egnyte users list --json '{"count": 50}' --fields resources.id,resources.userName,resources.email,resources.active

# Get a user by numeric ID
egnyte users get <id> --fields userName,email,active,userType

# Create a user — dry-run first
egnyte users create \
  --json '{"userName":"jsmith@co.com","email":{"value":"jsmith@co.com"},"active":true,"sendInvite":false}' \
  --dry-run
egnyte users create \
  --json '{"userName":"jsmith@co.com","email":{"value":"jsmith@co.com"},"active":true,"sendInvite":false}' \
  --yes

# Update a user (PATCH — only fields you include are changed)
egnyte users update <id> --json '{"active": false}' --dry-run
egnyte users update <id> --json '{"active": false}' --yes

# Delete a user — dry-run first
egnyte users delete <id> --dry-run
egnyte users delete <id> --yes
```

---

### Groups

Uses the SCIM-compatible `/pubapi/v2/groups` endpoint.

```bash
# List groups
egnyte groups list --json '{"count": 50}' --fields resources.id,resources.displayName

# Get a group by ID
egnyte groups get <id> --fields displayName,members

# Create a group — dry-run first
egnyte groups create --json '{"displayName":"Engineering"}' --dry-run
egnyte groups create --json '{"displayName":"Engineering"}' --yes

# Update a group (rename or change members)
egnyte groups update <id> --json '{"displayName":"Eng Team"}' --dry-run
egnyte groups update <id> --json '{"displayName":"Eng Team"}' --yes

# Delete a group — dry-run first
egnyte groups delete <id> --dry-run
egnyte groups delete <id> --yes
```

---

### Permissions

Folder permission levels: `Owner` | `Editor` | `Viewer` | `None`

```bash
# Get all user permissions on a folder
egnyte perms get-user /Shared/Finance --fields users

# Set user permissions — dry-run first
egnyte perms set-user /Shared/Finance \
  --json '{"users": {"jsmith": "Viewer", "mjones": "Editor"}}' \
  --dry-run
egnyte perms set-user /Shared/Finance \
  --json '{"users": {"jsmith": "Viewer", "mjones": "Editor"}}' \
  --yes

# Remove user permissions — dry-run first
egnyte perms delete-user /Shared/Finance \
  --json '{"users": ["jsmith"]}' \
  --dry-run
egnyte perms delete-user /Shared/Finance --json '{"users": ["jsmith"]}' --yes

# Get all group permissions on a folder
egnyte perms get-group /Shared/Finance --fields groups

# Set group permissions — dry-run first
egnyte perms set-group /Shared/Finance \
  --json '{"groups": {"Engineering": "Editor"}}' \
  --dry-run
egnyte perms set-group /Shared/Finance \
  --json '{"groups": {"Engineering": "Editor"}}' \
  --yes

# Remove group permissions — dry-run first
egnyte perms delete-group /Shared/Finance \
  --json '{"groups": ["Engineering"]}' \
  --dry-run
egnyte perms delete-group /Shared/Finance --json '{"groups": ["Engineering"]}' --yes

# Get a specific user's permission level on a folder
egnyte perms get-by-user jsmith --json '{"folder": "/Shared/Finance"}'
```

---

### Events

Audit trail for file and folder activity across the domain.

```bash
# Step 1 — get the latest event ID (your polling start point)
egnyte events get-cursor

# Step 2 — list events from that ID
egnyte events list --json '{"id": 12345678, "count": 20}' --fields events.id,events.action,events.actor,events.timestamp

# Filtered — specific folder and event types
egnyte events list \
  --json '{"id": 12345678, "count": 50, "folder": "/Shared", "type": "create|move|delete"}' \
  --fields events.id,events.action,events.actor,events.timestamp,events.data
```

Event types: `create` | `move` | `delete` | `edit` | `lock` | `unlock` | `restore`

---

### Notes

Comments attached to files.

```bash
# Add a note — dry-run first
egnyte notes add /Shared/report.pdf \
  --json '{"body": "Please review section 3 before the Thursday call"}' \
  --dry-run
egnyte notes add /Shared/report.pdf \
  --json '{"body": "Please review section 3 before the Thursday call"}'

# List all notes on a file
egnyte notes list /Shared/report.pdf

# Get a note by ID
egnyte notes get <note-id>

# Delete a note — dry-run first
egnyte notes delete <note-id> --dry-run
egnyte notes delete <note-id>
```

---

### File Locking

Prevent concurrent edits by locking a file.

```bash
# Lock a file — dry-run first
egnyte lock lock /Shared/report.pdf \
  --json '{"lock_token": "my-token", "lock_timeout": 300}' \
  --dry-run
egnyte lock lock /Shared/report.pdf \
  --json '{"lock_token": "my-token", "lock_timeout": 300}'

# Check lock status
egnyte lock get /Shared/report.pdf --fields locked,lock_owner,lock_timeout

# Unlock — dry-run first
egnyte lock unlock /Shared/report.pdf \
  --json '{"lock_token": "my-token"}' \
  --dry-run
egnyte lock unlock /Shared/report.pdf --json '{"lock_token": "my-token"}'
```

---

### Trash

Manage deleted items and recovery.

```bash
# List items in the trash
egnyte trash list --json '{"count": 50}' --fields items.name,items.path,items.size,items.id

# Restore items from the trash (requires IDs from trash list)
egnyte trash restore --json '{"ids": ["item_id_1", "item_id_2"]}' --dry-run
egnyte trash restore --json '{"ids": ["item_id_1"]}' --yes

# Permanently delete items from the trash
egnyte trash delete --json '{"ids": ["item_id_1"]}' --dry-run
egnyte trash delete --json '{"ids": ["item_id_1"]}' --yes
```

---

### Projects

Manage lifecycle and metadata for project folders.

```bash
# List all project folders in the domain
egnyte projects list --fields name,id,status

# Get details for a specific project by ID
egnyte projects get a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --fields name,status

# Create a project from a template (v2 API)
egnyte projects create --json '{"name": "New HQ", "status": "pending", "parentFolderId": "...", "templateFolderId": "...", "folderName": "New HQ Folder"}' --dry-run
egnyte projects create --json '{"name": "New HQ", "status": "pending", "parentFolderId": "...", "templateFolderId": "...", "folderName": "New HQ Folder"}' --yes

# Mark an existing folder as a project (v1 API)
egnyte projects create --json '{"name": "Existing Site", "status": "in-progress", "rootFolderId": "..."}' --dry-run
egnyte projects create --json '{"name": "Existing Site", "status": "in-progress", "rootFolderId": "..."}' --yes

# Update project metadata
egnyte projects update a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --json '{"status": "completed"}' --dry-run
egnyte projects update a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --json '{"status": "completed"}' --yes

# Delete project metadata (demote back to a normal folder)
egnyte projects delete a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --dry-run
egnyte projects delete a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --yes
```

---

### User Info

Returns the authenticated user's live profile from the API — validates the stored token is still accepted by the server.

```bash
egnyte userinfo
egnyte userinfo --fields username,email,user_type
```

Unlike `egnyte whoami` (which reads stored credential metadata without a network call), `userinfo` makes a live API request and returns the user record.

---

## Agentic Design Principles

### 1. JSON-only stdout

Every response is machine-readable JSON. Errors always go to `stderr` as `{"error":"..."}`. There is no mixed prose/JSON output.

```bash
# Pipe directly to jq
egnyte fs get /Shared --json '{"list_content": true}' --fields folders.name,folders.path | jq '.folders[].path'

# Use exit codes in scripts
egnyte fs get /Shared/file.pdf --fields name && echo "exists" || echo "not found"
```

### 2. Schema introspection at runtime

Agents discover available operations and parameters without pre-loaded documentation:

```bash
egnyte schema --list          # discover all 64 operations
egnyte schema <operation>     # full parameter reference + example
```

This means agents can self-orient in a new environment without a system prompt full of API docs.

### 3. `--dry-run` on every mutation

Every command that changes state (`fs action`, `fs upload`, `fs delete`, `links create`, `users create`, etc.) supports `--dry-run`. The flag prints the exact `curl` equivalent and exits without making a network call.

```bash
egnyte fs delete /Shared/report.pdf --dry-run
```

```
curl -X DELETE 'https://mycompany.egnyte.com/pubapi/v1/fs/Shared/report.pdf' \
  -H 'Authorization: ***'
```

Bearer tokens are always masked as `***` in dry-run output.

### 4. `--fields` response masking

Limit which fields are returned to reduce response size and AI token cost:

```bash
# Without --fields: full metadata object for every file
egnyte fs get /Shared --json '{"list_content": true}'

# With --fields: only what you need
egnyte fs get /Shared --json '{"list_content": true}' --fields files.name,files.path,files.size,folders.name,folders.path
```

### 5. Bulk CSV execution

For supported mutating commands, you can run one CSV row per API call with `--bulk-file-path` (or `--from-csv`). The CLI keeps normal single-item usage unchanged and adds shared controls for concurrency and progress reporting.

```bash
# delete.csv
# path
# /Shared/old-a.pdf
# /Shared/old-b.pdf

egnyte fs delete --bulk-file-path ./delete.csv --dry-run
egnyte fs delete --bulk-file-path ./delete.csv --parallelism 2 --progress --yes
```

### 6. Rate-limit retry

On `429 Too Many Requests`, the CLI automatically retries up to 3 times, honouring the `Retry-After` response header when present and falling back to exponential backoff (1 s → 2 s → 4 s). On `5xx` server errors, the CLI retries GET and HEAD requests up to 3 times with exponential backoff and jitter; POST/PUT/DELETE fail immediately by design to avoid duplicate mutations. Agents running in a polling loop will not fail on transient rate limits or gateway hiccups.

### 7. Zero runtime dependencies

`npm install -g @egnyte/agentic-cli` installs in seconds. No `node_modules` tree to audit, no native bindings to compile.

---

## Using with Claude Code

### Setup

```bash
# Install
npm install -g @egnyte/agentic-cli

# Authenticate
egnyte login --domain https://mycompany.egnyte.com --client-id <id> --client-secret <secret>

# Add the skill file to Claude's global instructions (run from the repo root)
cat CLAUDE.md >> ~/.claude/CLAUDE.md

# Or, without cloning — download directly from npm (no auth required)
curl -fsSL https://unpkg.com/@egnyte/agentic-cli/CLAUDE.md >> ~/.claude/CLAUDE.md
```

`CLAUDE.md` is in the repo root. If you run `cat CLAUDE.md` from a different directory it will fail — use the `unpkg` URL above to download without cloning.

`CLAUDE.md` teaches Claude the core rules: always `--dry-run` before mutations, always `--fields` on list calls, never guess file IDs, paths must start with `/`.

### Example prompts

**Read operations — Claude executes immediately:**
```
What files are in /Shared/Finance?
How many PDFs are in /Shared/Projects? Show names and sizes only.
Search for "quarterly report" in /Shared
```

**Mutations — Claude dry-runs, shows the curl, then asks for confirmation:**
```
Create a folder called /Shared/2026-Archive
Upload ./report.pdf to /Shared/Finance
Rename /Shared/Finance/report.pdf to report-final.pdf
Move everything in /Shared/Inbox to /Shared/Processed
Delete /Shared/Temp
```

**Multi-step tasks:**
```
Create /Shared/Archive/Q1-2026, upload all PDFs from ./exports into it, then list what was uploaded
```

### What the dry-run confirmation looks like

When you ask Claude to delete a file, it will:

1. Run `egnyte fs delete /Shared/report.pdf --dry-run`
2. Show you the exact curl with the token masked
3. Ask for your confirmation before executing

```
curl -X DELETE 'https://mycompany.egnyte.com/pubapi/v1/fs/Shared/report.pdf' \
  -H 'Authorization: ***'

Ready to delete /Shared/report.pdf. Confirm?
```

---

## Security

### Credential storage

Tokens are stored at `~/.config/egnyte-cli/config.json` with file mode `0600` (owner read/write only — not readable by other users on the same machine).

The file contains: `access_token`, `refresh_token`, `client_id`, `client_secret`, `domain`, `expires_at`.

To remove all stored credentials:

```bash
egnyte logout                          # removes the default profile
egnyte profiles remove <name>          # removes a named profile
rm ~/.config/egnyte-cli/config.json    # nuclear option — removes everything
```

### Path validation

Every path argument is validated against six rules before any network call:

| Rule | Example blocked input |
|---|---|
| Must start with `/` | `Shared/docs` |
| No path traversal (`..`) | `/Shared/../../etc/passwd` |
| No pre-encoded slash | `/Shared%2Fdocs` |
| No double-encoded characters | `/Shared%252F` |
| No embedded query string | `/Shared?foo=bar` |
| No null byte | `/Shared%00docs` |

```bash
$ egnyte fs get /Shared/../../etc/passwd
{"error":"Invalid path — path traversal (..) detected"}
```

### AI Safeguards

Content-serving calls — AI commands (`ai *`, `agents *`), `search`, and file content
reads (`fs download`, `fs download-by-id`, `fs get-content`) — automatically send
`X-Egnyte-Ai-Safeguards-Enabled: true`, so server-side AI Safeguards policies
(content redaction, result filtering) are evaluated when enabled for the domain.
Endpoint coverage mirrors egnyte-mcp-server (CFS-74187).

When AI Safeguards are active, safeguarded entries are filtered from search results
**without updating `total_count`** — paginate by `offset` until results come back
empty rather than counting toward the total. Downloads of safeguarded files may be
redacted or denied.

---

## Development

### Prerequisites

```bash
node --version   # must be >= 14
npm --version    # must be >= 6
```

### Install from source

```bash
git clone https://github.com/egnyte/agentic-cli.git
cd agentic-cli
npm install
npm link         # installs the `egnyte` binary from local source
```

### Project structure

```
bin/egnyte                  ← shebang entry point
src/
  index.js                  ← argument parsing + command dispatch + help text
  commands/
    auth.js                 ← login, logout, whoami, profiles, userinfo
    fs.js                   ← fs get/action/mkdir/rename/move/copy/delete/upload/upload-chunked/download/download-by-id/get-content/set-metadata/list-metadata-namespaces
    search.js               ← search / search advanced
    links.js                ← links create/list/get/delete
    users.js                ← users get/list/create/update/delete
    groups.js               ← groups get/list/create/update/delete
    perms.js                ← perms get/set/delete (user + group + get-by-user)
    events.js               ← events get-cursor/list
    notes.js                ← notes add/list/get/delete
    lock.js                 ← lock lock/unlock/get
    ai.js                   ← ai ask/status/ask-document/summarize/ask-kb/list-kbs/hybrid-search
    agents.js               ← agents list/ask/status (async polling, multi-turn, --no-wait)
    schema.js               ← schema --list + schema <op>
  lib/
    args.js                 ← zero-dep argument parser
    auth.js                 ← OAuth flow, token refresh, resolveAuth()
    config.js               ← profile storage (~/.config/egnyte-cli/config.json, mode 0600)
    bulk.js                 ← --bulk-file-path CSV execution + progress events
    fields.js               ← --fields response masking
    http.js                 ← apiRequest (with 429 retry), apiDownload (streaming), buildUrl
    multipart.js            ← multipart/form-data builder for file uploads
    output.js               ← out(), fatal(), info(), printDryRun(), CLIError
    schema-registry.js      ← SCHEMA constant (61 operations)
    validation.js           ← validatePath() — 6 security rules
spec/
  lib_args.spec.js          ← unit: parseArgs
  lib_fields.spec.js        ← unit: applyFields
  lib_schema.spec.js        ← unit: SCHEMA registry (includes agents ops)
  lib_validation.spec.js    ← unit: validatePath (all 6 rules)
  cli_dryrun.spec.js        ← subprocess: --dry-run output format
  cli_whoami.spec.js        ← subprocess: whoami / auth precedence
  cli_ai.spec.js            ← dry-run + live tests for ai commands
  cli_agents.spec.js        ← dry-run + live tests for agents commands
  cli_storage.spec.js       ← integration: real Egnyte API (requires credentials)
```

### Running tests

```bash
# Integration tests against a real Egnyte domain
cp spec/conf/egnyte-test-config.template.js spec/conf/egnyte-test-config.js
# edit spec/conf/egnyte-test-config.js — set egnyteDomain and APIToken
npm run test

# Lint (syntax check — no external tools required)
npm run lint
```

### Adding a new operation

1. Implement the command function in the appropriate `src/commands/*.js` file
2. Add a schema entry in `src/lib/schema-registry.js`
3. Wire the command into the dispatch table in `src/index.js`
4. Add the operation to `EXPECTED_OPS` in `spec/lib_schema.spec.js`

---

## Contributing

1. Fork the repository and create a branch from `master`
2. Follow the existing code style (plain CommonJS, no transpilation, no runtime deps)
3. Add or update tests for any new command
4. Run `npm test` and `npm run lint` — both must pass
5. Open a pull request with a clear description of the change

**Coding conventions:**
- Plain Node.js CommonJS — no TypeScript, no build step, no bundler
- Zero runtime dependencies — stdlib only (`https`, `fs`, `path`, `os`, `url`, `crypto`, `child_process`)
- `CLIError` for user-facing errors (written to stderr as JSON); plain `Error` for unexpected failures
- Every mutating command must support `--dry-run`
- Every new operation must have a schema entry in `schema-registry.js`

---

## Questions, Bugs, and Feature Requests

Open an issue at [github.com/egnyte/agentic-cli/issues](https://github.com/egnyte/agentic-cli/issues).

---

## License

Apache-2.0
