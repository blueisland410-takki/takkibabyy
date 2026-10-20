import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  Tray,
  dialog,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron';
import fs from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  CURRENT_SCHEMA_VERSION,
  PlannerDatabase,
  type SqliteDatabaseConstructor,
} from './database';
import {
  encodeBackupHeader,
  getBackupFixedPrefixLength,
  getBackupHeaderLength,
  MAX_BACKUP_PREFERENCES_BYTES,
  parseBackupHeader,
  type BackupFileMetadata,
  type BackupRecordCounts,
  type BackupPayloadLayout,
} from './backupFormat';
import {
  hasDatabaseBundle,
  moveDatabaseBundle,
  removeDatabaseBundle,
  restorePartialDatabaseBundle,
} from './backupFiles';
import { getThemeDefinition, isThemeId } from './theme';
import {
  getSquirrelLoginItemOptions,
  getTrayMenuLabels,
  normalizeDesktopPreferenceFlags,
  normalizeStoredWindowMode,
  type TrayAction,
} from './desktopIntegration';
import { translateForLanguage } from './i18n';
import type {
  CourseImportDecision,
  DesktopSettings,
  FontSizeScale,
  LanguageId,
  MoveDirection,
  ThemeId,
  WindowMode,
  WindowModeState,
} from './domain';
import {
  assertDateKey,
  assertId,
  normalizeStoredFontSizeScale,
  parseFontSizeScale,
  parseLanguageId,
  parseThemeId,
  parseWindowMode,
  parseCourseExceptionInput,
  parseCourseImportDecisions,
  parseCourseImportInputs,
  parseImportBatchPayload,
  parseImportBatchDecisions,
  parseCourseInput,
  parseClassPeriodTimes,
  parseEventInput,
  parseEventUpdate,
  parseMoveDirection,
  parseSeriesExceptionPolicy,
  parseSemesterInput,
  parseTaskInput,
  parseTaskUpdate,
} from './validation';
import started from 'electron-squirrel-startup';

const DEFAULT_WIDTH = 440;
const DEFAULT_HEIGHT = 680;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 420;
const STATE_FILE = 'window-state.json';
const OCR_CORE_FILE = 'tesseract-core-lstm.wasm.js';
const TRAY_ICON_FILE = 'daybyday-tray.ico';
const DESKTOP_WINDOW_SCRIPT = 'daybyday-desktop-window.ps1';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'daybyday-ocr',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

type SavedWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  windowMode: WindowMode;
  closeToTray: boolean;
  launchAtStartup: boolean;
  fontSizeScale: FontSizeScale;
  themeId: ThemeId;
  languageId: LanguageId;
};

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let plannerDatabase: PlannerDatabase | undefined;
let boundsBeforeImportMode: Rectangle | undefined;
let mainWindowReady = false;
let isQuitting = false;
let dataOperationInProgress = false;
let quitAfterDataOperation = false;
let pendingTrayAction: TrayAction | undefined;
let currentFontSizeScale: FontSizeScale = 1;
let currentThemeId: ThemeId = 'classic';
let currentLanguageId: LanguageId = 'zh-CN';
let currentCloseToTray = false;
let currentLaunchAtStartup = false;
let currentWindowMode: WindowMode = 'floating';
let currentWindowModeErrorKey: string | undefined;
let desktopWidgetHelper: ChildProcessWithoutNullStreams | undefined;
let desktopWidgetTransition = false;
let desktopWidgetRecoveryTimer: ReturnType<typeof setTimeout> | undefined;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (started || !hasSingleInstanceLock) {
  app.quit();
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStatePath = () => path.join(app.getPath('userData'), STATE_FILE);
const getDatabasePath = () =>
  path.join(app.getPath('userData'), 'daybyday.sqlite');

const getSqliteDatabaseConstructor = (): SqliteDatabaseConstructor => {
  const sqliteRequire = createRequire(
    app.isPackaged
      ? path.join(process.resourcesPath, 'daybyday-loader.cjs')
      : __filename,
  );
  const sqlitePackagePath = app.isPackaged
    ? path.join(process.resourcesPath, 'better-sqlite3')
    : 'better-sqlite3';
  return sqliteRequire(sqlitePackagePath) as SqliteDatabaseConstructor;
};

const getPlannerDatabase = () => {
  if (plannerDatabase) return plannerDatabase;
  try {
    const userDataPath = app.getPath('userData');
    fs.mkdirSync(userDataPath, { recursive: true });
    plannerDatabase = new PlannerDatabase(
      getDatabasePath(),
      getSqliteDatabaseConstructor(),
    );
    return plannerDatabase;
  } catch (error) {
    console.error(
      'Could not open the DayByDay database. Existing data was not cleared.',
      getErrorKind(error),
    );
    const detail = error instanceof Error ? error.message : '未知错误';
    throw new Error(
      `本地数据库打开失败，程序没有清除已有数据。请检查磁盘空间和文件权限后重试。(${detail})`,
    );
  }
};

const readWindowState = (): SavedWindowState => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(getStatePath(), 'utf8'),
    ) as Record<string, unknown>;
    const windowMode = normalizeStoredWindowMode(
      parsed.windowMode,
      parsed.alwaysOnTop,
    );

    return {
      x: isFiniteNumber(parsed.x) ? Math.round(parsed.x) : undefined,
      y: isFiniteNumber(parsed.y) ? Math.round(parsed.y) : undefined,
      width: isFiniteNumber(parsed.width)
        ? Math.round(parsed.width)
        : DEFAULT_WIDTH,
      height: isFiniteNumber(parsed.height)
        ? Math.round(parsed.height)
        : DEFAULT_HEIGHT,
      alwaysOnTop: windowMode === 'always-on-top',
      windowMode,
      ...normalizeDesktopPreferenceFlags(parsed),
      fontSizeScale: normalizeStoredFontSizeScale(parsed.fontSizeScale),
      themeId: isThemeId(parsed.themeId) ? parsed.themeId : 'classic',
      languageId:
        parsed.languageId === 'zh-CN' ||
        parsed.languageId === 'zh-TW' ||
        parsed.languageId === 'ja-JP' ||
        parsed.languageId === 'ko-KR' ||
        parsed.languageId === 'en-US'
          ? parsed.languageId
          : 'zh-CN',
    };
  } catch {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      alwaysOnTop: false,
      windowMode: 'floating',
      closeToTray: false,
      launchAtStartup: false,
      fontSizeScale: 1,
      themeId: 'classic',
      languageId: 'zh-CN',
    };
  }
};

const clampToVisibleDisplay = (bounds: Rectangle): Rectangle => {
  const { workArea } = screen.getDisplayMatching(bounds);
  const width = Math.min(
    Math.max(MIN_WIDTH, bounds.width),
    Math.max(MIN_WIDTH, workArea.width),
  );
  const height = Math.min(
    Math.max(MIN_HEIGHT, bounds.height),
    Math.max(MIN_HEIGHT, workArea.height),
  );
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(bounds.x, workArea.x), Math.max(workArea.x, maxX)),
    y: Math.min(Math.max(bounds.y, workArea.y), Math.max(workArea.y, maxY)),
    width,
    height,
  };
};

const getInitialBounds = (state: SavedWindowState): Rectangle => {
  if (isFiniteNumber(state.x) && isFiniteNumber(state.y)) {
    return clampToVisibleDisplay({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    });
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, workArea.width));
  const height = Math.min(
    DEFAULT_HEIGHT,
    Math.max(MIN_HEIGHT, workArea.height),
  );
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
};

const saveWindowState = (): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const bounds = mainWindow.getBounds();
  const state: SavedWindowState = {
    ...bounds,
    alwaysOnTop: currentWindowMode === 'always-on-top',
    windowMode: currentWindowMode,
    closeToTray: currentCloseToTray,
    launchAtStartup: currentLaunchAtStartup,
    fontSizeScale: currentFontSizeScale,
    themeId: currentThemeId,
    languageId: currentLanguageId,
  };

  try {
    const directory = app.getPath('userData');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(
      'Could not save the DayByDay window settings.',
      getErrorKind(error),
    );
    return false;
  }
};

const scheduleWindowStateSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    saveWindowState();
    sendDesktopWidgetBounds();
  }, 200);
};

const getDesktopWidgetScriptPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, DESKTOP_WINDOW_SCRIPT)
    : path.resolve(__dirname, '../../resources', DESKTOP_WINDOW_SCRIPT);

const getDesktopPowerShellPath = () =>
  path.join(
    process.env.WINDIR ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );

