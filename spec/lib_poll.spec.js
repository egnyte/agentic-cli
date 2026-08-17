'use strict';

const { pollUntilTerminal } = require('../src/lib/poll');

describe('pollUntilTerminal', function() {

    // Fake clock: now() advances by stepMs every sleep() call — no real delays.
    function fakeClock(stepMs) {
        let t = 0;
        return {
            now:   function() { return t; },
            sleep: function() { t += stepMs; return Promise.resolve(); },
        };
    }

    it('returns the first terminal status, using the caller-supplied predicate', async function() {
        const clock = fakeClock(1000);
        const statuses = [
            { status: 'IN_PROGRESS' },
            { status: 'IN_PROGRESS' },
            { status: 'COMPLETED', responseText: 'done' },
        ];
        let calls = 0;

        const result = await pollUntilTerminal({
            fetchStatus:    function() { calls += 1; return Promise.resolve(statuses.shift()); },
            isTerminal:     function(s) { return s.status === 'COMPLETED'; },
            intervalMs:     1000,
            timeoutMs:      60000,
            timeoutMessage: 'timed out',
            sleep:          clock.sleep,
            now:            clock.now,
        });

        expect(result.status).toBe('COMPLETED');
        expect(result.responseText).toBe('done');
        expect(calls).toBe(3);
    });

    it('times out with the caller message and does not start iterations past the deadline', async function() {
        const clock = fakeClock(1000);
        let calls = 0;

        try {
            await pollUntilTerminal({
                fetchStatus:    function() { calls += 1; return Promise.resolve({ status: 'IN_PROGRESS' }); },
                isTerminal:     function() { return false; },
                intervalMs:     1000,
                timeoutMs:      3000,
                timeoutMessage: 'Use `egnyte ai status <id>` to check manually.',
                sleep:          clock.sleep,
                now:            clock.now,
            });
            fail('expected CLIError');
        } catch (err) {
            expect(err.name).toBe('CLIError');
            expect(err.message).toContain('egnyte ai status');
        }

        // deadline = 3000; iterations start at t=0,1000,2000 → exactly 3 fetches, none past deadline
        expect(calls).toBe(3);
    });

    it('passes fetch errors through unchanged', async function() {
        const clock = fakeClock(1000);
        const boom = new Error('HTTP 500');

        try {
            await pollUntilTerminal({
                fetchStatus:    function() { return Promise.reject(boom); },
                isTerminal:     function() { return false; },
                intervalMs:     1000,
                timeoutMs:      60000,
                timeoutMessage: 'timed out',
                sleep:          clock.sleep,
                now:            clock.now,
            });
            fail('expected fetch error');
        } catch (err) {
            expect(err).toBe(boom);
        }
    });

    it('calls onProgress once per non-terminal status, never for the terminal one', async function() {
        const clock = fakeClock(1000);
        const statuses = [
            { status: 'PENDING' },
            { status: 'RUNNING' },
            { status: 'COMPLETED' },
        ];
        const seen = [];

        await pollUntilTerminal({
            fetchStatus:    function() { return Promise.resolve(statuses.shift()); },
            isTerminal:     function(s) { return s.status === 'COMPLETED'; },
            intervalMs:     1000,
            timeoutMs:      60000,
            timeoutMessage: 'timed out',
            onProgress:     function(s) { seen.push(s.status); },
            sleep:          clock.sleep,
            now:            clock.now,
        });

        expect(seen).toEqual(['PENDING', 'RUNNING']);
    });

});
