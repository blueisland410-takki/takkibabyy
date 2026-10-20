import type {
  Course,
  BackupOperationResult,
  CourseExceptionInput,
  DesktopSettings,
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
  ClassPeriodTime,
  DayData,
  Event,
  EventInput,
  EventUpdate,
  FontSizeScale,
  LanguageId,
  ThemeId,
  TrayAction,
  MoveDirection,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
  Task,
  TaskInput,
  TaskUpdate,
  RestoreOperationResult,
  WindowMode,
  WindowModeState,
} from './domain';

export {};

declare global {
  interface Window {
    dayByDay: {
      initialTheme: ThemeId;
      initialLanguage: LanguageId;
      getWindowMode: () => Promise<WindowModeState>;
      setWindowMode: (mode: WindowMode) => Promise<WindowModeState>;
      onWindowModeChanged: (
        callback: (state: WindowModeState) => void,
      ) => () => void;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      backupData: () => Promise<BackupOperationResult>;
      restoreData: () => Promise<RestoreOperationResult>;
      onDataRestored: (callback: () => void) => () => void;
      getDesktopSettings: () => Promise<DesktopSettings>;
      setCloseToTray: (enabled: boolean) => Promise<boolean>;
      setLaunchAtStartup: (enabled: boolean) => Promise<DesktopSettings>;
      onTrayAction: (callback: (action: TrayAction) => void) => () => void;
      setImportWindowMode: (enabled: boolean) => Promise<void>;
      getFontSizeScale: () => Promise<FontSizeScale>;
      setFontSizeScale: (scale: FontSizeScale) => Promise<FontSizeScale>;
      setTheme: (themeId: ThemeId) => Promise<ThemeId>;
      setLanguage: (languageId: LanguageId) => Promise<LanguageId>;
      onPreferencesChanged: (
        callback: (preferences: {
          themeId: ThemeId;
          languageId: LanguageId;
          fontSizeScale: FontSizeScale;
        }) => void,
      ) => () => void;
      getDay: (date: string) => Promise<DayData>;
      createTask: (input: TaskInput) => Promise<Task>;
      updateTask: (input: TaskUpdate) => Promise<Task>;
      setTaskCompleted: (id: string, isCompleted: boolean) => Promise<Task>;
      deleteTask: (id: string) => Promise<void>;
      moveTask: (id: string, direction: MoveDirection) => Promise<void>;
      createEvent: (input: EventInput) => Promise<Event>;
      updateEvent: (input: EventUpdate) => Promise<Event>;
      deleteEvent: (id: string) => Promise<void>;
      listSemesters: () => Promise<Semester[]>;
      createSemester: (input: SemesterInput) => Promise<Semester>;
      updateSemester: (id: string, input: SemesterInput) => Promise<Semester>;
      setCurrentSemester: (id: string) => Promise<Semester>;
      listCourses: (semesterId: string) => Promise<Course[]>;
      analyzeCourseImport: (
        semesterId: string,
        courses: CourseInput[],
      ) => Promise<CourseImportAnalysis>;
      importCourses: (
        semesterId: string,
        courses: CourseInput[],
        decisions: CourseImportDecision[],
      ) => Promise<CourseImportResult>;
      analyzeImportBatch: (
        payload: ImportBatchPayload,
      ) => Promise<ImportBatchAnalysis>;
      importBatch: (
        payload: ImportBatchPayload,
        decisions: ImportBatchDecision[],
      ) => Promise<ImportBatchResult>;
      listImportBatches: (semesterId: string) => Promise<ImportBatchSummary[]>;
      undoImportBatch: (batchId: string) => Promise<ImportBatchUndoResult>;
      getClassPeriodTimes: () => Promise<ClassPeriodTime[]>;
      saveClassPeriodTimes: (
        periods: ClassPeriodTime[],
      ) => Promise<ClassPeriodTime[]>;
      createCourse: (input: CourseInput) => Promise<Course>;
      updateCourseSeries: (
        id: string,
        input: CourseInput,
        policy: SeriesExceptionPolicy,
      ) => Promise<Course>;
      deleteCourseSeries: (id: string) => Promise<void>;
      saveCourseException: (input: CourseExceptionInput) => Promise<void>;
      deleteCourseException: (
        courseId: string,
        originalDate: string,
      ) => Promise<void>;
    };
  }
}
