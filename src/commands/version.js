'use strict';

const { out }         = require('../lib/output');
const { applyFields } = require('../lib/fields');

// The literal require keeps package.json visible to pkg's static analysis, so the
// same value is reported by npm installs and by packaged binaries.
const VERSION = require('../../package.json').version;

/**
 * egnyte version — version as JSON.
 * Contract: append-only — fields may be added over time, never removed or retyped.
 */
function cmdVersion(args) {
    out(applyFields({ version: VERSION }, args.fields));
}

module.exports = { VERSION, cmdVersion };
