'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), '.config', 'egnyte-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (_) {
        return { default_profile: 'default', profiles: {} };
    }
}

function saveConfig(cfg) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function getProfile(name) {
    const cfg         = loadConfig();
    const profileName = name || cfg.default_profile || 'default';
    return cfg.profiles[profileName] || null;
}

function setProfile(name, data) {
    const cfg = loadConfig();
    cfg.profiles[name] = { ...cfg.profiles[name], ...data };
    saveConfig(cfg);
}

function removeProfile(name) {
    const cfg = loadConfig();
    delete cfg.profiles[name];
    if (cfg.default_profile === name) {
        const remaining = Object.keys(cfg.profiles);
        cfg.default_profile = remaining.length > 0 ? remaining[0] : 'default';
    }
    saveConfig(cfg);
}

module.exports = { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, getProfile, setProfile, removeProfile };