const getDesktopWindowArguments = (
  window: BrowserWindow,
  mode: 'Attach' | 'Detach',
) => {
  const handleBytes = window.getNativeWindowHandle();
  const handle = `0x${handleBytes.readBigUInt64LE(0).toString(16)}`;
  const bounds = window.getBounds();
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    getDesktopWidgetScriptPath(),
    '-Mode',
    mode,
    '-Handle',
    handle,
    '-OwnerProcessId',
    String(process.pid),
    '-X',
    String(bounds.x),
    '-Y',
    String(bounds.y),
    '-Width',
    String(bounds.width),
    '-Height',
    String(bounds.height),
  ];
};

const getWindowModeState = (): WindowModeState => ({
  mode: currentWindowMode,
  desktopWidgetSupported: process.platform === 'win32',
  ...(currentWindowModeErrorKey ? { errorKey: currentWindowModeErrorKey } : {}),
});

const broadcastWindowModeState = () => {
  const state = getWindowModeState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.webContents.send('window:mode-changed', state);
  }
};

const sendDesktopWidgetBounds = () => {
  if (!desktopWidgetHelper || !mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  try {
    desktopWidgetHelper.stdin.write(
      `${JSON.stringify({ command: 'bounds', ...bounds })}\n`,
    );
  } catch {
    // The helper's exit handler will retry the attachment or return to floating mode.
  }
};

const parseDesktopWidgetHelperLine = (line: string) => {
  try {
    const value: unknown = JSON.parse(line);
    if (
      value &&
      typeof value === 'object' &&
      'code' in value &&
      typeof value.code === 'string'
    )
      return value.code;
  } catch {
    // Ignore non-status output so diagnostics never become renderer messages.
  }
  return undefined;
};

const startDesktopWidgetHelper = (window: BrowserWindow) =>
  new Promise<void>((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Desktop Widget is only available on Windows.'));
      return;
    }
    const powershellPath = getDesktopPowerShellPath();
    const scriptPath = getDesktopWidgetScriptPath();
    if (!fs.existsSync(powershellPath) || !fs.existsSync(scriptPath)) {
      reject(new Error('Desktop Widget helper is missing.'));
      return;
    }

    const child = spawn(
      powershellPath,
      getDesktopWindowArguments(window, 'Attach'),
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    desktopWidgetHelper = child;
    let output = '';
    let initialStatusReceived = false;
    let settled = false;
    let lastStatus = '';
    const startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Desktop Widget helper timed out.'));
      child.kill();
    }, 8000);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const lines = output.split(/\r?\n/);
      output = lines.pop() ?? '';
      for (const line of lines) {
        const code = parseDesktopWidgetHelperLine(line);
        if (!code) continue;
        if (!initialStatusReceived) {
          initialStatusReceived = true;
          lastStatus = code;
          clearTimeout(startupTimer);
          if (code === 'attached') {
            settled = true;
            resolve();
          } else {
            settled = true;
            reject(new Error(code));
          }
          continue;
        }
        if (code === lastStatus) continue;
        lastStatus = code;
        if (code === 'reattached' || code === 'attached') {
          currentWindowModeErrorKey = undefined;
        } else if (code === 'desktop-unavailable') {
          currentWindowModeErrorKey =
            'Windows 桌面正在重新加载，Daybyday 正在尝试恢复桌面便签。';
        } else {
          currentWindowModeErrorKey =
            '桌面便签暂时无法连接到 Windows 桌面，Daybyday 正在重试。';
        }
        broadcastWindowModeState();
      }
    });
    child.stderr.on('data', () => {
      // The helper emits stable status codes on stdout; avoid logging OS details or user data.
    });
    child.on('error', (error) => {
      clearTimeout(startupTimer);
      if (desktopWidgetHelper === child) desktopWidgetHelper = undefined;
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(startupTimer);
      if (desktopWidgetHelper === child) desktopWidgetHelper = undefined;
      if (!settled) {
        settled = true;
        reject(
          new Error(`Desktop Widget helper exited (${code ?? 'unknown'}).`),
        );
      }
      if (
        currentWindowMode === 'desktop-widget' &&
        !desktopWidgetTransition &&
        !isQuitting
      ) {
        if (desktopWidgetRecoveryTimer)
          clearTimeout(desktopWidgetRecoveryTimer);
        desktopWidgetRecoveryTimer = setTimeout(() => {
          desktopWidgetRecoveryTimer = undefined;
          void recoverDesktopWidgetHelper();
        }, 1200);
      }
    });
  });

const runDesktopWidgetDetach = (window: BrowserWindow) =>
  new Promise<void>((resolve, reject) => {
    if (
      process.platform !== 'win32' ||
      !fs.existsSync(getDesktopWidgetScriptPath())
    ) {
      reject(new Error('Desktop Widget helper is unavailable.'));
      return;
    }
    const child = spawn(
      getDesktopPowerShellPath(),
      getDesktopWindowArguments(window, 'Detach'),
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      child.kill();
      reject(new Error('Desktop Widget detach timed out.'));
    }, 5000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      reject(error);
    });
    child.on('exit', (code) => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      const status = output
        .split(/\r?\n/)
        .map(parseDesktopWidgetHelperLine)
        .find(Boolean);
      if (code === 0 && (status === 'detached' || status === 'window-missing'))
        resolve();
      else
        reject(new Error(`Desktop Widget detach failed (${status ?? code}).`));
    });
  });

const stopDesktopWidgetHelper = async (detach: boolean) => {
  const child = desktopWidgetHelper;
  if (!child) {
    if (
      detach &&
      currentWindowMode === 'desktop-widget' &&
      mainWindow &&
      !mainWindow.isDestroyed()
    )
      await runDesktopWidgetDetach(mainWindow);
    return;
  }
  const bounds = mainWindow?.isDestroyed()
    ? undefined
    : mainWindow?.getBounds();
  const command = detach
    ? {
        command: 'detach',
        x: bounds?.x ?? 0,
        y: bounds?.y ?? 0,
        width: bounds?.width ?? DEFAULT_WIDTH,
        height: bounds?.height ?? DEFAULT_HEIGHT,
      }
    : { command: 'stop' };
  const exit = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  try {
    child.stdin.write(`${JSON.stringify(command)}\n`);
  } catch {
    // The one-shot detach below is the safe fallback.
  }
  if (!detach) child.stdin.end();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const code = await Promise.race([
    exit,
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 3000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (code === null) child.kill();
  if (desktopWidgetHelper === child) desktopWidgetHelper = undefined;
  if (detach && code !== 0 && mainWindow && !mainWindow.isDestroyed())
    await runDesktopWidgetDetach(mainWindow);
};

const applyWindowMode = async (
  window: BrowserWindow,
  requestedMode: WindowMode,
): Promise<WindowModeState> => {
  if (desktopWidgetTransition) throw new Error('窗口模式设置失败，请重试。');
  desktopWidgetTransition = true;
  currentWindowModeErrorKey = undefined;
  try {
    if (requestedMode === 'desktop-widget') {
      if (process.platform !== 'win32') {
        await stopDesktopWidgetHelper(true).catch(() => undefined);
        window.setAlwaysOnTop(false);
        currentWindowMode = 'floating';
        currentWindowModeErrorKey =
          '桌面便签模式目前仅支持 Windows，已切回普通悬浮窗。';
      } else {
        window.setAlwaysOnTop(false);
        try {
          if (!desktopWidgetHelper) await startDesktopWidgetHelper(window);
          currentWindowMode = 'desktop-widget';
        } catch {
          await stopDesktopWidgetHelper(false).catch(() => undefined);
          await runDesktopWidgetDetach(window).catch(() => undefined);
          window.setAlwaysOnTop(false);
          currentWindowMode = 'floating';
          currentWindowModeErrorKey =
            'Windows 桌面便签挂接失败，已切回普通悬浮窗。';
        }
      }
    } else {
      await stopDesktopWidgetHelper(true);
      window.setAlwaysOnTop(requestedMode === 'always-on-top');
      currentWindowMode = requestedMode;
    }
    if (!saveWindowState())
      currentWindowModeErrorKey = '窗口模式已切换，但设置未能保存到本机。';
    broadcastWindowModeState();
    return getWindowModeState();
  } finally {
    desktopWidgetTransition = false;
  }
};

const recoverDesktopWidgetHelper = async () => {
  const window = mainWindow;
  if (
    currentWindowMode !== 'desktop-widget' ||
    !window ||
    window.isDestroyed() ||
    isQuitting
  )
    return;
  try {
    await startDesktopWidgetHelper(window);
  } catch {
    await runDesktopWidgetDetach(window).catch(() => undefined);
    window.setAlwaysOnTop(false);
    currentWindowMode = 'floating';
    currentWindowModeErrorKey = '桌面便签恢复失败，已切回普通悬浮窗。';
    saveWindowState();
    broadcastWindowModeState();
  }
};

const keepWindowVisible = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const current = mainWindow.getBounds();
  const visible = clampToVisibleDisplay(current);
  if (
    current.x !== visible.x ||
    current.y !== visible.y ||
    current.width !== visible.width ||
    current.height !== visible.height
  ) {
    mainWindow.setBounds(visible);
  }
  sendDesktopWidgetBounds();
  saveWindowState();
};

const getTrayIconPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, TRAY_ICON_FILE)
    : path.resolve(__dirname, '../../resources', TRAY_ICON_FILE);

