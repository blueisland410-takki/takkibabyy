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
const mainPath = path.join(projectRoot, 'src', 'main.ts');
const preloadPath = path.join(projectRoot, 'src', 'preload.ts');
const appPath = path.join(projectRoot, 'src', 'App.tsx');

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
  assert.match(source, /ReadLineAsync\(\)/);
  assert.match(
    source,
    /AttachThreadInput\(sourceThreadId, targetThreadId, true\)/,
  );
  assert.match(source, /SetFocus\(hwnd\)/);
  assert.match(source, /ReleaseKeyboardFocus/);
  assert.ok(source.includes("command -eq 'focus'"));
  assert.ok(source.includes("command -eq 'blur'"));
  assert.doesNotMatch(
    source,
    /RegistryKey|Set-ItemProperty|Stop-Process|taskkill/i,
  );
});

test('keyboard focus IPC is restricted to the main frame and Desktop Widget mode', () => {
  const mainSource = fs.readFileSync(mainPath, 'utf8');
  const preloadSource = fs.readFileSync(preloadPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');

  assert.match(mainSource, /currentWindowMode !== 'desktop-widget'/);
  assert.match(mainSource, /ipcMain\.on\('desktop-widget:input-focus'/);
  assert.match(mainSource, /event\.senderFrame !== event\.sender\.mainFrame/);
  assert.match(
    preloadSource,
    /setDesktopWidgetTextFocus: \(focused: boolean\)/,
  );
  assert.match(preloadSource, /typeof focused !== 'boolean'/);
  assert.match(appSource, /document\.addEventListener\('focusin'/);
  assert.match(appSource, /document\.addEventListener\('focusout'/);
  assert.match(appSource, /onDesktopWidgetFocusError/);
});
