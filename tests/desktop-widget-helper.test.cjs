const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(
  projectRoot,
  'resources',
  'daybyday-desktop-window.ps1',
);

test(
  'Windows desktop helper compiles and safely rejects a missing test window',
  { skip: process.platform !== 'win32' },
  () => {
    const powershell = path.join(
      process.env.WINDIR || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const result = spawnSync(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath,
        '-Mode',
        'Detach',
        '-Handle',
        '0x0',
        '-OwnerProcessId',
        '1',
        '-X',
        '0',
        '-Y',
        '0',
        '-Width',
        '440',
        '-Height',
        '680',
      ],
      { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"code":"window-missing"/);
  },
);

test('desktop helper uses a fixed command set without registry or Explorer restart operations', () => {
  const source = fs.readFileSync(helperPath, 'utf8');
  assert.match(source, /ValidateSet\('Attach', 'Detach'\)/);
  assert.match(source, /WS_CHILD/);
  assert.match(source, /SetParent\(hwnd, progman\)/);
  assert.match(source, /EnsureAttached/);
  assert.doesNotMatch(
    source,
    /RegistryKey|Set-ItemProperty|Stop-Process|taskkill/i,
  );
});
