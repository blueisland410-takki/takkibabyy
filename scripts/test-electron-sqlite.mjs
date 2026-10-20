import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimePath = path.join(
  root,
  '.package-temp',
  'platform-resources',
  `${process.platform}-${process.arch}`,
  'better-sqlite3',
);
const electronBinary = require('electron');
const smokeScript = path.join(root, 'scripts', 'electron-sqlite-smoke.cjs');
const result = spawnSync(electronBinary, [smokeScript, runtimePath], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
