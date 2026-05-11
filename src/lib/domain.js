'use strict';

const { CLIError } = require('./output');

function normalizeDomain(input) {
    if (!input || typeof input !== 'string') return input;

    const value = input.trim();
    if (!value) return value;

    if (!/^https:\/\//.test(value)) {
        throw new CLIError('Egnyte domain must be a full HTTPS URL like https://mycompany.egnyte.com');
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch (_) {
        throw new CLIError('Invalid Egnyte domain URL: ' + input);
    }

    if (!parsed.hostname) {
        throw new CLIError('Invalid Egnyte domain URL: ' + input);
    }

    if (parsed.protocol !== 'https:') {
        throw new CLIError('Egnyte domain must use HTTPS: ' + input);
    }

    return parsed.origin.replace(/\/*$/, '');
}

function buildEgnyteBaseUrl(domainOrUrl) {
    return normalizeDomain(domainOrUrl);
}

module.exports = { normalizeDomain, buildEgnyteBaseUrl };
