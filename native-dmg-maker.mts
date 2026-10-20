import { MakerBase, type MakerOptions } from '@electron-forge/maker-base';
import type { ForgePlatform } from '@electron-forge/shared-types';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runCommand = async (command: string, args: string[]) => {
  const child = spawn(command, args, { stdio: 'inherit' });
  return new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} failed (${signal ?? code ?? 'unknown exit status'}).`,
          ),
        );
    });
  });
};

export default class NativeDmgMaker extends MakerBase<Record<string, never>> {
  name = 'daybyday-dmg';
  defaultPlatforms: ForgePlatform[] = ['darwin'];
  requiredExternalBinaries = ['ditto', 'hdiutil'];

  isSupportedOnCurrentPlatform() {
    return process.platform === 'darwin' && this.externalBinariesExist();
  }

  async make({
    dir,
    makeDir,
    appName,
    packageJSON,
    targetArch,
  }: MakerOptions): Promise<string[]> {
    if (process.platform !== 'darwin') {
      throw new Error('The Daybyday DMG maker can only run on macOS.');
    }
    this.ensureExternalBinariesExist();

    const appBundle = path.resolve(dir, `${appName}.app`);
    const appStat = await fs.stat(appBundle).catch(() => undefined);
    if (!appStat?.isDirectory()) {
      throw new Error(`Packaged macOS application was not found: ${appBundle}`);
    }

    const outputDirectory = path.resolve(makeDir, 'daybyday-dmg', targetArch);
    const outputPath = path.resolve(
      outputDirectory,
      `${appName}-${packageJSON.version}-${targetArch}.dmg`,
    );
    if (!outputPath.startsWith(`${path.resolve(makeDir)}${path.sep}`)) {
      throw new Error('The DMG output path escaped the Forge make directory.');
    }
    await fs.mkdir(outputDirectory, { recursive: true });
    const stagingDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'daybyday-dmg-'),
    );
    try {
      await runCommand('ditto', [
        appBundle,
        path.join(stagingDirectory, `${appName}.app`),
      ]);
      await fs.symlink(
        '/Applications',
        path.join(stagingDirectory, 'Applications'),
      );
      await fs.rm(outputPath, { force: true });
      await runCommand('hdiutil', [
        'create',
        '-volname',
        appName,
        '-srcfolder',
        stagingDirectory,
        '-ov',
        '-format',
        'UDZO',
        outputPath,
      ]);
      return [outputPath];
    } finally {
      await fs.rm(stagingDirectory, { recursive: true, force: true });
    }
  }
}
