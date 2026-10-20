export type Task = {
  id: string;
  title: string;
  notes: string;
  scheduledDate: string;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Event = {
  id: string;
  title: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskInput = {
  title: string;
  notes: string;
  scheduledDate: string;
};

export type EventInput = {
  title: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string;
  notes: string;
};

export type DayData = {
  tasks: Task[];
  events: Event[];
  courses: CourseOccurrence[];
  semester: Semester | null;
  teachingWeek: number | null;
};

export type TaskUpdate = TaskInput & { id: string };
export type EventUpdate = EventInput & { id: string };
export type MoveDirection = 'up' | 'down';

export type Semester = {
  id: string;
  semesterName: string;
  startDate: string;
  endDate: string;
  firstWeekMonday: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SemesterInput = {
  semesterName: string;
  startDate: string;
  endDate: string;
  firstWeekMonday: string;
  isCurrent: boolean;
};

export type RecurrenceType = 'ALL' | 'ODD' | 'EVEN' | 'CUSTOM';
export type FontSizeScale =
  | 0.8
  | 0.85
  | 0.9
  | 0.95
  | 1
  | 1.05
  | 1.1
  | 1.15
  | 1.2
  | 1.25
  | 1.3;
export type ThemeId =
  | 'classic'
  | 'dusty-rose'
  | 'sage-green'
  | 'misty-blue'
  | 'muted-lavender'
  | 'oat-beige'
  | 'mint-pop'
  | 'sapphire'
  | 'y2k-pink';
export type LanguageId = 'zh-CN' | 'zh-TW' | 'ja-JP' | 'ko-KR' | 'en-US';
export type TrayAction = 'quick-task' | 'week' | 'settings';
export type WindowMode = 'floating' | 'desktop-widget' | 'always-on-top';
export type DesktopWidgetBindingStatus =
  | 'inactive'
  | 'pending'
  | 'verified'
  | 'recovering'
  | 'failed';
export type WindowModeState = {
  mode: WindowMode;
  desktopWidgetSupported: boolean;
  desktopWidgetBindingStatus: DesktopWidgetBindingStatus;
  errorKey?: string;
};
export type DesktopSettings = {
  closeToTray: boolean;
  launchAtStartup: boolean;
  startupAvailable: boolean;
  startupPlatform: 'windows' | 'macos' | 'unsupported';
};

export type BackupOperationResult = {
  cancelled: boolean;
  filePath?: string;
};

export type RestoreOperationResult = {
  cancelled: boolean;
  restored: boolean;
  recoveryPath?: string;
};

export type Course = {
  id: string;
  semesterId: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  classroom: string;
  teacher: string;
  notes: string;
  firstWeek: number;
  lastWeek: number;
  recurrenceType: RecurrenceType;
  customWeeks: number[];
  createdAt: string;
  updatedAt: string;
};

export type CourseInput = Omit<Course, 'id' | 'createdAt' | 'updatedAt'>;

export type ClassPeriodTime = {
  periodNumber: number;
  startTime: string;
  endTime: string;
};

export type CourseImportDecision = {
  courseIndex: number;
  action: 'skip' | 'keep';
};

export type CourseImportDuplicate = {
  courseIndex: number;
  existingCourseId?: string;
  earlierCourseIndex?: number;
  courseName: string;
};

export type CourseImportConflict = {
  firstCourseIndex: number;
  secondCourseIndex: number;
  weekday: number;
  firstCourseName: string;
  secondCourseName: string;
};

export type CourseImportAnalysis = {
  duplicates: CourseImportDuplicate[];
  conflicts: CourseImportConflict[];
};

export type CourseImportResult = {
  importedCount: number;
  skippedCount: number;
};

export type ImportSourceType = 'IMAGE' | 'ICS' | 'XLSX' | 'CSV';

export type NormalizedImportDraft = {
  id: string;
  kind: 'course' | 'event';
  semesterId: string;
  courseName: string;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  classroom: string;
  teacher: string;
  firstWeek: number | null;
  lastWeek: number | null;
  recurrenceType: RecurrenceType | null;
  customWeeks: number[];
  exceptions: Array<{
    originalDate: string;
    isCancelled: boolean;
    replacementDate: string;
    startTime: string;
    endTime: string;
    classroom: string;
  }>;
  eventDate: string | null;
  isAllDay: boolean;
  notes: string;
  sourceType: ImportSourceType;
  sourceId: string;
  sourceLabel: string;
  rawText: string;
  warnings: string[];
  confidence: number | null;
  included: boolean;
  reviewed: boolean;
};

export type ImportBatchOptions = {
  semesterId: string;
  sourceType: ImportSourceType;
  sourceLabel: string;
  contentHash: string;
};

export type ImportExceptionDraft = {
  originalDate: string;
  isCancelled: boolean;
  replacementDate: string;
  startTime: string;
  endTime: string;
  classroom: string;
};

export type ImportBatchCourseItem = {
  kind: 'course';
  sourceId: string;
  input: CourseInput;
  exceptions: ImportExceptionDraft[];
};

export type ImportBatchEventItem = {
  kind: 'event';
  sourceId: string;
  input: EventInput;
};

export type ImportBatchItem = ImportBatchCourseItem | ImportBatchEventItem;

export type ImportBatchPayload = {
  options: ImportBatchOptions;
  items: ImportBatchItem[];
};

export type ImportBatchDuplicate = {
  itemIndex: number;
  reason: 'same-source' | 'same-course';
  title: string;
};

export type ImportBatchConflict = CourseImportConflict & {
  firstItemIndex: number;
  secondItemIndex: number;
};

export type ImportBatchAnalysis = {
  duplicates: ImportBatchDuplicate[];
  conflicts: ImportBatchConflict[];
};

export type ImportBatchDecision = {
  itemIndex: number;
  action: 'skip' | 'keep';
};

export type ImportBatchResult = CourseImportResult & {
  batchId: string;
  importedEventCount: number;
};

export type ImportBatchUndoResult = {
  removedCourseCount: number;
  removedEventCount: number;
  retainedItemCount: number;
};

export type ImportBatchSummary = {
  id: string;
  semesterId: string;
  sourceType: ImportSourceType;
  sourceLabel: string;
  contentHash: string;
  createdAt: string;
  undoneAt: string | null;
  importedCourseCount: number;
  importedEventCount: number;
};

export type CourseOccurrence = Course & {
  originalDate: string;
  occurrenceDate: string;
  isException: boolean;
};

export type CourseExceptionInput = {
  courseId: string;
  originalDate: string;
  isCancelled: boolean;
  replacementDate: string;
  startTime: string;
  endTime: string;
  classroom: string;
};

export type SeriesExceptionPolicy = 'preserve-valid' | 'clear-all';
