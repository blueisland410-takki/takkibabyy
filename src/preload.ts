import { contextBridge, ipcRenderer } from 'electron';
import type {
  BackupOperationResult,
  Course,
  CourseExceptionInput,
  DesktopSettings,
  ClassPeriodTime,
  CourseImportAnalysis,
  CourseImportDecision,
  CourseImportResult,
  CourseInput,
  ImportBatchAnalysis,
  ImportBatchDecision,
  ImportBatchPayload,
  ImportBatchResult,
  ImportBatchSummary,
  ImportBatchUndoResult,
  DayData,
  Event,
  EventInput,
  EventUpdate,
  FontSizeScale,
  LanguageId,
  ThemeId,
  TrayAction,
  WindowMode,
  WindowModeState,
  MoveDirection,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
  Task,
  TaskInput,
  TaskUpdate,
  RestoreOperationResult,
} from './domain';
import {
  assertDateKey,
  assertId,
  parseEventInput,
  parseEventUpdate,
  parseCourseExceptionInput,
  parseCourseImportInputs,
  parseImportBatchPayload,
  parseImportBatchDecisions,
  parseCourseInput,
  parseClassPeriodTimes,
  parseMoveDirection,
  parseSeriesExceptionPolicy,
  parseSemesterInput,
  parseTaskInput,
  parseTaskUpdate,
  parseFontSizeScale,
  parseLanguageId,
  parseThemeId,
  parseWindowMode,
} from './validation';

const initialTheme = parseThemeId(
  ipcRenderer.sendSync('settings:get-initial-theme'),
);
const initialLanguage = parseLanguageId(
  ipcRenderer.sendSync('settings:get-initial-language'),
);

const WINDOW_MODE_ERROR_KEYS = new Set([
  '桌面便签模式目前仅支持 Windows，已切回普通悬浮窗。',
  'Windows 桌面便签挂接失败，已切回普通悬浮窗。',
  '桌面便签暂时无法连接到 Windows 桌面，Daybyday 正在重试。',
  'Windows 桌面正在重新加载，Daybyday 正在尝试恢复桌面便签。',
  '桌面便签恢复失败，已切回普通悬浮窗。',
  '窗口模式已切换，但设置未能保存到本机。',
  '窗口模式设置失败，请重试。',
  '桌面便签输入框无法获得键盘焦点，请切换到普通悬浮窗后重试。',
]);

const parseWindowModeState = (value: unknown): WindowModeState => {
  if (!value || typeof value !== 'object')
    throw new Error('窗口模式结果无效。');
  const record = value as Record<string, unknown>;
  const mode = parseWindowMode(record.mode);
  if (typeof record.desktopWidgetSupported !== 'boolean')
    throw new Error('窗口模式结果无效。');
  if (
    record.desktopWidgetBindingStatus !== 'inactive' &&
    record.desktopWidgetBindingStatus !== 'pending' &&
    record.desktopWidgetBindingStatus !== 'verified' &&
    record.desktopWidgetBindingStatus !== 'recovering' &&
    record.desktopWidgetBindingStatus !== 'failed'
  )
    throw new Error('窗口模式结果无效。');
  if (
    record.errorKey !== undefined &&
    (typeof record.errorKey !== 'string' ||
      !WINDOW_MODE_ERROR_KEYS.has(record.errorKey))
  )
    throw new Error('窗口模式结果无效。');
  return {
    mode,
    desktopWidgetSupported: record.desktopWidgetSupported,
    desktopWidgetBindingStatus: record.desktopWidgetBindingStatus,
    ...(typeof record.errorKey === 'string'
      ? { errorKey: record.errorKey }
      : {}),
  };
};

