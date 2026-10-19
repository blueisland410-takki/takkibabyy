import { contextBridge, ipcRenderer } from 'electron';
import type {
  Course,
  CourseExceptionInput,
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
  MoveDirection,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
  Task,
  TaskInput,
  TaskUpdate,
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
} from './validation';

const initialTheme = parseThemeId(
  ipcRenderer.sendSync('settings:get-initial-theme'),
);
const initialLanguage = parseLanguageId(
  ipcRenderer.sendSync('settings:get-initial-language'),
);

contextBridge.exposeInMainWorld('dayByDay', {
  initialTheme,
  initialLanguage,
  getAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:get-always-on-top'),
  toggleAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:toggle-always-on-top'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  setImportWindowMode: (enabled: boolean): Promise<void> => {
    if (typeof enabled !== 'boolean') throw new Error('导入页面窗口选项无效。');
    return ipcRenderer.invoke('window:set-import-mode', enabled);
  },
  getFontSizeScale: (): Promise<FontSizeScale> =>
    ipcRenderer.invoke('settings:get-font-size-scale'),
  setFontSizeScale: (scale: FontSizeScale): Promise<FontSizeScale> => {
    if (![1, 1.15, 1.25, 1.5].includes(scale))
      throw new Error('字体大小选项无效。');
    return ipcRenderer.invoke('settings:set-font-size-scale', scale);
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
