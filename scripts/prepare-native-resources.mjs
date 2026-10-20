import { createRequire } from 'node:module';
import path from 'node:path';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const allowedPlatforms = new Set(['win32', 'darwin', 'linux']);
const allowedArchitectures = new Set(['x64', 'arm64']);

const readOption = (name, fallback) => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
};

export const prepareNativeResources = ({
  platform = process.platform,
  arch = process.arch,
  root = projectRoot,
  verifyLoad,
} = {}) => {
  if (!allowedPlatforms.has(platform) || !allowedArchitectures.has(arch)) {
    throw new Error(`Unsupported native resource target: ${platform}-${arch}`);
  }

  const resourceSource = path.join(root, 'resources', 'better-sqlite3');
  const dependencySource = path.join(root, 'node_modules', 'better-sqlite3');
  const targetName = `${platform}-${arch}`;
  const sourceBinary = path.join(
    dependencySource,
    'prebuilds',
    `${targetName}.node`,
  );
  const electronRebuiltBinary = path.join(
    dependencySource,
    'build',
    'Release',
    'better_sqlite3.node',
  );
  const selectedBinary = existsSync(electronRebuiltBinary)
    ? electronRebuiltBinary
    : sourceBinary;
  const shouldVerifyWithNode =
    verifyLoad ??
    (platform === process.platform &&
      arch === process.arch &&
      selectedBinary === sourceBinary);
  const destinationBase = path.resolve(
    root,
    '.package-temp',
    'platform-resources',
  );
  const destination = path.resolve(
    destinationBase,
    targetName,
    'better-sqlite3',
  );
  const expectedPrefix = `${destinationBase}${path.sep}`;
  if (!destination.startsWith(expectedPrefix)) {
    throw new Error(
      'Native resource staging path escaped its build directory.',
    );
  }
  if (!statSync(resourceSource).isDirectory()) {
    throw new Error('The existing better-sqlite3 resource package is missing.');
  }
  if (!statSync(dependencySource).isDirectory()) {
    throw new Error('Run npm ci before preparing native resources.');
  }
  if (!statSync(selectedBinary).isFile()) {
    throw new Error(
      `The installed better-sqlite3 package has no ${targetName} prebuild.`,
    );
  }

  mkdirSync(path.join(destination, 'lib'), { recursive: true });
  mkdirSync(path.join(destination, 'prebuilds'), { recursive: true });
  cpSync(path.join(resourceSource, 'lib'), path.join(destination, 'lib'), {
    recursive: true,
    force: true,
  });
  copyFileSync(
    path.join(resourceSource, 'package.json'),
    path.join(destination, 'package.json'),
  );
  copyFileSync(
    path.join(resourceSource, 'LICENSE'),
    path.join(destination, 'LICENSE'),
  );
  copyFileSync(
    selectedBinary,
    path.join(destination, 'prebuilds', `${targetName}.node`),
  );

  const stagedPackage = path.join(destination, 'package.json');
  const packageMetadata = JSON.parse(readFileSync(stagedPackage, 'utf8'));
  if (packageMetadata.name !== 'better-sqlite3') {
    throw new Error('Staged SQLite package metadata is invalid.');
  }
  if (shouldVerifyWithNode) {
    const stagedRequire = createRequire(path.join(destination, 'loader.cjs'));
    const Database = stagedRequire(path.join(destination, 'lib', 'index.js'));
    const database = new Database(':memory:');
    try {
      const result = database.prepare('SELECT 1 AS ok').get();
      if (result?.ok !== 1)
        throw new Error('SQLite smoke query returned an unexpected result.');
    } finally {
      database.close();
    }
  }

  const bytes = statSync(
    path.join(destination, 'prebuilds', `${targetName}.node`),
  ).size;
  return {
    destination,
    platform,
    arch,
    bytes,
    rebuiltForElectron: selectedBinary === electronRebuiltBinary,
  };
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = prepareNativeResources({
    platform: readOption('platform', process.platform),
    arch: readOption('arch', process.arch),
  });
  console.log(
    `Prepared better-sqlite3 ${result.platform}-${result.arch} (${result.bytes} bytes${result.rebuiltForElectron ? ', Electron rebuild' : ', prebuilt N-API binary'}) at ${result.destination}`,
  );
}