contextBridge.exposeInMainWorld('dayByDay', {
  initialTheme,
  initialLanguage,
  getWindowMode: async (): Promise<WindowModeState> =>
    parseWindowModeState(await ipcRenderer.invoke('window:get-mode')),
  setWindowMode: async (mode: WindowMode): Promise<WindowModeState> => {
    const requestedMode = parseWindowMode(mode);
    return parseWindowModeState(
      await ipcRenderer.invoke('window:set-mode', requestedMode),
    );
  },
  onWindowModeChanged: (
    callback: (state: WindowModeState) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      try {
        callback(parseWindowModeState(value));
      } catch {
        // Ignore malformed notifications from outside the trusted main process.
      }
    };
    ipcRenderer.on('window:mode-changed', listener);
    return () => ipcRenderer.removeListener('window:mode-changed', listener);
  },
  setDesktopWidgetTextFocus: (focused: boolean): void => {
    if (typeof focused !== 'boolean') return;
    ipcRenderer.send('desktop-widget:input-focus', focused);
  },
  onDesktopWidgetFocusError: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('desktop-widget:focus-error', listener);
    return () =>
      ipcRenderer.removeListener('desktop-widget:focus-error', listener);
  },
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  backupData: async (): Promise<BackupOperationResult> => {
    const value: unknown = await ipcRenderer.invoke('data:backup');
    if (!value || typeof value !== 'object')
      throw new Error('备份操作结果无效。');
    const record = value as Record<string, unknown>;
    if (
      typeof record.cancelled !== 'boolean' ||
      (record.filePath !== undefined && typeof record.filePath !== 'string')
    )
      throw new Error('备份操作结果无效。');
    return {
      cancelled: record.cancelled,
      ...(typeof record.filePath === 'string'
        ? { filePath: record.filePath }
        : {}),
    };
  },
  restoreData: async (): Promise<RestoreOperationResult> => {
    const value: unknown = await ipcRenderer.invoke('data:restore');
    if (!value || typeof value !== 'object')
      throw new Error('恢复操作结果无效。');
    const record = value as Record<string, unknown>;
    if (
      typeof record.cancelled !== 'boolean' ||
      typeof record.restored !== 'boolean' ||
      (record.recoveryPath !== undefined &&
        typeof record.recoveryPath !== 'string')
    )
      throw new Error('恢复操作结果无效。');
    return {
      cancelled: record.cancelled,
      restored: record.restored,
      ...(typeof record.recoveryPath === 'string'
        ? { recoveryPath: record.recoveryPath }
        : {}),
    };
  },
  onDataRestored: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('data:restored', listener);
    return () => ipcRenderer.removeListener('data:restored', listener);
  },
  getDesktopSettings: (): Promise<DesktopSettings> =>
    ipcRenderer.invoke('settings:get-desktop'),
  setCloseToTray: (enabled: boolean): Promise<boolean> => {
    if (typeof enabled !== 'boolean') throw new Error('关闭到托盘选项无效。');
    return ipcRenderer.invoke('settings:set-close-to-tray', enabled);
  },
  setLaunchAtStartup: (enabled: boolean): Promise<DesktopSettings> => {
    if (typeof enabled !== 'boolean')
      throw new Error('Windows 开机启动选项无效。');
    return ipcRenderer.invoke('settings:set-launch-at-startup', enabled);
  },
  onTrayAction: (callback: (action: TrayAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (value === 'quick-task' || value === 'week' || value === 'settings')
        callback(value);
    };
    ipcRenderer.on('desktop:tray-action', listener);
    return () => ipcRenderer.removeListener('desktop:tray-action', listener);
  },
  setImportWindowMode: (enabled: boolean): Promise<void> => {
    if (typeof enabled !== 'boolean') throw new Error('导入页面窗口选项无效。');
    return ipcRenderer.invoke('window:set-import-mode', enabled);
  },
  getFontSizeScale: (): Promise<FontSizeScale> =>
    ipcRenderer.invoke('settings:get-font-size-scale'),
  setFontSizeScale: (scale: FontSizeScale): Promise<FontSizeScale> => {
    return ipcRenderer.invoke(
      'settings:set-font-size-scale',
      parseFontSizeScale(scale),
    );
  },
  setTheme: (themeId: ThemeId): Promise<ThemeId> =>
    ipcRenderer.invoke('settings:set-theme', parseThemeId(themeId)),
  setLanguage: (languageId: LanguageId): Promise<LanguageId> =>
    ipcRenderer.invoke('settings:set-language', parseLanguageId(languageId)),
  onPreferencesChanged: (
    callback: (preferences: {
      themeId: ThemeId;
      languageId: LanguageId;
      fontSizeScale: FontSizeScale;
    }) => void,
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      try {
        callback({
          themeId: parseThemeId(record.themeId),
          languageId: parseLanguageId(record.languageId),
          fontSizeScale: parseFontSizeScale(record.fontSizeScale),
        });
      } catch {
        // Ignore malformed preference messages from outside the main process.
      }
    };
    ipcRenderer.on('settings:preferences-changed', listener);
    return () =>
      ipcRenderer.removeListener('settings:preferences-changed', listener);
  },
  getDay: (date: string): Promise<DayData> => {
    assertDateKey(date);
    return ipcRenderer.invoke('planner:get-day', date);
  },
  createTask: (input: TaskInput): Promise<Task> =>
    ipcRenderer.invoke('task:create', parseTaskInput(input)),
  updateTask: (input: TaskUpdate): Promise<Task> =>
    ipcRenderer.invoke('task:update', parseTaskUpdate(input)),
  setTaskCompleted: (id: string, isCompleted: boolean): Promise<Task> => {
    assertId(id);
    if (typeof isCompleted !== 'boolean') throw new Error('待办完成状态无效。');
    return ipcRenderer.invoke('task:set-completed', id, isCompleted);
  },
  deleteTask: (id: string): Promise<void> => {
    assertId(id);
    return ipcRenderer.invoke('task:delete', id);
  },
  moveTask: (id: string, direction: MoveDirection): Promise<void> => {
    assertId(id);
    const safeDirection = parseMoveDirection(direction);
    return ipcRenderer.invoke('task:move', id, safeDirection);
  },
  createEvent: (input: EventInput): Promise<Event> =>
    ipcRenderer.invoke('event:create', parseEventInput(input)),
  updateEvent: (input: EventUpdate): Promise<Event> =>
    ipcRenderer.invoke('event:update', parseEventUpdate(input)),
  deleteEvent: (id: string): Promise<void> => {
    assertId(id);
    return ipcRenderer.invoke('event:delete', id);
  },
  listSemesters: (): Promise<Semester[]> => ipcRenderer.invoke('semester:list'),
  createSemester: (input: SemesterInput): Promise<Semester> =>
    ipcRenderer.invoke('semester:create', parseSemesterInput(input)),
  updateSemester: (id: string, input: SemesterInput): Promise<Semester> => {
    assertId(id);
    return ipcRenderer.invoke('semester:update', id, parseSemesterInput(input));
  },
  setCurrentSemester: (id: string): Promise<Semester> => {
    assertId(id);
    return ipcRenderer.invoke('semester:set-current', id);
  },
  listCourses: (semesterId: string): Promise<Course[]> => {
    assertId(semesterId);
    return ipcRenderer.invoke('course:list', semesterId);
  },
  analyzeCourseImport: (
    semesterId: string,
    courses: CourseInput[],
  ): Promise<CourseImportAnalysis> => {
    assertId(semesterId);
    return ipcRenderer.invoke(
      'course:analyze-import',
      semesterId,
      parseCourseImportInputs(semesterId, courses),
    );
  },
  importCourses: (
    semesterId: string,
    courses: CourseInput[],
    decisions: CourseImportDecision[],
  ): Promise<CourseImportResult> => {
    assertId(semesterId);
    if (!Array.isArray(decisions)) throw new Error('重复课程处理列表无效。');
    return ipcRenderer.invoke(
      'course:import-batch',
      semesterId,
      parseCourseImportInputs(semesterId, courses),
      decisions,
    );
  },
  analyzeImportBatch: (
    payload: ImportBatchPayload,
  ): Promise<ImportBatchAnalysis> => {
    const safePayload = parseImportBatchPayload(payload);
    return ipcRenderer.invoke('import:analyze-batch', safePayload);
  },
  importBatch: (
    payload: ImportBatchPayload,
    decisions: ImportBatchDecision[],
  ): Promise<ImportBatchResult> => {
    const safePayload = parseImportBatchPayload(payload);
    if (!Array.isArray(decisions)) throw new Error('重复项处理列表无效。');
    // Main-process analysis remains authoritative; this validates the decision
    // shape, while IPC checks each index against current duplicate results.
    const duplicateIndices = new Set(
      safePayload.items.map((_, index) => index),
    );
    const safeDecisions = parseImportBatchDecisions(
      decisions,
      safePayload.items.length,
      duplicateIndices,
    );
    return ipcRenderer.invoke(
      'import:commit-batch',
      safePayload,
      safeDecisions,
    );
  },
  listImportBatches: (semesterId: string): Promise<ImportBatchSummary[]> => {
    assertId(semesterId);
    return ipcRenderer.invoke('import:list-batches', semesterId);
  },
  undoImportBatch: (batchId: string): Promise<ImportBatchUndoResult> => {
    assertId(batchId);
    return ipcRenderer.invoke('import:undo-batch', batchId);
  },
  getClassPeriodTimes: (): Promise<ClassPeriodTime[]> =>
    ipcRenderer.invoke('class-periods:list'),
  saveClassPeriodTimes: (
    periods: ClassPeriodTime[],
  ): Promise<ClassPeriodTime[]> =>
    ipcRenderer.invoke('class-periods:save', parseClassPeriodTimes(periods)),
  createCourse: (input: CourseInput): Promise<Course> =>
    ipcRenderer.invoke('course:create', parseCourseInput(input)),
  updateCourseSeries: (
    id: string,
    input: CourseInput,
    policy: SeriesExceptionPolicy,
  ): Promise<Course> => {
    assertId(id);
    return ipcRenderer.invoke(
      'course:update-series',
      id,
      parseCourseInput(input),
      parseSeriesExceptionPolicy(policy),
    );
  },
  deleteCourseSeries: (id: string): Promise<void> => {
    assertId(id);
    return ipcRenderer.invoke('course:delete-series', id);
  },
  saveCourseException: (input: CourseExceptionInput): Promise<void> =>
    ipcRenderer.invoke(
      'course:save-exception',
      parseCourseExceptionInput(input),
    ),
  deleteCourseException: (
    courseId: string,
    originalDate: string,
  ): Promise<void> => {
    assertId(courseId);
    assertDateKey(originalDate);
    return ipcRenderer.invoke(
      'course:delete-exception',
      courseId,
      originalDate,
    );
  },
});