const getSquirrelLauncherOptions = (openAtLogin: boolean) =>
  getSquirrelLoginItemOptions(process.execPath, openAtLogin);

const isWindowsStartupAvailable = () => {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  try {
    return fs.existsSync(getSquirrelLauncherOptions(false).path);
  } catch {
    return false;
  }
};

const readWindowsStartupEnabled = () => {
  if (!isWindowsStartupAvailable()) return false;
  try {
    const options = getSquirrelLauncherOptions(false);
    const settings = app.getLoginItemSettings(options);
    return settings.executableWillLaunchAtLogin ?? settings.openAtLogin;
  } catch {
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '无法读取 Windows 开机启动状态，请稍后重试。',
      ),
    );
  }
};

const getDesktopSettings = (): DesktopSettings => {
  const startupAvailable = isWindowsStartupAvailable();
  currentLaunchAtStartup = startupAvailable
    ? readWindowsStartupEnabled()
    : false;
  return {
    closeToTray: currentCloseToTray,
    launchAtStartup: currentLaunchAtStartup,
    startupAvailable,
  };
};

const refreshTrayMenu = () => {
  if (!tray || tray.isDestroyed()) return;
  const labels = getTrayMenuLabels(currentLanguageId);
  const mainWindowVisible = Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized(),
  );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindowVisible ? labels.hide : labels.show,
        click: () => {
          if (mainWindowVisible) {
            mainWindow?.hide();
            refreshTrayMenu();
          } else {
            showMainWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: labels.addTask,
        click: () => runTrayAction('quick-task'),
      },
      { label: labels.planner, click: () => runTrayAction('week') },
      { label: labels.settings, click: () => runTrayAction('settings') },
      { type: 'separator' },
      { label: labels.quit, click: quitApplication },
    ]),
  );
};

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  refreshTrayMenu();
};

const runTrayAction = (action: TrayAction) => {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindowReady) {
    pendingTrayAction = action;
    return;
  }
  mainWindow.webContents.send('desktop:tray-action', action);
};

const createTray = () => {
  if (tray && !tray.isDestroyed()) return;
  const icon = nativeImage.createFromPath(getTrayIconPath());
  if (icon.isEmpty()) {
    throw new Error(
      `The Daybyday tray icon could not be loaded: ${getTrayIconPath()}`,
    );
  }
  tray = new Tray(icon);
  tray.setToolTip('Daybyday');
  refreshTrayMenu();
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
};

const quitApplication = () => {
  isQuitting = true;
  saveWindowState();
  app.quit();
};

const registerOcrProtocol = () => {
  protocol.handle('daybyday-ocr', async (request) => {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }
    if (request.method !== 'GET')
      return new Response('Not found', { status: 404 });

    let assetPath: string | undefined;
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const ocrResourceRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'ocr')
      : path.join(app.getAppPath(), 'resources', 'ocr');
    if (url.hostname === 'worker' && relativePath === 'worker.min.js') {
      assetPath = path.join(ocrResourceRoot, 'runtime', 'worker.min.js');
    } else if (url.hostname === 'core' && relativePath === OCR_CORE_FILE) {
      assetPath = path.join(ocrResourceRoot, 'runtime', OCR_CORE_FILE);
    } else if (
      url.hostname === 'lang' &&
      (relativePath === 'chi_sim.traineddata.gz' ||
        relativePath === 'eng.traineddata.gz')
    ) {
      assetPath = path.join(ocrResourceRoot, 'lang', relativePath);
    }
    if (!assetPath) return new Response('Not found', { status: 404 });

    try {
      const content = fs.readFileSync(assetPath);
      const contentType = assetPath.endsWith('.wasm')
        ? 'application/wasm'
        : assetPath.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'application/gzip';
      return new Response(content, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Type': contentType,
        },
      });
    } catch {
      return new Response('Local OCR resource is missing.', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  });
};

const getTrustedWindow = (event: IpcMainInvokeEvent) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    !mainWindow ||
    senderWindow !== mainWindow ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error(
      'Window controls are only available to the DayByDay window.',
    );
  }
  return mainWindow;
};

type RestoredPreferences = SavedWindowState;

type RestoreJournal = {
  version: 1;
  phase: 'prepared' | 'old-moved' | 'new-moved';
  id: string;
  rollbackDatabaseName: string;
  stagedDatabaseName: string;
  hadWindowState: boolean;
  oldWindowStateBase64: string;
  oldStartupEnabled: boolean;
};

type StagedBackup = {
  metadata: BackupFileMetadata;
  preferences: RestoredPreferences;
  databasePath: string;
  summary: BackupRecordCounts;
};

const RESTORE_JOURNAL_FILE = '.restore-journal.json';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sha256Buffer = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const getErrorKind = (error: unknown) =>
  error instanceof Error ? error.name : 'UnknownError';

const localDateStamp = (value: Date) =>
  [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');

const localTimeStamp = (value: Date) =>
  `${localDateStamp(value)}-${String(value.getHours()).padStart(2, '0')}-${String(value.getMinutes()).padStart(2, '0')}-${String(value.getSeconds()).padStart(2, '0')}`;

const sha256File = async (filePath: string) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const getWindowStateBytes = () => {
  if (!saveWindowState())
    throw new Error('窗口和设置尚未保存，无法创建完整备份。');
  return fs.readFileSync(getStatePath());
};

const writeFileAtomically = (filePath: string, bytes: Buffer) => {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const id = randomUUID();
  const temporaryPath = path.join(directory, `.daybyday-write-${id}.tmp`);
  const previousPath = path.join(directory, `.daybyday-previous-${id}.tmp`);
  let movedPrevious = false;
  try {
    fs.writeFileSync(temporaryPath, bytes, { flag: 'wx' });
    const descriptor = fs.openSync(temporaryPath, 'r+');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, previousPath);
      movedPrevious = true;
    }
    fs.renameSync(temporaryPath, filePath);
    if (movedPrevious) fs.unlinkSync(previousPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      if (movedPrevious && fs.existsSync(previousPath)) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        fs.renameSync(previousPath, filePath);
      }
    } catch (rollbackError) {
      console.error(
        'Could not roll back an atomic Daybyday file write.',
        getErrorKind(rollbackError),
      );
    }
    throw error;
  }
};

