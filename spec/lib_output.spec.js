'use strict';

const { requireConfirmation, CLIError } = require('../src/lib/output');

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
