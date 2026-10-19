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
