import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import AutoUnpackNativesPlugin from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The Vite plugin bundles dependencies by default. Ship the native SQLite
    // package beside the OCR resources and load it from this fixed path.
    extraResource: [
      path.resolve('resources/ocr'),
      path.resolve('resources/better-sqlite3'),
    ],
    download: { cacheRoot: path.resolve('.electron-cache') },
    tmpdir: path.resolve('.package-temp'),
    ...(process.env.DAYBYDAY_ELECTRON_ZIP_DIR
      ? {
          electronZipDir: path.resolve(process.env.DAYBYDAY_ELECTRON_ZIP_DIR),
        }
      : {}),
  },
  // better-sqlite3 ships platform-specific N-API binaries. N-API is ABI-stable,
  // so rebuilding this module for Electron would require a local C++ toolchain
  // without changing the binary used by its platform entry point.
  rebuildConfig: { ignoreModules: ['better-sqlite3'] },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
