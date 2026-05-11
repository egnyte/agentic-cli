'use strict';

const crypto       = require('crypto');
const { spawnSync } = require('child_process');
const { CLIError, info } = require('./output');
const { loadConfig, getProfile, setProfile } = require('./config');
const { httpPost } = require('./http');
const { normalizeDomain, buildEgnyteBaseUrl } = require('./domain');

/**
 * Resolve auth credentials in priority order:
 *   1. --token / --domain CLI flags
 *   2. EGNYTE_TOKEN / EGNYTE_DOMAIN environment variables  (CI / headless agents)
 *   3. Stored profile in ~/.config/egnyte-cli/config.json
 *
 * Throws CLIError if no credentials are available.
 * Auto-refreshes tokens expiring within 5 minutes when a refresh_token is stored.
 */
async function resolveAuth(args) {
    // 1. CLI flags — highest priority
    if (args.token && args.domain) {
        return { token: args.token, domain: normalizeDomain(args.domain), auth_source: 'cli_flags' };
    }

    // 2. Environment variables — CI/headless agents
    const envToken  = process.env.EGNYTE_TOKEN;
    const envDomain = process.env.EGNYTE_DOMAIN;
    if (envToken && envDomain) {
        return { token: envToken, domain: normalizeDomain(envDomain), auth_source: 'environment_variables' };
    }

    // 3. Stored profile
    const profileName = args.profile || loadConfig().default_profile || 'default';
    const profile     = getProfile(profileName);

    if (!profile || !profile.access_token) {
        throw new CLIError(
            'Not authenticated. Run: egnyte login\n' +
            'Or set EGNYTE_TOKEN and EGNYTE_DOMAIN environment variables.'
        );
    }

    // Auto-refresh if token expires within 5 minutes
    const fiveMin = 5 * 60 * 1000;
    if (profile.expires_at && Date.now() > profile.expires_at - fiveMin) {
        if (profile.refresh_token && profile.client_id && profile.client_secret) {
            info('Token expiring soon \u2014 refreshing...');
            const refreshed = await doTokenRefresh(profile);
            setProfile(profileName, refreshed);
            return { token: refreshed.access_token, domain: normalizeDomain(profile.domain), auth_source: 'stored_profile' };
        }
        throw new CLIError('Token expired. Run: egnyte login');
    }

    return { token: profile.access_token, domain: normalizeDomain(profile.domain), auth_source: 'stored_profile' };
}

/** Exchange a refresh_token for a new access_token. */
async function doTokenRefresh(profile) {
    const body = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: profile.refresh_token,
        client_id:     profile.client_id,
        client_secret: profile.client_secret,
    }).toString();

    const resp = await httpPost(
        buildEgnyteBaseUrl(profile.domain) + '/puboauth/token',
        body,
        'application/x-www-form-urlencoded'
    );

    if (!resp.access_token) throw new CLIError('Token refresh failed. Run: egnyte login');

    return {
        access_token:  resp.access_token,
        refresh_token: resp.refresh_token || profile.refresh_token,
        expires_at:    Date.now() + resp.expires_in * 1000,
    };
}

/**
 * OAuth 2.0 Authorization Code flow.
 *
 * Egnyte requires a registered HTTPS redirect URI. The manual flow:
 *   1. CLI opens the browser to the Egnyte authorize page.
 *   2. User logs in and approves.
 *   3. Egnyte redirects to the registered redirect URI with ?code=xxx.
 *   4. User copies the `code` value from the URL bar and pastes it here.
 *   5. CLI exchanges the code for tokens.
 */
async function doOAuthLogin(opts) {
    const domain = normalizeDomain(opts.domain);
    const { clientId, clientSecret, redirectUri } = opts;
    const state = crypto.randomBytes(16).toString('hex');

    // Request every known scope so any Public API endpoint (including egnyte request)
    // works without re-authentication. --scope overrides this default when a
    // restricted token is intentionally desired.
    const scope = opts.scope || [
        'Egnyte.filesystem',      // File System, Search, Comments, Events, Trash, Workflows
        'Egnyte.ai',              // AI
        'Egnyte.permission',      // Permissions
        'Egnyte.link',            // Links
        'Egnyte.projectfolders',  // Project Folders
        'Egnyte.bookmark',        // Bookmarks
        'Egnyte.user',            // User Management
        'Egnyte.group',           // Group Management
        'Egnyte.audit',           // Audit Reporting
        'Egnyte.salesforce',      // Salesforce Integration
        'Egnyte.launchwebsession',// Embedded UI
        'Egnyte.controlleddocs',  // Controlled Document Management
        'Egnyte.etmf',            // eTMF
        'Egnyte.documentportal',  // Document Portal
        'Egnyte.uploadrequests',  // Upload Requests
        'Egnyte.webhooks',        // Webhooks
        'Egnyte.integrations',    // Integrations
    ].join(' ');

    const authUrl = buildEgnyteBaseUrl(domain) + '/puboauth/authorize?' + new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope,
        state,
    }).toString();

    info('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    info('Step 1 \u2014 Opening browser for Egnyte login...');
    info('If the browser does not open, visit this URL:\n');
    info('  ' + authUrl + '\n');
    openBrowser(authUrl);

    info('Step 2 \u2014 After you approve, your browser will redirect to a URL like:');
    info('  ' + redirectUri + '?code=XXXXXX&state=...');
    info('\nStep 3 \u2014 Copy the value of the `code` parameter from the URL bar.');
    info('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');

    const code = await promptCode();
    if (!code) throw new CLIError('No code entered. Login cancelled.');
    info('\nExchanging code for token...');

    const body = new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
    }).toString();

    const resp = await httpPost(
        buildEgnyteBaseUrl(domain) + '/puboauth/token',
        body,
        'application/x-www-form-urlencoded'
    );

    if (!resp.access_token) throw new CLIError('Token exchange failed: ' + JSON.stringify(resp));

    return {
        domain,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        access_token:  resp.access_token,
        refresh_token: resp.refresh_token || null,
        scope:         resp.scope || scope,
        expires_at:    Date.now() + resp.expires_in * 1000,
    };
}

/** Prompt the user to paste the OAuth authorization code. */
function promptCode() {
    return new Promise(function(resolve) {
        process.stderr.write('Paste the authorization code here: ');
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', function(d) {
            process.stdin.destroy();
            resolve(d.trim());
        });
        process.stdin.resume();
    });
}

/** Open the default browser on the current platform. */
function openBrowser(url) {
    try {
        if (process.platform === 'win32') {
            // 'start' is a shell built-in; run via cmd.exe with an empty title arg
            spawnSync('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore' });
        } else {
            const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            spawnSync(cmd, [url], { stdio: 'ignore' });
        }
    } catch (_) {
        // Browser open failed — the URL was already printed above
    }
}

module.exports = { resolveAuth, doOAuthLogin, doTokenRefresh, promptCode, openBrowser };
