'use strict';

const { requireConfirmation, serializeError, CLIError } = require('../src/lib/output');

describe('requireConfirmation', function() {

    it('throws CLIError when neither --dry-run nor --yes is present', function() {
        expect(function() { requireConfirmation({}); })
            .toThrowError(CLIError, /Mutating operation requires confirmation/);
    });

    it('passes when --yes is present', function() {
        expect(function() { requireConfirmation({ yes: true }); }).not.toThrow();
    });

    it('passes when --dry-run is present', function() {
        expect(function() { requireConfirmation({ 'dry-run': true }); }).not.toThrow();
    });

    it('appends the optional reason line to the guard error', function() {
        try {
            requireConfirmation({}, 'Assistant executions can run tool-calls that create or modify content.');
            fail('expected CLIError');
        } catch (err) {
            expect(err.name).toBe('CLIError');
            expect(err.message).toContain('tool-calls that create or modify content');
            expect(err.message).toContain('--dry-run');
            expect(err.message).toContain('--yes');
        }
    });

    it('omits the reason line when not provided (existing callers unchanged)', function() {
        try {
            requireConfirmation({});
            fail('expected CLIError');
        } catch (err) {
            expect(err.message).toBe(
                'Mutating operation requires confirmation.\n' +
                '  --dry-run   Preview the request without executing\n' +
                '  --yes       Confirm and execute'
            );
        }
    });

});

describe('serializeError', function() {

    it('emits the rate-limit fields of a 429 CLIError', function() {
        const err = new CLIError('HTTP 429: rate limited, retry after 2026-10-16T00:00:00Z', {
            statusCode: 429,
            retryAfter: 53984,
            retryAt: '2026-10-16T00:00:00Z',
            rateLimit: { quota_limit: 1000, quota_used: 1000 },
        });

        expect(serializeError(err)).toEqual({
            error: 'HTTP 429: rate limited, retry after 2026-10-16T00:00:00Z',
            status: 429,
            retry_after: 53984,
            retry_at: '2026-10-16T00:00:00Z',
            _ratelimit: { quota_limit: 1000, quota_used: 1000 },
        });
    });

    it('omits the rate-limit fields when the error has none', function() {
        expect(serializeError(new CLIError('HTTP 404: not found', { statusCode: 404 })))
            .toEqual({ error: 'HTTP 404: not found', status: 404 });
    });
});
