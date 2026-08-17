'use strict';

const { CLIError } = require('./output');

/**
 * Poll an async operation until it reaches a terminal status or the deadline passes.
 *
 * Sleep-first loop with the deadline checked before each iteration — an iteration
 * whose sleep passes the deadline still fetches once. `sleep`/`now` are injectable
 * so tests can use fake timers instead of real delays.
 *
 * @param {object}   opts
 * @param {function} opts.fetchStatus     async () => status object from the API
 * @param {function} opts.isTerminal      (status) => boolean — true stops polling
 * @param {number}   opts.intervalMs      Delay between polls
 * @param {number}   opts.timeoutMs       Total time budget before giving up
 * @param {function} [opts.onProgress]    (status) => void — called once per non-terminal status
 * @param {string}   opts.timeoutMessage  CLIError message thrown on timeout
 * @param {function} [opts.sleep]         async (ms) => void — injectable for tests
 * @param {function} [opts.now]           () => epoch ms — injectable for tests
 *
 * @returns {Promise<object>} The first status for which isTerminal() returned true.
 */
async function pollUntilTerminal(opts) {
    const { fetchStatus, isTerminal, intervalMs, timeoutMs, onProgress, timeoutMessage } = opts;
    const sleep = opts.sleep || function(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); };
    const now   = opts.now   || Date.now;

    const deadline = now() + timeoutMs;

    while (now() < deadline) {
        await sleep(intervalMs);
        const status = await fetchStatus();
        if (isTerminal(status)) return status;
        if (onProgress) onProgress(status);
    }

    throw new CLIError(timeoutMessage);
}

module.exports = { pollUntilTerminal };
