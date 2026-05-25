// CLI subprocess helper — used by cli_dryrun, cli_whoami, and cli_storage specs.
// spawnCLI() runs bin/egnyte via node and captures stdout / stderr / exit code.
//
// Pattern: same location as egnyte-js-sdk's commonNode.js but specific to CLI testing.

const { spawnSync } = require("child_process");
const path          = require("path");

const BIN = path.resolve(__dirname, "../../../bin/egnyte");

/**
 * Spawn the CLI and return a result object.
 *
 * @param {string[]} args  CLI arguments, e.g. ["fs", "get", "/Shared"]
 * @param {object}   opts
 * @param {string}   [opts.token]   Override EGNYTE_TOKEN env var
 * @param {string}   [opts.domain]  Override EGNYTE_DOMAIN env var
 * @param {object}   [opts.env]     Extra env vars to merge
 * @param {number}   [opts.timeout] Timeout in ms (default 30000)
 *
 * @returns {{ stdout, stderr, status, json(), errorJson() }}
 */
global.spawnCLI = function spawnCLI(args, opts) {
    opts = opts || {};
    const env = Object.assign({}, process.env, {
        EGNYTE_TOKEN:  opts.token  || global.APIToken     || "dummy-token",
        EGNYTE_DOMAIN: opts.domain || global.egnyteDomain || "https://testdomain.egnyte.com",
    }, opts.env || {});

    const result = spawnSync("node", [BIN].concat(args), {
        encoding: "utf8",
        timeout:  opts.timeout || 30000,
        env:      env,
    });

    return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        status: result.status,

        /** Parse stdout as JSON. Returns null if stdout is not valid JSON. */
        json: function() {
            try { return JSON.parse(result.stdout); }
            catch (_) { return null; }
        },

        /** Parse stderr as JSON (structured error). Tries full stderr first,
         *  then falls back to the last non-empty line (handles info() prefix text). */
        errorJson: function() {
            try { return JSON.parse(result.stderr); }
            catch (_) {}
            var lines = (result.stderr || '').split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
            for (var i = lines.length - 1; i >= 0; i--) {
                try { return JSON.parse(lines[i]); } catch (_) {}
            }
            return null;
        },
    };
};
