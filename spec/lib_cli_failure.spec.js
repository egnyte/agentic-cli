'use strict';

const { spawnSync } = require('child_process');
const { formatCliFailure } = require('./helpers/cli-failure');

function result(error, stderr) {
    return { status: 1, stderr: stderr || '', errorJson: function() { return error; } };
}

describe('safe CLI test failure diagnostics', function() {
    [403, 429, 503].forEach(function(status) {
        it('reports HTTP ' + status + ' without copying server data', function() {
            expect(formatCliFailure(result({ status: status, error: 'private response body' }))).toBe(
                'CLI exit 1, HTTP status ' + status + ', category HTTP_ERROR, stderr format JSON error'
            );
        });
    });

    [
        ["Parse Error: Content-Length can't be present with Transfer-Encoding", 'HTTP_CONFLICTING_LENGTH_HEADERS'],
        ['Parse Error: Duplicate Content-Length', 'HTTP_DUPLICATE_CONTENT_LENGTH'],
        ['Parse Error: Invalid character in Content-Length', 'HTTP_INVALID_CONTENT_LENGTH'],
        ['Parse Error: Invalid character in chunk size', 'HTTP_INVALID_CHUNK_SIZE'],
        ['Parse Error: Expected HTTP/', 'HTTP_INVALID_STATUS_LINE'],
        ['Parse Error: Header overflow', 'HTTP_HEADER_OVERFLOW'],
        ['Parse Error: private response data', 'HTTP_PARSE_ERROR'],
        ['aborted', 'RESPONSE_ABORTED'],
        ['socket hang up', 'SOCKET_HANG_UP'],
        ['Premature close', 'STREAM_PREMATURE_CLOSE'],
        ['read ECONNRESET', 'ECONNRESET'],
        ['getaddrinfo ENOTFOUND private.example', 'ENOTFOUND'],
        ['ENOSPC: no space left on device, write', 'ENOSPC'],
        ['EACCES: permission denied, open /private/path', 'EACCES'],
        ['Download timed out (no data for 5 minutes)', 'DOWNLOAD_IDLE_TIMEOUT'],
        ['certificate has expired', 'TLS_CERTIFICATE_ERROR'],
    ].forEach(function(test) {
        it('classifies ' + test[1] + ' without printing the original message', function() {
            expect(formatCliFailure(result({ error: test[0] }))).toBe(
                'CLI exit 1, HTTP status not reported, category ' + test[1] + ', stderr format JSON error'
            );
        });
    });

    it('recognizes a known machine code without echoing arbitrary code fields', function() {
        expect(formatCliFailure(result({ error: 'unknown', code: 'ERR_STREAM_PREMATURE_CLOSE' })))
            .toContain('category ERR_STREAM_PREMATURE_CLOSE');
        expect(formatCliFailure(result({ error: 'private data', code: 'private data', status: 'private data' }))).toBe(
            'CLI exit 1, HTTP status not reported, category UNCLASSIFIED, stderr format JSON error, shape private data'
        );
    });

    it('classifies uncaught non-JSON errors without exposing a stack or paths', function() {
        expect(formatCliFailure(result(null, 'TypeError: private data\n    at /private/path'))).toBe(
            'CLI exit 1, HTTP status not reported, category UNCAUGHT_JAVASCRIPT_ERROR, stderr format non-JSON'
        );
    });

    it('handles empty stderr and a process that did not exit normally', function() {
        const failure = result(null);
        failure.status = null;
        expect(formatCliFailure(failure)).toBe(
            'CLI exit not reported, HTTP status not reported, category UNCLASSIFIED, stderr format empty, shape <empty>'
        );
    });

    it('rejects out-of-range HTTP statuses and does not echo unknown stderr', function() {
        expect(formatCliFailure(result({ status: 999, error: 'unknown private data' }))).toContain('HTTP status not reported');
        expect(formatCliFailure(result(null, 'unknown private data'))).toBe(
            'CLI exit 1, HTTP status not reported, category UNCLASSIFIED, stderr format non-JSON, shape unknown private data'
        );
    });

    it('redacts identifiers, paths and hosts from the shape of an unclassified message', function() {
        expect(formatCliFailure(result({ error: 'write /tmp/a.bin token=abc123 failed' }))).toBe(
            'CLI exit 1, HTTP status not reported, category UNCLASSIFIED, stderr format JSON error, ' +
            'shape write <redacted> <redacted> failed'
        );
    });

    it('classifies a native parser error after it passes through the real CLI fatal serializer', function() {
        const failure = spawnSync(process.execPath, ['-e',
            'const {fatal}=require(process.argv[1]); const error=new Error("Parse Error: Expected HTTP/");' +
            'error.code="HPE_INVALID_CONSTANT"; fatal(error);',
            require.resolve('../src/lib/output'),
        ], { encoding: 'utf8', timeout: 5000 });
        expect(failure.status).toBe(1);
        expect(failure.stdout).toBe('');
        const payload = JSON.parse(failure.stderr);
        expect(payload.status).toBeUndefined();
        expect(payload.code).toBeUndefined();
        expect(formatCliFailure(result(payload))).toContain('category HTTP_INVALID_STATUS_LINE');
    });
});
