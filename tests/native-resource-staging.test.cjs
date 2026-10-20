const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('native resource staging keeps only the selected platform binary', async () => {
  const { prepareNativeResources } =
    await import('../scripts/prepare-native-resources.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daybyday-stage-test-'));
  const resource = path.join(root, 'resources', 'better-sqlite3');
  const dependency = path.join(root, 'node_modules', 'better-sqlite3');
  const binary = path.join(dependency, 'prebuilds', 'darwin-arm64.node');
  fs.mkdirSync(path.join(resource, 'lib'), { recursive: true });
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(
    path.join(resource, 'lib', 'index.js'),
    'module.exports = {};',
  );
  fs.writeFileSync(
    path.join(resource, 'package.json'),
    '{"name":"better-sqlite3"}',
  );
  fs.writeFileSync(path.join(resource, 'LICENSE'), 'test license');
  fs.writeFileSync(binary, Buffer.from([1, 2, 3, 4]));

  try {
    const result = prepareNativeResources({
      platform: 'darwin',
      arch: 'arm64',
      root,
      verifyLoad: false,
    });
    const stagedPrebuilds = path.join(result.destination, 'prebuilds');
    assert.deepEqual(fs.readdirSync(stagedPrebuilds), ['darwin-arm64.node']);
    assert.deepEqual(
      fs.readFileSync(path.join(stagedPrebuilds, 'darwin-arm64.node')),
      Buffer.from([1, 2, 3, 4]),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native resource staging rejects unsupported targets', async () => {
  const { prepareNativeResources } =
    await import('../scripts/prepare-native-resources.mjs');
  assert.throws(
    () => prepareNativeResources({ platform: 'win32', arch: 'ia32' }),
    /Unsupported native resource target/,
  );
});

test('Forge chooses the native macOS app icon, tray image and DMG maker', () => {
  const forge = fs.readFileSync(
    path.join(__dirname, '..', 'forge.config.mts'),
    'utf8',
  );
  assert.match(forge, /resources\/icon\.icns/);
  assert.match(forge, /daybyday-trayTemplate\.png/);
  assert.match(forge, /daybyday-trayTemplate@2x\.png/);
  assert.match(forge, /new NativeDmgMaker/);
  assert.match(forge, /platform-resources/);
});
