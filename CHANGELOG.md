### 1.0.0
- Initial release of @egnyte/agentic-cli — agent-first CLI for the Egnyte File System API
- Zero runtime dependencies — Node.js stdlib only (Node 14+)
- Commands: login, logout, whoami, profiles, fs get/action/delete/upload/download/download-by-id, schema
- OAuth 2.0 Authorization Code flow with multi-profile support and auto-refresh
- Agent-first design: --json passthrough, schema introspection, --fields masking, --dry-run preview, JSON-only output, input hardening, CLAUDE.md skill file
- Jasmine test suite: unit tests for validation/fields/args/schema + integration tests against real API