const writeBackupFile = async (
  destinationPath: string,
  options: { allowInsideUserData?: boolean } = {},
) => {
  const resolvedDestination = path.resolve(destinationPath);
  const resolvedUserData = path.resolve(app.getPath('userData'));
  const insideUserData =
    resolvedDestination.toLowerCase() === resolvedUserData.toLowerCase() ||
    resolvedDestination
      .toLowerCase()
      .startsWith(`${resolvedUserData.toLowerCase()}${path.sep.toLowerCase()}`);
  if (insideUserData && !options.allowInsideUserData)
    throw new Error('为保护应用数据，请将备份保存到用户数据目录以外的位置。');

  const sourceDatabase = getPlannerDatabase();
  const preferencesBytes = getWindowStateBytes();
  if (preferencesBytes.length > MAX_BACKUP_PREFERENCES_BYTES)
    throw new Error('本机设置文件超过备份格式允许的大小。');

  const userDataPath = app.getPath('userData');
  const snapshotPath = path.join(
    userDataPath,
    `.daybyday-backup-snapshot-${randomUUID()}.sqlite`,
  );
  const destinationDirectory = path.dirname(destinationPath);
  const temporaryPath = path.join(
    destinationDirectory,
    `.daybyday-backup-${randomUUID()}.tmp`,
  );
  const previousPath = `${destinationPath}.previous-${randomUUID()}`;
  let movedPrevious = false;
  let backupCommitted = false;
  try {
    await sourceDatabase.backupTo(snapshotPath);
    const snapshotDatabase = new PlannerDatabase(
      snapshotPath,
      getSqliteDatabaseConstructor(),
    );
    let schemaVersion: number;
    let counts: BackupRecordCounts;
    try {
      const integrity = snapshotDatabase.getIntegrityCheck();
      if (
        integrity.integrity.length !== 1 ||
        integrity.integrity[0] !== 'ok' ||
        integrity.foreignKeyViolations !== 0
      )
        throw new Error('数据库快照完整性检查未通过。');
      schemaVersion = snapshotDatabase.getSchemaVersion();
      counts = snapshotDatabase.getBackupRecordCounts();
    } finally {
      snapshotDatabase.close();
    }

    const databaseInfo = fs.statSync(snapshotPath);
    const metadata: BackupFileMetadata = {
      format: 'daybyday-backup',
      formatVersion: 1,
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      database: {
        byteLength: databaseInfo.size,
        sha256: await sha256File(snapshotPath),
        schemaVersion,
        counts,
      },
      preferences: {
        byteLength: preferencesBytes.length,
        sha256: sha256Buffer(preferencesBytes),
      },
    };

    fs.mkdirSync(destinationDirectory, { recursive: true });
    fs.writeFileSync(temporaryPath, encodeBackupHeader(metadata), {
      flag: 'wx',
    });
    await pipeline(
      fs.createReadStream(snapshotPath),
      fs.createWriteStream(temporaryPath, { flags: 'a' }),
    );
    await fs.promises.appendFile(temporaryPath, preferencesBytes);
    const backupFile = await fs.promises.open(temporaryPath, 'r+');
    try {
      await backupFile.sync();
    } finally {
      await backupFile.close();
    }

    if (fs.existsSync(destinationPath)) {
      if (fs.statSync(destinationPath).isDirectory())
        throw new Error('备份保存位置必须是文件。');
      fs.renameSync(destinationPath, previousPath);
      movedPrevious = true;
    }
    try {
      fs.renameSync(temporaryPath, destinationPath);
      backupCommitted = true;
    } catch (error) {
      if (movedPrevious && fs.existsSync(previousPath)) {
        try {
          fs.renameSync(previousPath, destinationPath);
          movedPrevious = false;
        } catch (restoreError) {
          console.error(
            'Could not restore the previous Daybyday backup file.',
            getErrorKind(restoreError),
          );
        }
      }
      throw error;
    }
    if (movedPrevious) {
      try {
        fs.unlinkSync(previousPath);
        movedPrevious = false;
      } catch (error) {
        console.error(
          'Could not remove the replaced Daybyday backup file.',
          getErrorKind(error),
        );
      }
    }
  } finally {
    for (const filePath of [
      snapshotPath,
      `${snapshotPath}-wal`,
      `${snapshotPath}-shm`,
      temporaryPath,
    ]) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (error) {
        console.error(
          'Could not remove a temporary Daybyday backup file.',
          getErrorKind(error),
        );
      }
    }
    if (backupCommitted && movedPrevious) {
      try {
        fs.unlinkSync(previousPath);
      } catch (error) {
        console.error(
          'Could not remove the replaced Daybyday backup file.',
          getErrorKind(error),
        );
      }
    }
  }
};

const readBackupHeaderFromFile = (filePath: string) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const fileLength = fs.fstatSync(descriptor).size;
    const fixedPrefix = Buffer.alloc(getBackupFixedPrefixLength());
    const fixedBytes = fs.readSync(
      descriptor,
      fixedPrefix,
      0,
      fixedPrefix.length,
      0,
    );
    if (fixedBytes !== fixedPrefix.length) throw new Error('备份文件不完整。');
    const headerLength = getBackupHeaderLength(fixedPrefix);
    const header = Buffer.alloc(headerLength);
    const headerBytes = fs.readSync(descriptor, header, 0, header.length, 0);
    if (headerBytes !== header.length) throw new Error('备份文件信息不完整。');
    return parseBackupHeader(header, fileLength);
  } finally {
    fs.closeSync(descriptor);
  }
};

const parseRestoredPreferences = (bytes: Buffer): RestoredPreferences => {
  if (bytes.length < 2 || bytes.length > MAX_BACKUP_PREFERENCES_BYTES)
    throw new Error('备份中的偏好设置长度无效。');
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('备份中的偏好设置无法读取。');
  }
  if (!isPlainRecord(value)) throw new Error('备份中的偏好设置无效。');
  const width = value.width;
  const height = value.height;
  if (
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width < MIN_WIDTH ||
    width > 16384 ||
    height < MIN_HEIGHT ||
    height > 16384 ||
    typeof value.alwaysOnTop !== 'boolean' ||
    typeof value.closeToTray !== 'boolean' ||
    typeof value.launchAtStartup !== 'boolean'
  )
    throw new Error('备份中的窗口偏好设置无效。');
  const x = value.x;
  const y = value.y;
  if (
    (x !== undefined && (!isFiniteNumber(x) || Math.abs(x) > 10000000)) ||
    (y !== undefined && (!isFiniteNumber(y) || Math.abs(y) > 10000000)) ||
    (x === undefined) !== (y === undefined)
  )
    throw new Error('备份中的窗口位置无效。');
  return {
    ...(x !== undefined && y !== undefined
      ? { x: Math.round(x), y: Math.round(y) }
      : {}),
    width: Math.round(width),
    height: Math.round(height),
    alwaysOnTop:
      normalizeStoredWindowMode(value.windowMode, value.alwaysOnTop) ===
      'always-on-top',
    windowMode: normalizeStoredWindowMode(value.windowMode, value.alwaysOnTop),
    closeToTray: value.closeToTray,
    launchAtStartup: value.launchAtStartup,
    fontSizeScale: normalizeStoredFontSizeScale(value.fontSizeScale),
    themeId: parseThemeId(value.themeId),
    languageId: parseLanguageId(value.languageId),
  };
};

const readBackupPreferences = (
  filePath: string,
  layout: BackupPayloadLayout,
) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const bytes = Buffer.alloc(layout.metadata.preferences.byteLength);
    const bytesRead = fs.readSync(
      descriptor,
      bytes,
      0,
      bytes.length,
      layout.preferencesOffset,
    );
    if (bytesRead !== bytes.length) throw new Error('备份中的偏好设置不完整。');
    if (sha256Buffer(bytes) !== layout.metadata.preferences.sha256)
      throw new Error('备份中的偏好设置校验失败。');
    return parseRestoredPreferences(bytes);
  } finally {
    fs.closeSync(descriptor);
  }
};

const restoreWindowStateBytes = (
  hadWindowState: boolean,
  bytes: Buffer | undefined,
) => {
  if (hadWindowState && bytes) writeFileAtomically(getStatePath(), bytes);
  else if (fs.existsSync(getStatePath())) fs.unlinkSync(getStatePath());
};

const parseRestoreJournal = (value: unknown): RestoreJournal => {
  if (
    !isPlainRecord(value) ||
    value.version !== 1 ||
    (value.phase !== 'prepared' &&
      value.phase !== 'old-moved' &&
      value.phase !== 'new-moved') ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.id) ||
    value.rollbackDatabaseName !==
      `.daybyday-restore-rollback-${value.id}.sqlite` ||
    value.stagedDatabaseName !==
      `.daybyday-restore-staging-${value.id}.sqlite` ||
    typeof value.hadWindowState !== 'boolean' ||
    typeof value.oldWindowStateBase64 !== 'string' ||
    value.oldWindowStateBase64.length > 349528 ||
    typeof value.oldStartupEnabled !== 'boolean'
  )
    throw new Error('恢复操作记录无效；为保护数据，数据库没有打开。');
  if (value.hadWindowState) {
    const oldStateBytes = Buffer.from(value.oldWindowStateBase64, 'base64');
    if (oldStateBytes.toString('base64') !== value.oldWindowStateBase64)
      throw new Error('恢复操作记录中的设置备份无效。');
    parseRestoredPreferences(oldStateBytes);
  } else if (value.oldWindowStateBase64 !== '') {
    throw new Error('恢复操作记录中的设置备份无效。');
  }
  return value as unknown as RestoreJournal;
};

