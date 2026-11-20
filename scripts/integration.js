// Runs test/integration/suite.ts inside a real VS Code, with a throwaway profile so it doesn't
// touch your settings or extensions.
//
//   node scripts/integration.js [path/to/PHI] [path/to/Code.exe]
//
// Defaults: $PHI_ROOT, ../../Libraries/PHI or ../PHI, and $VSCODE_PATH or the `code` on PATH.

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ext = path.resolve(__dirname, '..');
const places = [path.resolve(ext, '../../Libraries/PHI'), path.resolve(ext, '../PHI')];
const phi = process.argv[2] || process.env.PHI_ROOT || places.find(p => fs.existsSync(path.join(p, 'lib', 'phi'))) || places[0];

function findCode() {
    if (process.argv[3]) return process.argv[3];
    if (process.env.VSCODE_PATH) return process.env.VSCODE_PATH;
    const which = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', ['code'], { encoding: 'utf8' });
    const found = (which.stdout || '').split(/\r?\n/).find(Boolean);
    if (!found) throw new Error("can't find VS Code: pass its path or set VSCODE_PATH");
    // (the `code` on PATH can be a link to the one in VS Code's own folder)
    const cli = fs.realpathSync(found);
    // bin/code -> the executable next to the bin folder
    const dir = path.dirname(path.dirname(cli));
    for (const name of ['Code.exe', 'code', 'Code - Insiders.exe']) {
        if (fs.existsSync(path.join(dir, name)) && fs.statSync(path.join(dir, name)).isFile()) return path.join(dir, name);
    }
    return cli;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'phi-vscode-test-'));
const code = findCode();
const args = [
    phi,
    `--extensionDevelopmentPath=${ext}`,
    `--extensionTestsPath=${path.join(ext, 'out', 'test', 'integration', 'suite.js')}`,
    `--user-data-dir=${path.join(profile, 'user')}`,
    `--extensions-dir=${path.join(profile, 'extensions')}`,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-gpu',
];

console.log(`running ${code}\n  workspace: ${phi}`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = cp.spawn(code, args, { stdio: 'inherit', env });
child.on('exit', status => {
    fs.rm(profile, { recursive: true, force: true }, () => process.exit(status ?? 1));
});
