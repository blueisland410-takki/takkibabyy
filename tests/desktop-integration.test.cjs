const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  getSquirrelLoginItemOptions,
  getTrayMenuLabels,
  isTrayAction,
  normalizeDesktopPreferenceFlags,
} = require('../.test-output/src/desktopIntegration.js');

test('old window preferences keep new Windows options off by default', () => {
  assert.deepEqual(normalizeDesktopPreferenceFlags({ languageId: 'zh-CN' }), {
    closeToTray: false,
    launchAtStartup: false,
  });
  assert.deepEqual(
    normalizeDesktopPreferenceFlags({ closeToTray: true, launchAtStartup: 1 }),
    { closeToTray: true, launchAtStartup: false },
  );
});

test('Squirrel login startup uses its stable launcher one directory above the versioned app', () => {
  const executable =
    'C:\\Users\\lan\\AppData\\Local\\Daybyday\\app-1.0.0\\DayByDay.exe';
  assert.deepEqual(getSquirrelLoginItemOptions(executable, true), {
    openAtLogin: true,
    path: 'C:\\Users\\lan\\AppData\\Local\\Daybyday\\DayByDay.exe',
    args: [],
  });
  assert.equal(
    getSquirrelLoginItemOptions(executable, false).openAtLogin,
    false,
  );
  assert.throws(() =>
    getSquirrelLoginItemOptions('relative\\DayByDay.exe', true),
  );
});

test('tray actions accept only the three renderer navigation requests', () => {
  for (const action of ['quick-task', 'week', 'settings'])
    assert.equal(isTrayAction(action), true);
  for (const action of ['quit', 'window:close', { action: 'settings' }, null])
    assert.equal(isTrayAction(action), false);
});

test('tray menu labels are present in all five saved application languages', () => {
  const languages = ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'];
  for (const language of languages) {
    const labels = getTrayMenuLabels(language);
    assert.deepEqual(Object.keys(labels), [
      'show',
      'hide',
      'addTask',
      'planner',
      'settings',
      'quit',
    ]);
    assert.ok(Object.values(labels).every((label) => label.trim().length > 0));
    assert.equal(new Set(Object.values(labels)).size, 6);
  }
});