const recoverPendingRestore = () => {
  const journalPath = path.join(app.getPath('userData'), RESTORE_JOURNAL_FILE);
  if (!fs.existsSync(journalPath)) return;
  const journal = parseRestoreJournal(
    JSON.parse(fs.readFileSync(journalPath, 'utf8')) as unknown,
  );
  const userDataPath = app.getPath('userData');
  const liveDatabasePath = getDatabasePath();
  const rollbackPath = path.join(userDataPath, journal.rollbackDatabaseName);
  const stagedPath = path.join(userDataPath, journal.stagedDatabaseName);
  if (journal.phase === 'prepared') {
    if (hasDatabaseBundle(rollbackPath))
      restorePartialDatabaseBundle(rollbackPath, liveDatabasePath);
  } else if (fs.existsSync(rollbackPath)) {
    removeDatabaseBundle(liveDatabasePath);
    restorePartialDatabaseBundle(rollbackPath, liveDatabasePath);
  } else if (hasDatabaseBundle(rollbackPath)) {
    // A prior recovery may have moved the old main file and been interrupted
    // while returning its WAL/SHM sidecars. Finish the same idempotent merge.
    restorePartialDatabaseBundle(rollbackPath, liveDatabasePath);
  } else if (!fs.existsSync(liveDatabasePath)) {
    throw new Error('恢复中断后找不到原数据库；原始文件没有被删除。');
  }

  const oldStateBytes = journal.oldWindowStateBase64
    ? Buffer.from(journal.oldWindowStateBase64, 'base64')
    : undefined;
  restoreWindowStateBytes(journal.hadWindowState, oldStateBytes);
  currentLaunchAtStartup = journal.oldStartupEnabled;
  if (isWindowsStartupAvailable()) {
    app.setLoginItemSettings({
      ...getSquirrelLauncherOptions(journal.oldStartupEnabled),
      enabled: true,
    });
  }
  removeDatabaseBundle(stagedPath);
  fs.unlinkSync(journalPath);
};

const stageBackup = async (
  filePath: string,
  id: string,
): Promise<StagedBackup> => {
  const layout = readBackupHeaderFromFile(filePath);
  if (layout.metadata.database.schemaVersion > CURRENT_SCHEMA_VERSION)
    throw new Error('此备份由更新版本的 Daybyday 创建，当前版本无法恢复。');
  const userDataPath = app.getPath('userData');
  const stagedDatabasePath = path.join(
    userDataPath,
    `.daybyday-restore-staging-${id}.sqlite`,
  );
  const databaseEnd =
    layout.databaseOffset + layout.metadata.database.byteLength - 1;
  try {
    await pipeline(
      fs.createReadStream(filePath, {
        start: layout.databaseOffset,
        end: databaseEnd,
      }),
      fs.createWriteStream(stagedDatabasePath, { flags: 'wx' }),
    );
    if (
      (await sha256File(stagedDatabasePath)) !== layout.metadata.database.sha256
    )
      throw new Error('备份中的数据库校验失败。');
    const preferences = readBackupPreferences(filePath, layout);
    const SqliteDatabase = getSqliteDatabaseConstructor();
    const rawDatabase = new SqliteDatabase(stagedDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const actualVersion = rawDatabase.pragma('user_version', {
        simple: true,
      }) as number;
      const integrity = rawDatabase.pragma('integrity_check') as Array<{
        integrity_check: string;
      }>;
      const foreignKeys = rawDatabase.pragma('foreign_key_check') as unknown[];
      if (actualVersion !== layout.metadata.database.schemaVersion)
        throw new Error('备份数据库版本与备份信息不一致。');
      if (
        integrity.length !== 1 ||
        integrity[0].integrity_check !== 'ok' ||
        foreignKeys.length !== 0
      )
        throw new Error('备份数据库完整性检查未通过。');
    } finally {
      rawDatabase.close();
    }

    const migratedDatabase = new PlannerDatabase(
      stagedDatabasePath,
      SqliteDatabase,
    );
    let summary: BackupRecordCounts;
    try {
      const integrity = migratedDatabase.getIntegrityCheck();
      if (
        integrity.integrity.length !== 1 ||
        integrity.integrity[0] !== 'ok' ||
        integrity.foreignKeyViolations !== 0
      )
        throw new Error('备份迁移后的数据库完整性检查未通过。');
      summary = migratedDatabase.getBackupRecordCounts();
    } finally {
      migratedDatabase.close();
    }
    return {
      metadata: layout.metadata,
      preferences,
      databasePath: stagedDatabasePath,
      summary,
    };
  } catch (error) {
    removeDatabaseBundle(stagedDatabasePath);
    throw error;
  }
};

const formatRestoreSummary = (
  language: LanguageId,
  counts: BackupRecordCounts,
) =>
  translateForLanguage(
    language,
    '备份包含 {{tasks}} 项待办、{{events}} 项日程、{{semesters}} 个学期、{{courses}} 门课程和 {{courseExceptions}} 条调课记录。',
  )
    .replaceAll('{{tasks}}', String(counts.tasks))
    .replaceAll('{{events}}', String(counts.events))
    .replaceAll('{{semesters}}', String(counts.semesters))
    .replaceAll('{{courses}}', String(counts.courses))
    .replaceAll('{{courseExceptions}}', String(counts.courseExceptions));

const formatBackupOrigin = (
  language: LanguageId,
  metadata: BackupFileMetadata,
) =>
  translateForLanguage(language, '备份版本 {{version}} · 创建时间 {{date}}')
    .replaceAll('{{version}}', metadata.appVersion)
    .replaceAll(
      '{{date}}',
      new Intl.DateTimeFormat(language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(metadata.createdAt)),
    );

