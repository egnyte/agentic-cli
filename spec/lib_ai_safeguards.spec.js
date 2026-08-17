'use strict';

const { isAiSafeguardedPath, ENABLED_HEADER, SAFEGUARDED_RESPONSE_HEADER } = require('../src/lib/ai-safeguards');

describe('ai-safeguards helpers', function() {
    it('matches AI endpoints', function() {
        expect(isAiSafeguardedPath('/pubapi/v1/ai/assistant/ask')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/assistant/exec-1/status')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/document/123/ask')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/document/123/summary')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/kb/kb-1/ask')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/agents/abc/ask')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/ai/agents/list?count=10')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/hybrid-search')).toBe(true);
    });

    it('matches search and file content reads (parity with egnyte-mcp-server)', function() {
        expect(isAiSafeguardedPath('/pubapi/v1/search')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/fs-content/Shared/report.pdf')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/fs-content/ids/file/group-1')).toBe(true);
        expect(isAiSafeguardedPath('/pubapi/v1/file-text-content/123')).toBe(true);
    });

    it('does not match deliberately excluded endpoints', function() {
        expect(isAiSafeguardedPath('/pubapi/v1/ai/kb/list')).toBe(false);              // list-kbs
        expect(isAiSafeguardedPath('/pubapi/v1/fs-content-chunked/Shared/big.zip')).toBe(false); // chunked upload
        expect(isAiSafeguardedPath('/pubapi/v1/fs/Shared')).toBe(false);               // fs metadata
        expect(isAiSafeguardedPath('/pubapi/v1/userinfo')).toBe(false);
        expect(isAiSafeguardedPath('/pubapi/v2/users')).toBe(false);
        expect(isAiSafeguardedPath(undefined)).toBe(false);
        expect(isAiSafeguardedPath(null)).toBe(false);
    });

    it('uses the exact header names from the AI Safeguards spec', function() {
        expect(ENABLED_HEADER).toBe('X-Egnyte-Ai-Safeguards-Enabled');
        expect(SAFEGUARDED_RESPONSE_HEADER).toBe('x-egnyte-ai-safeguarded');
    });
});
