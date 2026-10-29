// Loaded first by Jasmine (see spec/support/*.json). Points HOME at a throwaway directory for the
// whole run, so no spec — in-process or through spawnCLI, which inherits process.env — can touch the
// developer's real ~/.config/egnyte-cli (e.g. `egnyte logout` deletes the stored profile).
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'egnyte-spec-home-'));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

process.on('exit', function() {
    try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch (_) { /* best effort */ }
});