const createUserBackup = async (window: BrowserWindow) => {
  const date = localDateStamp(new Date());
  const saveResult = await dialog.showSaveDialog(window, {
    title: translateForLanguage(currentLanguageId, 'Backup Data'),
    defaultPath: path.join(
      app.getPath('documents'),
      `Daybyday-backup-${date}.ddb`,
    ),
    filters: [{ name: 'Daybyday backup', extensions: ['ddb'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { cancelled: true };

  try {
    await writeBackupFile(saveResult.filePath);
    return { cancelled: false, filePath: saveResult.filePath };
  } catch (error) {
    console.error(
      'Could not create a Daybyday data backup.',
      getErrorKind(error),
    );
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '无法创建备份，请检查磁盘空间和文件权限后重试。',
      ),
    );
  }
};

const applyStartupSetting = (enabled: boolean) => {
  if (!isWindowsStartupAvailable()) return false;
  app.setLoginItemSettings({
    ...getSquirrelLauncherOptions(enabled),
    enabled: true,
  });
  const actual = readWindowsStartupEnabled();
  if (actual !== enabled)
    throw new Error('Windows 开机启动状态与恢复设置不一致。');
  return actual;
};

const restoreUserBackup = async (window: BrowserWindow) => {
  const openResult = await dialog.showOpenDialog(window, {
    title: translateForLanguage(currentLanguageId, 'Restore Data'),
    properties: ['openFile'],
    filters: [
      { name: 'Daybyday backup', extensions: ['ddb'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (openResult.canceled || openResult.filePaths.length !== 1)
    return { cancelled: true, restored: false };

  const backupPath = openResult.filePaths[0];
  const operationId = randomUUID();
  let staged: StagedBackup | undefined;
  try {
    staged = await stageBackup(backupPath, operationId);
  } catch (error) {
    console.error(
      'A selected Daybyday backup did not validate.',
      getErrorKind(error),
    );
    removeDatabaseBundle(
      path.join(
        app.getPath('userData'),
        `.daybyday-restore-staging-${operationId}.sqlite`,
      ),
    );
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '备份文件无法验证或数据库不兼容；当前数据没有更改。',
      ),
    );
  }

  let confirmation: Electron.MessageBoxReturnValue;
  try {
    confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: translateForLanguage(
        currentLanguageId,
        'Restore this Daybyday backup?',
      ),
      message: translateForLanguage(
        currentLanguageId,
        '恢复会替换这台电脑上的本地待办、日程、学期课程和偏好设置。',
      ),
      detail: `${formatBackupOrigin(currentLanguageId, staged.metadata)}\n${formatRestoreSummary(currentLanguageId, staged.summary)}\n\n${translateForLanguage(
        currentLanguageId,
        '继续前会自动备份当前数据；如果恢复失败，Daybyday 会回滚到恢复前的数据。',
      )}`,
      buttons: [
        translateForLanguage(currentLanguageId, '取消'),
        translateForLanguage(currentLanguageId, 'Restore Data'),
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  } catch (error) {
    removeDatabaseBundle(staged.databasePath);
    throw error;
  }
  if (confirmation.response !== 1) {
    removeDatabaseBundle(staged.databasePath);
    return { cancelled: true, restored: false };
  }

  const userDataPath = app.getPath('userData');
  const recoveryDirectory = path.join(userDataPath, 'recovery');
  try {
    fs.mkdirSync(recoveryDirectory, { recursive: true });
  } catch {
    removeDatabaseBundle(staged.databasePath);
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '无法创建恢复前安全备份；现有数据没有更改。',
      ),
    );
  }
  const recoveryName = `Daybyday-pre-restore-${localTimeStamp(new Date())}-${operationId.slice(0, 8)}.ddb`;
  const recoveryPath = path.join(recoveryDirectory, recoveryName);
  try {
    await writeBackupFile(recoveryPath, { allowInsideUserData: true });
  } catch (error) {
    console.error(
      'Could not create the pre-restore safety backup.',
      getErrorKind(error),
    );
    removeDatabaseBundle(staged.databasePath);
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '无法创建恢复前安全备份；现有数据没有更改。',
      ),
    );
  }

  let oldWindowStateBytes: Buffer;
  let oldStartupEnabled: boolean;
  try {
    oldWindowStateBytes = getWindowStateBytes();
    oldStartupEnabled = isWindowsStartupAvailable()
      ? readWindowsStartupEnabled()
      : currentLaunchAtStartup;
  } catch (error) {
    removeDatabaseBundle(staged.databasePath);
    console.error(
      'Could not read state before a Daybyday restore.',
      getErrorKind(error),
    );
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '无法读取当前偏好设置；现有数据未更改，恢复前安全备份已保留。',
      ),
    );
  }
  const rollbackDatabaseName = `.daybyday-restore-rollback-${operationId}.sqlite`;
  const stagedDatabaseName = `.daybyday-restore-staging-${operationId}.sqlite`;
  const rollbackDatabasePath = path.join(userDataPath, rollbackDatabaseName);
  const stagedDatabasePath = path.join(userDataPath, stagedDatabaseName);
  const journalPath = path.join(userDataPath, RESTORE_JOURNAL_FILE);
  const hadWindowState = fs.existsSync(getStatePath());
  const journal: RestoreJournal = {
    version: 1,
    phase: 'prepared',
    id: operationId,
    rollbackDatabaseName,
    stagedDatabaseName,
    hadWindowState,
    oldWindowStateBase64: hadWindowState
      ? oldWindowStateBytes.toString('base64')
      : '',
    oldStartupEnabled,
  };
  const previousState = readWindowState();
  let replacementCommitted = false;

  try {
    writeFileAtomically(
      journalPath,
      Buffer.from(JSON.stringify(journal), 'utf8'),
    );
    plannerDatabase?.close();
    plannerDatabase = undefined;
    moveDatabaseBundle(getDatabasePath(), rollbackDatabasePath);
    journal.phase = 'old-moved';
    writeFileAtomically(
      journalPath,
      Buffer.from(JSON.stringify(journal), 'utf8'),
    );
    moveDatabaseBundle(stagedDatabasePath, getDatabasePath());
    journal.phase = 'new-moved';
    writeFileAtomically(
      journalPath,
      Buffer.from(JSON.stringify(journal), 'utf8'),
    );

    const restoredDatabase = new PlannerDatabase(
      getDatabasePath(),
      getSqliteDatabaseConstructor(),
    );
    plannerDatabase = restoredDatabase;
    const integrity = restoredDatabase.getIntegrityCheck();
    if (
      integrity.integrity.length !== 1 ||
      integrity.integrity[0] !== 'ok' ||
      integrity.foreignKeyViolations !== 0
    )
      throw new Error('恢复后的数据库完整性检查未通过。');

    const restoredPreferences = staged.preferences;
    if (isWindowsStartupAvailable())
      currentLaunchAtStartup = applyStartupSetting(
        restoredPreferences.launchAtStartup,
      );
    else currentLaunchAtStartup = false;
    currentCloseToTray = restoredPreferences.closeToTray;
    currentFontSizeScale = restoredPreferences.fontSizeScale;
    currentThemeId = restoredPreferences.themeId;
    currentLanguageId = restoredPreferences.languageId;
    const restoredBounds = getInitialBounds(restoredPreferences);
    window.setBounds(restoredBounds, false);
    await applyWindowMode(window, restoredPreferences.windowMode);
    window.setBackgroundColor(getThemeDefinition(currentThemeId).background);
    if (!saveWindowState()) throw new Error('恢复后的偏好设置未能写入本机。');

    fs.unlinkSync(journalPath);
    replacementCommitted = true;
    removeDatabaseBundle(rollbackDatabasePath);
    const preferences = {
      themeId: currentThemeId,
      languageId: currentLanguageId,
      fontSizeScale: currentFontSizeScale,
    };
    try {
      refreshTrayMenu();
      for (const openWindow of BrowserWindow.getAllWindows()) {
        if (openWindow.isDestroyed()) continue;
        openWindow.webContents.send(
          'settings:preferences-changed',
          preferences,
        );
        openWindow.webContents.send('data:restored');
      }
    } catch (error) {
      console.error(
        'Could not refresh the Daybyday window after restore.',
        getErrorKind(error),
      );
    }
    return {
      cancelled: false,
      restored: true,
      recoveryPath,
      counts: staged.summary,
    };
  } catch (error) {
    console.error(
      'Could not complete a Daybyday data restore.',
      getErrorKind(error),
    );
    try {
      if (replacementCommitted) {
        throw new Error('恢复操作已提交，未启动回滚流程。');
      }
      plannerDatabase?.close();
      plannerDatabase = undefined;
      if (fs.existsSync(journalPath)) recoverPendingRestore();
      else if (fs.existsSync(rollbackDatabasePath)) {
        if (fs.existsSync(getDatabasePath())) {
          const rejectedPath = path.join(
            userDataPath,
            `.daybyday-restore-incomplete-${randomUUID()}.sqlite`,
          );
          moveDatabaseBundle(getDatabasePath(), rejectedPath);
          removeDatabaseBundle(rejectedPath);
        }
        moveDatabaseBundle(rollbackDatabasePath, getDatabasePath());
        restoreWindowStateBytes(hadWindowState, oldWindowStateBytes);
      }
      currentFontSizeScale = previousState.fontSizeScale;
      currentThemeId = previousState.themeId;
      currentLanguageId = previousState.languageId;
      currentCloseToTray = previousState.closeToTray;
      currentLaunchAtStartup = oldStartupEnabled;
      if (isWindowsStartupAvailable()) applyStartupSetting(oldStartupEnabled);
      window.setBounds(getInitialBounds(previousState), false);
      await applyWindowMode(window, previousState.windowMode);
      window.setBackgroundColor(
        getThemeDefinition(previousState.themeId).background,
      );
      plannerDatabase = new PlannerDatabase(
        getDatabasePath(),
        getSqliteDatabaseConstructor(),
      );
      refreshTrayMenu();
    } catch (rollbackError) {
      console.error(
        'Could not roll back the Daybyday restore.',
        getErrorKind(rollbackError),
      );
      throw new Error(
        translateForLanguage(
          currentLanguageId,
          '恢复失败，Daybyday 无法完成自动回滚；请保留 recovery 文件夹中的安全备份。',
        ),
      );
    } finally {
      removeDatabaseBundle(staged.databasePath);
    }
    throw new Error(
      translateForLanguage(
        currentLanguageId,
        '恢复失败，已回滚到恢复前的数据；安全备份仍保存在 recovery 文件夹。',
      ),
    );
  }
};

const registerWindowControls = () => {
  ipcMain.on('settings:get-initial-theme', (event: IpcMainEvent) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    event.returnValue =
      mainWindow &&
      senderWindow === mainWindow &&
      event.senderFrame === event.sender.mainFrame
        ? currentThemeId
        : 'classic';
  });
  ipcMain.on('settings:get-initial-language', (event: IpcMainEvent) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    event.returnValue =
      mainWindow &&
      senderWindow === mainWindow &&
      event.senderFrame === event.sender.mainFrame
        ? currentLanguageId
        : 'zh-CN';
  });
  const broadcastPreferences = () => {
    const preferences = {
      themeId: currentThemeId,
      languageId: currentLanguageId,
      fontSizeScale: currentFontSizeScale,
    };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send('settings:preferences-changed', preferences);
    }
  };
  ipcMain.handle('window:get-mode', (event) => {
    getTrustedWindow(event);
    return getWindowModeState();
  });
  ipcMain.handle('window:set-mode', async (event, mode: unknown) => {
    const window = getTrustedWindow(event);
    return applyWindowMode(window, parseWindowMode(mode));
  });
  ipcMain.handle('window:minimize', (event) => {
    const window = getTrustedWindow(event);
    if (currentWindowMode === 'desktop-widget') {
      window.hide();
      refreshTrayMenu();
    } else window.minimize();
  });
  ipcMain.handle('data:backup', async (event) => {
    const window = getTrustedWindow(event);
    if (dataOperationInProgress)
      throw new Error(
        translateForLanguage(
          currentLanguageId,
          '另一项数据操作正在进行，请稍后再试。',
        ),
      );
    dataOperationInProgress = true;
    try {
      return await createUserBackup(window);
    } finally {
      dataOperationInProgress = false;
      if (quitAfterDataOperation) {
        quitAfterDataOperation = false;
        app.quit();
      }
    }
  });
  ipcMain.handle('data:restore', async (event) => {
    const window = getTrustedWindow(event);
    if (dataOperationInProgress)
      throw new Error(
        translateForLanguage(
          currentLanguageId,
          '另一项数据操作正在进行，请稍后再试。',
        ),
      );
    dataOperationInProgress = true;
    try {
      return await restoreUserBackup(window);
    } finally {
      dataOperationInProgress = false;
      if (quitAfterDataOperation) {
        quitAfterDataOperation = false;
        app.quit();
      }
    }
  });
  ipcMain.handle('window:close', (event) => {
    getTrustedWindow(event).close();
  });
  ipcMain.handle('window:set-import-mode', (event, enabled: unknown) => {
    const window = getTrustedWindow(event);
    if (typeof enabled !== 'boolean') throw new Error('导入页面窗口选项无效。');
    if (enabled && !boundsBeforeImportMode) {
      boundsBeforeImportMode = window.getBounds();
      const { workArea } = screen.getDisplayMatching(boundsBeforeImportMode);
      window.setBounds(
        clampToVisibleDisplay({
          ...boundsBeforeImportMode,
          width: Math.min(1180, workArea.width),
          height: Math.min(900, workArea.height),
        }),
        true,
      );
    } else if (!enabled && boundsBeforeImportMode) {
      window.setBounds(clampToVisibleDisplay(boundsBeforeImportMode), true);
      boundsBeforeImportMode = undefined;
    }
  });
  ipcMain.handle('settings:get-font-size-scale', (event) => {
    getTrustedWindow(event);
    return currentFontSizeScale;
  });
  ipcMain.handle('settings:set-font-size-scale', (event, value: unknown) => {
    getTrustedWindow(event);
    const previousValue = currentFontSizeScale;
    currentFontSizeScale = parseFontSizeScale(value);
    if (!saveWindowState()) {
      currentFontSizeScale = previousValue;
      throw new Error(
        '字体设置未能保存到本机，请检查用户数据目录写入权限后重试。',
      );
    }
    broadcastPreferences();
    return currentFontSizeScale;
  });
  ipcMain.handle('settings:set-theme', (event, value: unknown) => {
    getTrustedWindow(event);
    const previousValue = currentThemeId;
    currentThemeId = parseThemeId(value);
    if (!saveWindowState()) {
      currentThemeId = previousValue;
      throw new Error(
        '主题设置未能保存到本机，请检查用户数据目录写入权限后重试。',
      );
    }
    broadcastPreferences();
    return currentThemeId;
  });
  ipcMain.handle('settings:set-language', (event, value: unknown) => {
    getTrustedWindow(event);
    const previousValue = currentLanguageId;
    currentLanguageId = parseLanguageId(value);
    if (!saveWindowState()) {
      currentLanguageId = previousValue;
      refreshTrayMenu();
      throw new Error(
        '语言设置未能保存到本机，请检查用户数据目录写入权限后重试。',
      );
    }
    refreshTrayMenu();
    broadcastPreferences();
    return currentLanguageId;
  });
  ipcMain.handle('settings:get-desktop', (event) => {
    getTrustedWindow(event);
    return getDesktopSettings();
  });
  ipcMain.handle('settings:set-close-to-tray', (event, enabled: unknown) => {
    getTrustedWindow(event);
    if (typeof enabled !== 'boolean') throw new Error('关闭到托盘选项无效。');
    const previousValue = currentCloseToTray;
    currentCloseToTray = enabled;
    if (!saveWindowState()) {
      currentCloseToTray = previousValue;
      throw new Error(
        '窗口设置未能保存到本机，请检查用户数据目录写入权限后重试。',
      );
    }
    return currentCloseToTray;
  });
  ipcMain.handle(
    'settings:set-launch-at-startup',
    (event, enabled: unknown) => {
      getTrustedWindow(event);
      if (typeof enabled !== 'boolean')
        throw new Error('Windows 开机启动选项无效。');
      if (!isWindowsStartupAvailable()) {
        throw new Error(
          translateForLanguage(
            currentLanguageId,
            '仅正式安装版支持开机启动；开发版本不会创建 Windows 启动项。',
          ),
        );
      }

      const previousValue = readWindowsStartupEnabled();
      const options = getSquirrelLauncherOptions(enabled);
      const restorePreviousSetting = () => {
        try {
          app.setLoginItemSettings({
            ...getSquirrelLauncherOptions(previousValue),
            enabled: true,
          });
        } catch {
          // Best effort if Windows no longer permits this change.
        }
      };
      let actualValue: boolean;
      try {
        app.setLoginItemSettings({ ...options, enabled: true });
        actualValue = readWindowsStartupEnabled();
      } catch {
        restorePreviousSetting();
        throw new Error(
          translateForLanguage(
            currentLanguageId,
            '无法更新 Windows 开机启动设置，请检查安装位置和当前用户权限后重试。',
          ),
        );
      }
      if (actualValue !== enabled) {
        restorePreviousSetting();
        throw new Error(
          translateForLanguage(
            currentLanguageId,
            '无法更新 Windows 开机启动设置，请检查安装位置和当前用户权限后重试。',
          ),
        );
      }
      currentLaunchAtStartup = actualValue;
      if (!saveWindowState()) {
        currentLaunchAtStartup = previousValue;
        restorePreviousSetting();
        throw new Error(
          '窗口设置未能保存到本机，请检查用户数据目录写入权限后重试。',
        );
      }
      return getDesktopSettings();
    },
  );

  ipcMain.handle('planner:get-day', (event, date: unknown) => {
    getTrustedWindow(event);
    assertDateKey(date);
    const database = getPlannerDatabase();
    return {
      tasks: database.listTasks(date),
      events: database.listEvents(date),
      courses: database.listCourseOccurrences(date, date),
      semester: database.getCurrentSemester(),
      teachingWeek: database.getTeachingWeek(date),
    };
  });
  ipcMain.handle('task:create', (event, input: unknown) => {
    getTrustedWindow(event);
    return getPlannerDatabase().createTask(parseTaskInput(input));
  });
  ipcMain.handle('task:update', (event, input: unknown) => {
    getTrustedWindow(event);
    const update = parseTaskUpdate(input);
    return getPlannerDatabase().updateTask(update.id, update);
  });
  ipcMain.handle(
    'task:set-completed',
    (event, id: unknown, isCompleted: unknown) => {
      getTrustedWindow(event);
      assertId(id);
      if (typeof isCompleted !== 'boolean')
        throw new Error('待办完成状态无效。');
      return getPlannerDatabase().setTaskCompleted(id, isCompleted);
    },
  );
  ipcMain.handle('task:delete', (event, id: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    getPlannerDatabase().deleteTask(id);
  });
  ipcMain.handle('task:move', (event, id: unknown, direction: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    const moveDirection: MoveDirection = parseMoveDirection(direction);
    getPlannerDatabase().moveTask(id, moveDirection);
  });
  ipcMain.handle('event:create', (event, input: unknown) => {
    getTrustedWindow(event);
    return getPlannerDatabase().createEvent(parseEventInput(input));
  });
  ipcMain.handle('event:update', (event, input: unknown) => {
    getTrustedWindow(event);
    const update = parseEventUpdate(input);
    return getPlannerDatabase().updateEvent(update.id, update);
  });
  ipcMain.handle('event:delete', (event, id: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    getPlannerDatabase().deleteEvent(id);
  });

  ipcMain.handle('semester:list', (event) => {
    getTrustedWindow(event);
    return getPlannerDatabase().listSemesters();
  });
  ipcMain.handle('semester:create', (event, input: unknown) => {
    getTrustedWindow(event);
    return getPlannerDatabase().createSemester(parseSemesterInput(input));
  });
  ipcMain.handle('semester:update', (event, id: unknown, input: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    return getPlannerDatabase().updateSemester(id, parseSemesterInput(input));
  });
  ipcMain.handle('semester:set-current', (event, id: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    return getPlannerDatabase().setCurrentSemester(id);
  });
  ipcMain.handle('course:list', (event, semesterId: unknown) => {
    getTrustedWindow(event);
    assertId(semesterId);
    return getPlannerDatabase().listCourses(semesterId);
  });
  ipcMain.handle('course:create', (event, input: unknown) => {
    getTrustedWindow(event);
    return getPlannerDatabase().createCourse(parseCourseInput(input));
  });
  ipcMain.handle(
    'course:analyze-import',
    (event, semesterId: unknown, rawCourses: unknown) => {
      getTrustedWindow(event);
      assertId(semesterId);
      const courses = parseCourseImportInputs(semesterId, rawCourses);
      return getPlannerDatabase().analyzeCourseImport(semesterId, courses);
    },
  );
  ipcMain.handle(
    'course:import-batch',
    (
      event,
      semesterId: unknown,
      rawCourses: unknown,
      rawDecisions: unknown,
    ) => {
      getTrustedWindow(event);
      assertId(semesterId);
      const courses = parseCourseImportInputs(semesterId, rawCourses);
      const database = getPlannerDatabase();
      const currentAnalysis = database.analyzeCourseImport(semesterId, courses);
      const duplicateIndexes = new Set(
        currentAnalysis.duplicates.map((duplicate) => duplicate.courseIndex),
      );
      const decisions: CourseImportDecision[] = parseCourseImportDecisions(
        rawDecisions,
        courses.length,
        duplicateIndexes,
      );
      return database.importCourses(semesterId, courses, decisions);
    },
  );
  ipcMain.handle('import:analyze-batch', (event, rawPayload: unknown) => {
    getTrustedWindow(event);
    const payload = parseImportBatchPayload(rawPayload);
    return getPlannerDatabase().analyzeImportBatch(payload);
  });
  ipcMain.handle(
    'import:commit-batch',
    (event, rawPayload: unknown, rawDecisions: unknown) => {
      getTrustedWindow(event);
      const payload = parseImportBatchPayload(rawPayload);
      const database = getPlannerDatabase();
      const currentAnalysis = database.analyzeImportBatch(payload);
      const duplicateIndexes = new Set(
        currentAnalysis.duplicates.map((duplicate) => duplicate.itemIndex),
      );
      const decisions = parseImportBatchDecisions(
        rawDecisions,
        payload.items.length,
        duplicateIndexes,
      );
      return database.importBatch(payload, decisions);
    },
  );
  ipcMain.handle('import:undo-batch', (event, batchId: unknown) => {
    getTrustedWindow(event);
    assertId(batchId);
    return getPlannerDatabase().undoImportBatch(batchId);
  });
  ipcMain.handle('import:list-batches', (event, semesterId: unknown) => {
    getTrustedWindow(event);
    assertId(semesterId);
    return getPlannerDatabase().listImportBatches(semesterId);
  });
  ipcMain.handle('class-periods:list', (event) => {
    getTrustedWindow(event);
    return getPlannerDatabase().getClassPeriodTimes();
  });
  ipcMain.handle('class-periods:save', (event, periods: unknown) => {
    getTrustedWindow(event);
    return getPlannerDatabase().saveClassPeriodTimes(
      parseClassPeriodTimes(periods),
    );
  });
  ipcMain.handle(
    'course:update-series',
    (event, id: unknown, input: unknown, exceptionPolicy: unknown) => {
      getTrustedWindow(event);
      assertId(id);
      return getPlannerDatabase().updateCourseSeries(
        id,
        parseCourseInput(input),
        parseSeriesExceptionPolicy(exceptionPolicy),
      );
    },
  );
  ipcMain.handle('course:delete-series', (event, id: unknown) => {
    getTrustedWindow(event);
    assertId(id);
    getPlannerDatabase().deleteCourseSeries(id);
  });
  ipcMain.handle('course:save-exception', (event, input: unknown) => {
    getTrustedWindow(event);
    getPlannerDatabase().saveCourseException(parseCourseExceptionInput(input));
  });
  ipcMain.handle(
    'course:delete-exception',
    (event, courseId: unknown, originalDate: unknown) => {
      getTrustedWindow(event);
      assertId(courseId);
      assertDateKey(originalDate);
      getPlannerDatabase().deleteCourseException(courseId, originalDate);
    },
  );
};

