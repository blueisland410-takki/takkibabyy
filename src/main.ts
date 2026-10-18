import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
  type Rectangle,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';

const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 620;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 420;
const STATE_FILE = 'window-state.json';

type SavedWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
};

let mainWindow: BrowserWindow | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

if (started) {
  app.quit();
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getStatePath = () => path.join(app.getPath('userData'), STATE_FILE);

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
    };
  } catch {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      alwaysOnTop: false,
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

const saveWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const bounds = mainWindow.getBounds();
  const state: SavedWindowState = {
    ...bounds,
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
  };

  try {
    const directory = app.getPath('userData');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Could not save the DayByDay window settings.', error);
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

const getTrustedWindow = (event: IpcMainInvokeEvent) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || senderWindow !== mainWindow) {
    throw new Error(
      'Window controls are only available to the DayByDay window.',
    );
  }
  return mainWindow;
};

const registerWindowControls = () => {
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
};

const createWindow = () => {
  const savedState = readWindowState();
  const bounds = getInitialBounds(savedState);
  const options: BrowserWindowConstructorOptions = {
    title: 'daybyday.',
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    resizable: true,
    backgroundColor: '#f7f5f0',
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
