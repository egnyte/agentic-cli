var fs   = require('fs');
var os   = require('os');
var path = require('path');

describe('bulk mode', function() {
    var OPTS = { token: 'dummytoken123', domain: 'https://testdomain.egnyte.com' };

    it('prints one dry-run preview per csv row for fs delete', function() {
        var csvPath = path.join(os.tmpdir(), 'egnyte-bulk-delete-' + Date.now() + '.csv');
        fs.writeFileSync(csvPath, 'path\n/Shared/a.txt\n/Shared/b.txt\n');

        try {
            var result = spawnCLI(['fs', 'delete', '--bulk-file-path', csvPath, '--dry-run'], OPTS);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('# fs.delete row 2');
            expect(result.stdout).toContain('# fs.delete row 3');
            expect(result.stdout).toContain('/pubapi/v1/fs/Shared/a.txt');
            expect(result.stdout).toContain('/pubapi/v1/fs/Shared/b.txt');
        } finally {
            try { fs.unlinkSync(csvPath); } catch (_) {}
        }
    });

    it('still enforces confirmation in bulk mode for mutating commands', function() {
        var csvPath = path.join(os.tmpdir(), 'egnyte-bulk-delete-' + Date.now() + '.csv');
        fs.writeFileSync(csvPath, 'path\n/Shared/a.txt\n');

        try {
            var result = spawnCLI(['fs', 'delete', '--bulk-file-path', csvPath], OPTS);
            expect(result.status).toBe(1);
            expect(result.errorJson().error).toMatch(/--yes|--dry-run/);
        } finally {
            try { fs.unlinkSync(csvPath); } catch (_) {}
        }
    });
});
