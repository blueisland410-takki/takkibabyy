import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  screen,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PlannerDatabase, type SqliteDatabaseConstructor } from './database';
import { getThemeDefinition, isThemeId } from './theme';
import type {
  CourseImportDecision,
  FontSizeScale,
  LanguageId,
  MoveDirection,
  ThemeId,
} from './domain';
import {
  assertDateKey,
  assertId,
  parseFontSizeScale,
  parseLanguageId,
  parseThemeId,
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
  fontSizeScale: FontSizeScale;
  themeId: ThemeId;
  languageId: LanguageId;
};

let mainWindow: BrowserWindow | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let plannerDatabase: PlannerDatabase | undefined;
let boundsBeforeImportMode: Rectangle | undefined;
let currentFontSizeScale: FontSizeScale = 1;
let currentThemeId: ThemeId = 'classic';
let currentLanguageId: LanguageId = 'zh-CN';

if (started) {
  app.quit();
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStatePath = () => path.join(app.getPath('userData'), STATE_FILE);

const getPlannerDatabase = () => {
  if (plannerDatabase) return plannerDatabase;
  try {
    const userDataPath = app.getPath('userData');
    fs.mkdirSync(userDataPath, { recursive: true });
    const sqliteRequire = createRequire(
      app.isPackaged
        ? path.join(process.resourcesPath, 'daybyday-loader.cjs')
        : __filename,
    );
    const sqlitePackagePath = app.isPackaged
      ? path.join(process.resourcesPath, 'better-sqlite3')
      : 'better-sqlite3';
    const sqliteDatabaseConstructor = sqliteRequire(
      sqlitePackagePath,
    ) as SqliteDatabaseConstructor;
    plannerDatabase = new PlannerDatabase(
      path.join(userDataPath, 'daybyday.sqlite'),
      sqliteDatabaseConstructor,
    );
    return plannerDatabase;
  } catch (error) {
    console.error(
      'Could not open the DayByDay database. Existing data was not cleared.',
      error,
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

    return {
      x: isFiniteNumber(parsed.x) ? Math.round(parsed.x) : undefined,
      y: isFiniteNumber(parsed.y) ? Math.round(parsed.y) : undefined,
      width: isFiniteNumber(parsed.width)
        ? Math.round(parsed.width)
        : DEFAULT_WIDTH,
      height: isFiniteNumber(parsed.height)
        ? Math.round(parsed.height)
        : DEFAULT_HEIGHT,
      alwaysOnTop: parsed.alwaysOnTop === true,
      fontSizeScale: isFontSizeScale(parsed.fontSizeScale)
        ? parsed.fontSizeScale
        : 1,
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
      fontSizeScale: 1,
      themeId: 'classic',
      languageId: 'zh-CN',
    };
  }
};

function isFontSizeScale(value: unknown): value is FontSizeScale {
  return value === 1 || value === 1.15 || value === 1.25 || value === 1.5;
}

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
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
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
    console.error('Could not save the DayByDay window settings.', error);
    return false;
  }
};

const scheduleWindowStateSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    saveWindowState();
  }, 200);
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
  saveWindowState();
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
  ipcMain.handle('window:get-always-on-top', (event) =>
    getTrustedWindow(event).isAlwaysOnTop(),
  );
  ipcMain.handle('window:toggle-always-on-top', (event) => {
    const window = getTrustedWindow(event);
    window.setAlwaysOnTop(!window.isAlwaysOnTop());
    saveWindowState();
    return window.isAlwaysOnTop();
  });
  ipcMain.handle('window:minimize', (event) => {
    getTrustedWindow(event).minimize();
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
      throw new Error(
        '语言设置未能保存到本机，请检查用户数据目录写入权限后重试。',
      );
    }
    broadcastPreferences();
    return currentLanguageId;
  });

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
  currentFontSizeScale = savedState.fontSizeScale;
  currentThemeId = savedState.themeId;
  currentLanguageId = savedState.languageId;
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
  mainWindow.setAlwaysOnTop(savedState.alwaysOnTop);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.once('close', saveWindowState);
  mainWindow.once('closed', () => {
    mainWindow = undefined;
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
  registerOcrProtocol();
  registerWindowControls();
  createWindow();

  screen.on('display-metrics-changed', keepWindowVisible);
  screen.on('display-removed', keepWindowVisible);
  screen.on('display-added', keepWindowVisible);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  plannerDatabase?.close();
  plannerDatabase = undefined;
});
