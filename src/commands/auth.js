'use strict';

const { out, CLIError }                             = require('../lib/output');
const { loadConfig, saveConfig, getProfile,
        setProfile, removeProfile }                 = require('../lib/config');
const { doOAuthLogin, resolveAuth }                 = require('../lib/auth');
const { apiRequest }                                = require('../lib/http');
const { applyFields }                               = require('../lib/fields');
const { normalizeDomain }                           = require('../lib/domain');

// Egnyte-owned CLI OAuth app.
// Users may override with --client-id / --client-secret or EGNYTE_CLIENT_ID / EGNYTE_CLIENT_SECRET.
const DEFAULT_CLIENT_ID     = 'B2USfGyTcBwQlDsupAfXwks7UaBgfL4NNAmZRde0bub7Q7jP';
const DEFAULT_CLIENT_SECRET = 'gWwjOzVa4J475WqV07YQVuAsJ7Z1x49GQ4mjNBDDDoIA4GkCOx36VGGqwqeLb1RV';

// ── login ─────────────────────────────────────────────────────────────────────

async function cmdLogin(args) {
    const domain      = normalizeDomain(args.domain || args._[1] || process.env.EGNYTE_DOMAIN);
    const redirectUri = args['redirect-uri'] || process.env.EGNYTE_REDIRECT_URI || 'https://www.egnyte.com';
    const scope       = args.scope           || process.env.EGNYTE_SCOPE;
    const profileName = args.profile || 'default';

    if (!domain) throw new CLIError('--domain is required (or set EGNYTE_DOMAIN). Example: egnyte login --domain https://mycompany.egnyte.com');

    const customId     = args['client-id']     || process.env.EGNYTE_CLIENT_ID;
    const customSecret = args['client-secret'] || process.env.EGNYTE_CLIENT_SECRET;
    if (!!customId !== !!customSecret) {
        throw new CLIError('Both --client-id and --client-secret are required when using a custom OAuth app (got only one).');
    }
    const clientId     = customId     || DEFAULT_CLIENT_ID;
    const clientSecret = customSecret || DEFAULT_CLIENT_SECRET;

    const tokenData = await doOAuthLogin({ domain, clientId, clientSecret, redirectUri, scope });
    setProfile(profileName, tokenData);

    // Set as default if this is the first profile
    const cfg = loadConfig();
    if (!cfg.default_profile || Object.keys(cfg.profiles).length === 1) {
        cfg.default_profile = profileName;
        saveConfig(cfg);
    }

    out({
        status:  'logged_in',
        profile: profileName,
        domain,
        scope:   tokenData.scope,
        expires: new Date(tokenData.expires_at).toISOString(),
    });
}

// ── logout ────────────────────────────────────────────────────────────────────

async function cmdLogout(args) {
    const profileName = args.profile || loadConfig().default_profile || 'default';
    const profile     = getProfile(profileName);
    if (!profile) throw new CLIError("Profile '" + profileName + "' not found.");

    removeProfile(profileName);
    out({ status: 'logged_out', profile: profileName });
}

// ── whoami ────────────────────────────────────────────────────────────────────

async function cmdWhoami(args) {
    // CLI flags and env vars go through resolveAuth (no profile read needed)
    if (args.token && args.domain) {
        const { token, domain } = await resolveAuth(args);
        return out(applyFields({ auth_source: 'cli_flags', domain, token_hint: token.slice(0, 8) + '***' }, args.fields));
    }
    if (process.env.EGNYTE_TOKEN && process.env.EGNYTE_DOMAIN) {
        const { token, domain } = await resolveAuth(args);
        return out(applyFields({ auth_source: 'environment_variables', domain, token_hint: token.slice(0, 8) + '***' }, args.fields));
    }

    // Stored profile — read directly, never refresh, so expired profiles are inspectable
    const profileName = args.profile || loadConfig().default_profile || 'default';
    const profile     = getProfile(profileName);
    if (!profile || !profile.access_token) {
        throw new CLIError('Not authenticated. Run: egnyte login');
    }
    const isExpired = profile.expires_at && Date.now() > profile.expires_at;
    out(applyFields({
        auth_source:  'stored_profile',
        profile:      profileName,
        domain:       normalizeDomain(profile.domain),
        scope:        profile.scope || 'unknown',
        expires:      profile.expires_at ? new Date(profile.expires_at).toISOString() : 'unknown',
        token_status: isExpired ? 'expired' : 'valid',
        token_hint:   profile.access_token.slice(0, 8) + '***',
    }, args.fields));
}

// ── profiles ──────────────────────────────────────────────────────────────────

async function cmdProfiles(args) {
    const sub = args._[1];

    if (!sub || sub === 'list') {
        const cfg      = loadConfig();
        const profiles = Object.entries(cfg.profiles).map(function(pair) {
            const name = pair[0];
            const p    = pair[1];
            return {
                name,
                domain:       normalizeDomain(p.domain),
                is_default:   name === cfg.default_profile,
                token_status: p.expires_at
                    ? (Date.now() > p.expires_at ? 'expired' : 'valid')
                    : 'unknown',
                expires: p.expires_at ? new Date(p.expires_at).toISOString() : 'unknown',
            };
        });
        out({ default_profile: cfg.default_profile, profiles });
        return;
    }

    if (sub === 'use') {
        const name = args._[2];
        if (!name) throw new CLIError('Usage: egnyte profiles use <name>');
        const cfg = loadConfig();
        if (!cfg.profiles[name]) throw new CLIError("Profile '" + name + "' not found. Run: egnyte profiles list");
        cfg.default_profile = name;
        saveConfig(cfg);
        out({ status: 'ok', default_profile: name });
        return;
    }

    if (sub === 'remove') {
        const name = args._[2];
        if (!name) throw new CLIError('Usage: egnyte profiles remove <name>');
        const cfg = loadConfig();
        if (!cfg.profiles[name]) throw new CLIError("Profile '" + name + "' not found. Run: egnyte profiles list");
        removeProfile(name);
        out({ status: 'removed', profile: name });
        return;
    }

    throw new CLIError("Unknown profiles command: '" + sub + "'. Try: list | use | remove");
}

// ── userinfo ──────────────────────────────────────────────────────────────────
//
// Calls GET /pubapi/v1/userinfo — returns the authenticated user's live profile
// from the Egnyte API (username, email, active status, role, groups, etc.).
// Unlike `whoami`, this validates that the stored token is still accepted by the
// server and returns the user record rather than stored credential metadata.

async function cmdUserInfo(args) {
    const { token, domain } = await resolveAuth(args);
    const result = await apiRequest({ domain, token, method: 'GET', apiPath: '/pubapi/v1/userinfo' });
    out(applyFields(result, args.fields));
}

module.exports = { cmdLogin, cmdLogout, cmdWhoami, cmdProfiles, cmdUserInfo };
