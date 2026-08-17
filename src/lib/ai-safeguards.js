'use strict';

// AI Safeguards (see: DEL wiki "AI Safeguards technical notes").
// PubAPI endpoints that serve content to AI consumers must send this header so
// the gateway routes them to the AI Safeguards facade. Responses may then carry
// X-Egnyte-Ai-Safeguarded: true when content was redacted or filtered.
//
// The endpoint list mirrors egnyte-mcp-server's AiSafeguardsRequestInterceptor
// (CFS-74187), plus /ai/agents/ which the MCP server does not expose.

const ENABLED_HEADER = 'X-Egnyte-Ai-Safeguards-Enabled';
const SAFEGUARDED_RESPONSE_HEADER = 'x-egnyte-ai-safeguarded'; // Node lowercases response headers

// Matches: search, hybrid-search, ai ask/status/ask-document/summarize/ask-kb,
//          agents list/ask/status, fs download/download-by-id/get-content.
// Deliberately excludes list-kbs (/ai/kb/list), chunked uploads
// (/fs-content-chunked/ — no trailing-slash match) and all non-AI endpoints.
function isAiSafeguardedPath(apiPath) {
    if (typeof apiPath !== 'string') return false;
    return apiPath.includes('/search')              // /pubapi/v1/search (incl. search advanced)
        || apiPath.includes('/hybrid-search')       // /pubapi/v1/hybrid-search
        || apiPath.includes('/ai/document/')        // ask-document, summarize
        || apiPath.includes('/ai/assistant/')       // ai ask (submit + status poll)
        || (apiPath.includes('/ai/kb/') && apiPath.includes('/ask')) // ask-kb (not list-kbs)
        || apiPath.includes('/ai/agents/')          // agents (CLI addition — not in MCP reference)
        || apiPath.includes('/fs-content/')         // download, download-by-id, get-content, upload
        || apiPath.includes('/file-text-content/'); // text content (reachable via `egnyte request`)
}

module.exports = { ENABLED_HEADER, SAFEGUARDED_RESPONSE_HEADER, isAiSafeguardedPath };