const createWindow = () => {
  const savedState = readWindowState();
  mainWindowReady = false;
  currentWindowMode = savedState.windowMode;
  currentWindowModeErrorKey = undefined;
  currentFontSizeScale = savedState.fontSizeScale;
  currentThemeId = savedState.themeId;
  currentLanguageId = savedState.languageId;
  currentCloseToTray = savedState.closeToTray;
  currentLaunchAtStartup = savedState.launchAtStartup;
  const bounds = getInitialBounds(savedState);
  const options: BrowserWindowConstructorOptions = {
    title: 'Daybyday',
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    resizable: true,
    backgroundColor: getThemeDefinition(savedState.themeId).background,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  mainWindow = new BrowserWindow(options);
  mainWindow.setAlwaysOnTop(savedState.windowMode === 'always-on-top');

  mainWindow.once('ready-to-show', () => {
    void (async () => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) return;
      if (savedState.windowMode === 'desktop-widget')
        await applyWindowMode(window, savedState.windowMode);
      mainWindowReady = true;
      window.show();
      if (pendingTrayAction && mainWindow) {
        const action = pendingTrayAction;
        pendingTrayAction = undefined;
        mainWindow.webContents.send('desktop:tray-action', action);
      }
      refreshTrayMenu();
    })();
  });
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('minimize', refreshTrayMenu);
  mainWindow.on('restore', refreshTrayMenu);
  mainWindow.on('show', refreshTrayMenu);
  mainWindow.on('hide', refreshTrayMenu);
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (currentCloseToTray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      refreshTrayMenu();
    }
  });
  mainWindow.once('closed', () => {
    mainWindow = undefined;
    mainWindowReady = false;
    refreshTrayMenu();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.whenReady().then(() => {
  if (started || !hasSingleInstanceLock) return;
  try {
    currentLanguageId = readWindowState().languageId;
    recoverPendingRestore();
  } catch (error) {
    console.error(
      'An interrupted Daybyday restore could not be recovered.',
      getErrorKind(error),
    );
    dialog.showErrorBox(
      translateForLanguage(currentLanguageId, 'Daybyday 启动恢复失败'),
      translateForLanguage(
        currentLanguageId,
        '检测到未完成的数据恢复。为保护原有文件，Daybyday 暂未打开数据库。请勿删除用户数据目录中的 recovery 文件。',
      ),
    );
    app.quit();
    return;
  }
  registerOcrProtocol();
  registerWindowControls();
  createWindow();
  try {
    createTray();
  } catch (error) {
    console.error(
      'Could not create the Daybyday system tray icon.',
      getErrorKind(error),
    );
  }

  screen.on('display-metrics-changed', keepWindowVisible);
  screen.on('display-removed', keepWindowVisible);
  screen.on('display-added', keepWindowVisible);

  app.on('activate', () => {
    showMainWindow();
  });
});

if (hasSingleInstanceLock && !started) {
  app.on('second-instance', showMainWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (dataOperationInProgress) {
    event.preventDefault();
    quitAfterDataOperation = true;
    return;
  }
  isQuitting = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  saveWindowState();
  if (desktopWidgetRecoveryTimer) {
    clearTimeout(desktopWidgetRecoveryTimer);
    desktopWidgetRecoveryTimer = undefined;
  }
  if (desktopWidgetHelper) {
    try {
      desktopWidgetHelper.stdin.end(`${JSON.stringify({ command: 'stop' })}\n`);
    } catch {
      desktopWidgetHelper.kill();
    }
  }
  tray?.destroy();
  tray = undefined;
  plannerDatabase?.close();
  plannerDatabase = undefined;
});

app.on('will-quit', () => {
  desktopWidgetHelper?.kill();
  desktopWidgetHelper = undefined;
});
