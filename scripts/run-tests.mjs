import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, '.test-output');
mkdirSync(outputDirectory, { recursive: true });

const compileSources = [
  'src/domain.ts',
  'src/theme.ts',
  'src/i18n.ts',
  'src/desktopIntegration.ts',
  'src/courseSchedule.ts',
  'src/scheduleView.ts',
  'src/validation.ts',
  'src/courseImport.ts',
  'src/timetableParser.ts',
  'src/mobileTimetableParser.ts',
  'src/importParsers.ts',
  'src/backupFormat.ts',
  'src/backupFiles.ts',
  'src/database.ts',
];
const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const compile = spawnSync(
  process.execPath,
  [
    compiler,
    '--ignoreConfig',
    '--target',
    'ES2022',
    '--module',
    'Node16',
    '--moduleResolution',
    'Node16',
    '--resolveJsonModule',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
    '--outDir',
    outputDirectory,
    ...compileSources,
  ],
  { cwd: root, stdio: 'inherit' },
);
if (compile.error) throw compile.error;
if (compile.status !== 0) process.exit(compile.status ?? 1);

const testFiles = readdirSync(path.join(root, 'tests'))
  .filter((filename) => filename.endsWith('.test.cjs'))
  .sort()
  .map((filename) => path.join(root, 'tests', filename));
if (testFiles.length === 0)
  throw new Error('No automated test files were found.');

const testRun = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  env: { ...process.env, TEMP: outputDirectory, TMP: outputDirectory },
  stdio: 'inherit',
});
if (testRun.error) throw testRun.error;
process.exit(testRun.status ?? 1);
