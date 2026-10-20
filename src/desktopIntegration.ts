import path from 'node:path';
import type { LanguageId, TrayAction, WindowMode } from './domain';
import { translateForLanguage } from './i18n';

export type { TrayAction } from './domain';

const TRAY_ACTIONS: readonly TrayAction[] = ['quick-task', 'week', 'settings'];
const WINDOW_MODES: readonly WindowMode[] = [
  'floating',
  'desktop-widget',
  'always-on-top',
];

export const isWindowMode = (value: unknown): value is WindowMode =>
  typeof value === 'string' && WINDOW_MODES.includes(value as WindowMode);

export const normalizeStoredWindowMode = (
  value: unknown,
  legacyAlwaysOnTop: unknown,
): WindowMode =>
  isWindowMode(value)
    ? value
    : legacyAlwaysOnTop === true
      ? 'always-on-top'
      : 'floating';

export const isTrayAction = (value: unknown): value is TrayAction =>
  typeof value === 'string' && TRAY_ACTIONS.includes(value as TrayAction);

export const normalizeDesktopPreferenceFlags = (value: unknown) => {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    closeToTray: record.closeToTray === true,
    launchAtStartup: record.launchAtStartup === true,
  };
};

export const getTrayMenuLabels = (language: LanguageId) => ({
  show: translateForLanguage(language, '显示今日窗口'),
  hide: translateForLanguage(language, '隐藏今日窗口'),
  addTask: translateForLanguage(language, '添加待办'),
  planner: translateForLanguage(language, '打开完整课表'),
  settings: translateForLanguage(language, '打开设置'),
  quit: translateForLanguage(language, '完全退出 Daybyday'),
});

/** Squirrel's stable launcher is one directory above app-x.y.z. */
export const getSquirrelLoginItemOptions = (
  executablePath: string,
  openAtLogin: boolean,
) => {
  if (!path.win32.isAbsolute(executablePath)) {
    throw new Error('The Windows executable path must be absolute.');
  }

  const executableName = path.win32.basename(executablePath);
  return {
    openAtLogin,
    path: path.win32.resolve(
      path.win32.dirname(executablePath),
      '..',
      executableName,
    ),
    args: [] as string[],
  };
};
