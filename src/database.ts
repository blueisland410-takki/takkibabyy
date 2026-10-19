import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  ClassPeriodTime,
  Course,
  CourseExceptionInput,
  CourseImportAnalysis,
  CourseImportDecision,
  CourseImportResult,
  CourseInput,
  CourseOccurrence,
  Event,
  EventInput,
  RecurrenceType,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
  Task,
  TaskInput,
  MoveDirection,
} from './domain';
import {
  courseOccursOnDate,
  getTeachingWeekNumber,
  shiftDateKey,
} from './courseSchedule';
import { analyzeCourseImport as analyzeCourseImportRows } from './courseImport';
import { assertDateKey } from './validation';

const SCHEMA_VERSION = 3;

export type SqliteDatabaseConstructor = typeof Database;

type TaskRow = {
  id: string;
  title: string;
  notes: string;
  scheduled_date: string;
  is_completed: number;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: number;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type SemesterRow = {
  id: string;
  semester_name: string;
  start_date: string;
  end_date: string;
  first_week_monday: string;
  is_current: number;
  created_at: string;
  updated_at: string;
};

type CourseRow = {
  id: string;
  semester_id: string;
  course_name: string;
  weekday: number;
  start_time: string;
  end_time: string;
  classroom: string;
  teacher: string;
  notes: string;
  first_week: number;
  last_week: number;
  recurrence_type: RecurrenceType;
  created_at: string;
  updated_at: string;
};

type CourseExceptionRow = {
  course_id: string;
  original_date: string;
  is_cancelled: number;
  replacement_date: string;
  start_time: string;
  end_time: string;
  classroom: string;
};

type ClassPeriodTimeRow = {
  period_number: number;
  start_time: string;
  end_time: string;
};

function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    scheduledDate: row.scheduled_date,
    isCompleted: row.is_completed === 1,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    isAllDay: row.is_all_day === 1,
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const timestamp = () => new Date().toISOString();

function semesterFromRow(row: SemesterRow): Semester {
  return {
    id: row.id,
    semesterName: row.semester_name,
    startDate: row.start_date,
    endDate: row.end_date,
    firstWeekMonday: row.first_week_monday,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function courseFromRow(row: CourseRow, customWeeks: number[]): Course {
  return {
    id: row.id,
    semesterId: row.semester_id,
    courseName: row.course_name,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    classroom: row.classroom,
    teacher: row.teacher,
    notes: row.notes,
    firstWeek: row.first_week,
    lastWeek: row.last_week,
    recurrenceType: row.recurrence_type,
    customWeeks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PlannerDatabase {
  private readonly database: Database.Database;

  constructor(
    filePath: string,
    databaseConstructor?: SqliteDatabaseConstructor,
  ) {
    const SqliteDatabase =
      databaseConstructor ??
      (createRequire(__filename)(
        'better-sqlite3',
      ) as SqliteDatabaseConstructor);
    const database = new SqliteDatabase(filePath);
    try {
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 5000');
      this.database = database;
      this.migrate();
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close() {
    this.database.close();
  }

  listSemesters(): Semester[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM semesters ORDER BY start_date DESC, created_at DESC',
      )
      .all() as SemesterRow[];
    return rows.map(semesterFromRow);
  }

  createSemester(input: SemesterInput): Semester {
    const id = randomUUID();
    const now = timestamp();
    const makeCurrent =
      input.isCurrent ||
      !this.database.prepare('SELECT 1 FROM semesters LIMIT 1').get();
    this.database
      .transaction(() => {
        if (makeCurrent)
          this.database.prepare('UPDATE semesters SET is_current = 0').run();
        this.database
          .prepare(
            `INSERT INTO semesters (id, semester_name, start_date, end_date, first_week_monday, is_current, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.semesterName,
            input.startDate,
            input.endDate,
            input.firstWeekMonday,
            makeCurrent ? 1 : 0,
            now,
            now,
          );
      })
      .immediate();
    return this.getSemester(id);
  }

  updateSemester(id: string, input: SemesterInput): Semester {
    const existing = this.findSemester(id);
    if (!existing) throw new Error('这个学期已不存在，请刷新后重试。');
    const invalidException = this.database
      .prepare(
        `SELECT 1 FROM course_exceptions e
         JOIN courses c ON c.id = e.course_id
         WHERE c.semester_id = ?
           AND (e.original_date < ? OR e.original_date > ? OR e.replacement_date < ? OR e.replacement_date > ?)
         LIMIT 1`,
      )
      .get(id, input.startDate, input.endDate, input.startDate, input.endDate);
    if (invalidException) {
      throw new Error(
        '学期日期不能移出已有单次调课的日期范围，请先调整或删除相关例外。',
      );
    }
    const currentCourses = new Map(
      this.listCourses(id).map((course) => [course.id, course]),
    );
    const allExceptions = this.database
      .prepare(
        `SELECT e.course_id, e.original_date FROM course_exceptions e
         JOIN courses c ON c.id = e.course_id WHERE c.semester_id = ?`,
      )
      .all(id) as Array<{ course_id: string; original_date: string }>;
    for (const exception of allExceptions) {
      const course = currentCourses.get(exception.course_id);
      if (
        !course ||
        !courseOccursOnDate(
          course,
          {
            startDate: input.startDate,
            endDate: input.endDate,
            firstWeekMonday: input.firstWeekMonday,
          },
          exception.original_date,
        )
      ) {
        throw new Error(
          '学期日期或第一教学周不能使已有单次例外失效，请先在课程管理中处理相关例外。',
        );
      }
    }
    this.database
      .transaction(() => {
        if (input.isCurrent)
          this.database.prepare('UPDATE semesters SET is_current = 0').run();
        this.database
          .prepare(
            `UPDATE semesters SET semester_name = ?, start_date = ?, end_date = ?, first_week_monday = ?, is_current = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.semesterName,
            input.startDate,
            input.endDate,
            input.firstWeekMonday,
            input.isCurrent || existing.is_current === 1 ? 1 : 0,
            timestamp(),
            id,
          );
      })
      .immediate();
    return this.getSemester(id);
  }

  setCurrentSemester(id: string): Semester {
    if (!this.findSemester(id)) throw new Error('请选择一个有效学期。');
    this.database
      .transaction(() => {
        this.database.prepare('UPDATE semesters SET is_current = 0').run();
        this.database
          .prepare(
            'UPDATE semesters SET is_current = 1, updated_at = ? WHERE id = ?',
          )
          .run(timestamp(), id);
      })
      .immediate();
    return this.getSemester(id);
  }

  listCourses(semesterId: string): Course[] {
    if (!this.findSemester(semesterId)) throw new Error('这个学期已不存在。');
    const rows = this.database
      .prepare(
        'SELECT * FROM courses WHERE semester_id = ? ORDER BY weekday, start_time, course_name',
      )
      .all(semesterId) as CourseRow[];
    return rows.map((row) => courseFromRow(row, this.getCustomWeeks(row.id)));
  }

  getClassPeriodTimes(): ClassPeriodTime[] {
    const rows = this.database
      .prepare('SELECT * FROM class_period_times ORDER BY period_number')
      .all() as ClassPeriodTimeRow[];
    return rows.map((row) => ({
      periodNumber: row.period_number,
      startTime: row.start_time,
      endTime: row.end_time,
    }));
  }

  saveClassPeriodTimes(periods: ClassPeriodTime[]): ClassPeriodTime[] {
    this.database
      .transaction(() => {
        this.database.prepare('DELETE FROM class_period_times').run();
        const insert = this.database.prepare(
          'INSERT INTO class_period_times (period_number, start_time, end_time) VALUES (?, ?, ?)',
        );
        for (const period of periods) {
          insert.run(period.periodNumber, period.startTime, period.endTime);
        }
      })
      .immediate();
    return this.getClassPeriodTimes();
  }

  analyzeCourseImport(
    semesterId: string,
    incoming: CourseInput[],
  ): CourseImportAnalysis {
    const semester = this.findSemester(semesterId);
    if (!semester) throw new Error('导入目标学期已不存在，请重新选择。');
    for (const course of incoming) {
      if (course.semesterId !== semesterId) {
        throw new Error('导入课程的目标学期不一致，请重新检查。');
      }
      this.assertCourseWeeksFitSemester(course, semester);
    }
    return analyzeCourseImportRows(this.listCourses(semesterId), incoming);
  }

  importCourses(
    semesterId: string,
    incoming: CourseInput[],
    decisions: CourseImportDecision[],
  ): CourseImportResult {
    const analysis = this.analyzeCourseImport(semesterId, incoming);
    const decisionByIndex = new Map(
      decisions.map((decision) => [decision.courseIndex, decision.action]),
    );
    const duplicateIndexes = new Set(
      analysis.duplicates.map((duplicate) => duplicate.courseIndex),
    );
    if (
      decisions.some((decision) => !duplicateIndexes.has(decision.courseIndex))
    ) {
      throw new Error('重复课程处理结果已过期，请重新检查后导入。');
    }

    let importedCount = 0;
    let skippedCount = 0;
    const now = timestamp();
    this.database
      .transaction(() => {
        for (let index = 0; index < incoming.length; index += 1) {
          const action = decisionByIndex.get(index);
          if (duplicateIndexes.has(index) && action !== 'keep') {
            skippedCount += 1;
            continue;
          }
          const input = incoming[index];
          const id = randomUUID();
          this.database
            .prepare(
              `INSERT INTO courses (id, semester_id, course_name, weekday, start_time, end_time, classroom, teacher, notes, first_week, last_week, recurrence_type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              input.semesterId,
              input.courseName,
              input.weekday,
              input.startTime,
              input.endTime,
              input.classroom,
              input.teacher,
              input.notes,
              input.firstWeek,
              input.lastWeek,
              input.recurrenceType,
              now,
              now,
            );
          this.replaceCustomWeeks(id, input.customWeeks);
          importedCount += 1;
        }
      })
      .immediate();
    return { importedCount, skippedCount };
  }

  createCourse(input: CourseInput): Course {
    const semester = this.findSemester(input.semesterId);
    if (!semester) throw new Error('请先选择一个有效学期。');
    this.assertCourseWeeksFitSemester(input, semester);
    const id = randomUUID();
    const now = timestamp();
    this.database
      .transaction(() => {
        this.database
          .prepare(
            `INSERT INTO courses (id, semester_id, course_name, weekday, start_time, end_time, classroom, teacher, notes, first_week, last_week, recurrence_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.semesterId,
            input.courseName,
            input.weekday,
            input.startTime,
            input.endTime,
            input.classroom,
            input.teacher,
            input.notes,
            input.firstWeek,
            input.lastWeek,
            input.recurrenceType,
            now,
            now,
          );
        this.replaceCustomWeeks(id, input.customWeeks);
      })
      .immediate();
    return this.getCourse(id);
  }

  updateCourseSeries(
    id: string,
    input: CourseInput,
    exceptionPolicy: SeriesExceptionPolicy,
  ): Course {
    const existing = this.findCourse(id);
    if (!existing) throw new Error('这门课程已不存在，请刷新后重试。');
    if (input.semesterId !== existing.semester_id)
      throw new Error('课程暂不支持移到其他学期。');
    const semester = this.findSemester(input.semesterId);
    if (!semester) throw new Error('这个学期已不存在。');
    this.assertCourseWeeksFitSemester(input, semester);
    this.database
      .transaction(() => {
        this.database
          .prepare(
            `UPDATE courses SET course_name = ?, weekday = ?, start_time = ?, end_time = ?, classroom = ?, teacher = ?, notes = ?, first_week = ?, last_week = ?, recurrence_type = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.courseName,
            input.weekday,
            input.startTime,
            input.endTime,
            input.classroom,
            input.teacher,
            input.notes,
            input.firstWeek,
            input.lastWeek,
            input.recurrenceType,
            timestamp(),
            id,
          );
        this.replaceCustomWeeks(id, input.customWeeks);
        if (exceptionPolicy === 'clear-all') {
          this.database
            .prepare('DELETE FROM course_exceptions WHERE course_id = ?')
            .run(id);
        } else {
          const exceptions = this.database
            .prepare(
              'SELECT original_date FROM course_exceptions WHERE course_id = ?',
            )
            .all(id) as Array<{ original_date: string }>;
          const deleteException = this.database.prepare(
            'DELETE FROM course_exceptions WHERE course_id = ? AND original_date = ?',
          );
          for (const exception of exceptions) {
            if (
              !courseOccursOnDate(
                input,
                {
                  startDate: semester.start_date,
                  endDate: semester.end_date,
                  firstWeekMonday: semester.first_week_monday,
                },
                exception.original_date,
              )
            ) {
              deleteException.run(id, exception.original_date);
            }
          }
        }
      })
      .immediate();
    return this.getCourse(id);
  }

  deleteCourseSeries(id: string) {
    const result = this.database
      .prepare('DELETE FROM courses WHERE id = ?')
      .run(id);
    if (result.changes !== 1)
      throw new Error('这门课程已不存在，请刷新后重试。');
  }

  saveCourseException(input: CourseExceptionInput) {
    const course = this.findCourse(input.courseId);
    if (!course) throw new Error('这门课程已不存在，请刷新后重试。');
    const semester = this.findSemester(course.semester_id);
    if (!semester) throw new Error('这个学期已不存在。');
    const fullCourse = this.getCourse(input.courseId);
    if (
      !courseOccursOnDate(
        fullCourse,
        {
          startDate: semester.start_date,
          endDate: semester.end_date,
          firstWeekMonday: semester.first_week_monday,
        },
        input.originalDate,
      )
    ) {
      throw new Error('所选原日期不属于这门课程的实际上课日期。');
    }
    if (!input.isCancelled) {
      if (
        input.replacementDate < semester.start_date ||
        input.replacementDate > semester.end_date
      ) {
        throw new Error('调整后的课程日期必须在学期范围内。');
      }
    }
    const now = timestamp();
    this.database
      .prepare(
        `INSERT INTO course_exceptions (course_id, original_date, is_cancelled, replacement_date, start_time, end_time, classroom, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(course_id, original_date) DO UPDATE SET
           is_cancelled = excluded.is_cancelled,
           replacement_date = excluded.replacement_date,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           classroom = excluded.classroom,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.courseId,
        input.originalDate,
        input.isCancelled ? 1 : 0,
        input.replacementDate,
        input.startTime,
        input.endTime,
        input.classroom,
        now,
        now,
      );
  }

  deleteCourseException(courseId: string, originalDate: string) {
    const result = this.database
      .prepare(
        'DELETE FROM course_exceptions WHERE course_id = ? AND original_date = ?',
      )
      .run(courseId, originalDate);
    if (result.changes !== 1)
      throw new Error('这条单次课程调整已不存在，请刷新后重试。');
  }

  listCourseOccurrences(
    startDate: string,
    endDate: string,
  ): CourseOccurrence[] {
    assertDateKey(startDate);
    assertDateKey(endDate);
    if (endDate < startDate) throw new Error('查询结束日期不能早于开始日期。');
    const semester = this.getCurrentSemester();
    if (!semester) return [];
    const courses = this.listCourses(semester.id);
    const occurrences: CourseOccurrence[] = [];
    const originalIds = new Set<string>();
    const exceptionRows = this.database
      .prepare(
        `SELECT e.* FROM course_exceptions e
         JOIN courses c ON c.id = e.course_id
         WHERE c.semester_id = ?
           AND (e.original_date BETWEEN ? AND ? OR e.replacement_date BETWEEN ? AND ?)`,
      )
      .all(
        semester.id,
        startDate,
        endDate,
        startDate,
        endDate,
      ) as CourseExceptionRow[];
    const exceptionsByKey = new Map<string, CourseExceptionRow>();
    const addOccurrence = (
      course: Course,
      originalDate: string,
      exception?: CourseExceptionRow,
    ) => {
      if (exception?.is_cancelled === 1) return;
      const occurrenceDate = exception?.replacement_date ?? originalDate;
      if (occurrenceDate < startDate || occurrenceDate > endDate) return;
      const key = `${course.id}:${originalDate}`;
      if (originalIds.has(key)) return;
      originalIds.add(key);
      occurrences.push({
        ...course,
        weekday: new Date(`${occurrenceDate}T00:00:00Z`).getUTCDay() || 7,
        startTime: exception?.start_time || course.startTime,
        endTime: exception?.end_time || course.endTime,
        classroom: exception ? exception.classroom : course.classroom,
        originalDate,
        occurrenceDate,
        isException: Boolean(exception),
      });
    };
    for (const exception of exceptionRows) {
      exceptionsByKey.set(
        `${exception.course_id}:${exception.original_date}`,
        exception,
      );
    }

    const rangeStart =
      startDate < semester.startDate ? semester.startDate : startDate;
    const rangeEnd = endDate > semester.endDate ? semester.endDate : endDate;
    if (rangeEnd >= rangeStart) {
      for (
        let date = rangeStart;
        date <= rangeEnd;
        date = shiftDateKey(date, 1)
      ) {
        for (const course of courses) {
          if (!courseOccursOnDate(course, semester, date)) continue;
          const exception = exceptionsByKey.get(`${course.id}:${date}`);
          if (exception?.is_cancelled === 1) continue;
          addOccurrence(course, date, exception);
        }
      }
    }

    // A moved occurrence can originate outside the requested range and land inside it.
    for (const exception of exceptionRows) {
      if (
        exception.original_date >= startDate &&
        exception.original_date <= endDate
      )
        continue;
      const course = courses.find((item) => item.id === exception.course_id);
      if (
        course &&
        courseOccursOnDate(course, semester, exception.original_date)
      ) {
        addOccurrence(course, exception.original_date, exception);
      }
    }

    return occurrences.sort(
      (a, b) =>
        a.occurrenceDate.localeCompare(b.occurrenceDate) ||
        a.startTime.localeCompare(b.startTime) ||
        a.courseName.localeCompare(b.courseName),
    );
  }

  getCurrentSemester(): Semester | null {
    const row = this.database
      .prepare('SELECT * FROM semesters WHERE is_current = 1 LIMIT 1')
      .get() as SemesterRow | undefined;
    return row ? semesterFromRow(row) : null;
  }

  getTeachingWeek(date: string): number | null {
    assertDateKey(date);
    const semester = this.getCurrentSemester();
    if (!semester || date < semester.startDate || date > semester.endDate)
      return null;
    return getTeachingWeekNumber(semester.firstWeekMonday, date);
  }

  private assertCourseWeeksFitSemester(
    input: CourseInput,
    semester: SemesterRow,
  ) {
    const lastAllowedWeek = getTeachingWeekNumber(
      semester.first_week_monday,
      semester.end_date,
    );
    if (input.lastWeek > lastAllowedWeek) {
      throw new Error(`课程周次不能超过该学期的第 ${lastAllowedWeek} 教学周。`);
    }
  }

  private replaceCustomWeeks(courseId: string, weeks: number[]) {
    this.database
      .prepare('DELETE FROM course_custom_weeks WHERE course_id = ?')
      .run(courseId);
    const insert = this.database.prepare(
      'INSERT INTO course_custom_weeks (course_id, week_number) VALUES (?, ?)',
    );
    for (const week of weeks) insert.run(courseId, week);
  }

  private getCustomWeeks(courseId: string): number[] {
    return (
      this.database
        .prepare(
          'SELECT week_number FROM course_custom_weeks WHERE course_id = ? ORDER BY week_number',
        )
        .all(courseId) as Array<{ week_number: number }>
    ).map((row) => row.week_number);
  }

  private findSemester(id: string): SemesterRow | undefined {
    return this.database
      .prepare('SELECT * FROM semesters WHERE id = ?')
      .get(id) as SemesterRow | undefined;
  }

  private getSemester(id: string): Semester {
    const row = this.findSemester(id);
    if (!row) throw new Error('保存后无法读取学期。');
    return semesterFromRow(row);
  }

  private findCourse(id: string): CourseRow | undefined {
    return this.database
      .prepare('SELECT * FROM courses WHERE id = ?')
      .get(id) as CourseRow | undefined;
  }

  private getCourse(id: string): Course {
    const row = this.findCourse(id);
    if (!row) throw new Error('保存后无法读取课程。');
    return courseFromRow(row, this.getCustomWeeks(id));
  }

  private migrate() {
    let version = Number(
      this.database.pragma('user_version', { simple: true }),
    );
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `数据库版本 ${version} 高于当前软件支持的版本，数据未被修改。`,
      );
    }
    if (version === 0) {
      this.database
        .transaction(() => {
          this.database.exec(`
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            notes TEXT NOT NULL DEFAULT '',
            scheduled_date TEXT NOT NULL CHECK (scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
            completed_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX tasks_by_date_order ON tasks(scheduled_date, is_completed, sort_order, created_at);
          CREATE TABLE events (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            event_date TEXT NOT NULL CHECK (event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            start_time TEXT,
            end_time TEXT,
            is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
            location TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX events_by_date_time ON events(event_date, is_all_day DESC, start_time, created_at);
        `);
          this.database.pragma('user_version = 1');
        })
        .immediate();
      version = 1;
    }
    if (version === 1) {
      this.database
        .transaction(() => {
          this.database.exec(`
            CREATE TABLE semesters (
              id TEXT PRIMARY KEY NOT NULL,
              semester_name TEXT NOT NULL CHECK (length(trim(semester_name)) > 0),
              start_date TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
              end_date TEXT NOT NULL CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
              first_week_monday TEXT NOT NULL CHECK (first_week_monday GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
              is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              CHECK (end_date >= start_date)
            );
            CREATE UNIQUE INDEX one_current_semester ON semesters(is_current) WHERE is_current = 1;
            CREATE INDEX semesters_by_start_date ON semesters(start_date DESC);

            CREATE TABLE courses (
              id TEXT PRIMARY KEY NOT NULL,
              semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE RESTRICT,
              course_name TEXT NOT NULL CHECK (length(trim(course_name)) > 0),
              weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
              start_time TEXT NOT NULL,
              end_time TEXT NOT NULL,
              classroom TEXT NOT NULL DEFAULT '',
              teacher TEXT NOT NULL DEFAULT '',
              notes TEXT NOT NULL DEFAULT '',
              first_week INTEGER NOT NULL CHECK (first_week BETWEEN 1 AND 52),
              last_week INTEGER NOT NULL CHECK (last_week BETWEEN first_week AND 52),
              recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('ALL', 'ODD', 'EVEN', 'CUSTOM')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX courses_by_semester_day ON courses(semester_id, weekday, start_time);

            CREATE TABLE course_custom_weeks (
              course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
              week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 52),
              PRIMARY KEY (course_id, week_number)
            );

            CREATE TABLE course_exceptions (
              course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
              original_date TEXT NOT NULL CHECK (original_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
              is_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (is_cancelled IN (0, 1)),
              replacement_date TEXT NOT NULL CHECK (replacement_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
              start_time TEXT NOT NULL DEFAULT '',
              end_time TEXT NOT NULL DEFAULT '',
              classroom TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (course_id, original_date)
            );
            CREATE INDEX course_exceptions_by_replacement ON course_exceptions(replacement_date);
          `);
          this.database.pragma('user_version = 2');
        })
        .immediate();
      version = 2;
    }
    if (version === 2) {
      this.database
        .transaction(() => {
          this.database.exec(`
            CREATE TABLE class_period_times (
              period_number INTEGER PRIMARY KEY NOT NULL CHECK (period_number BETWEEN 1 AND 24),
              start_time TEXT NOT NULL,
              end_time TEXT NOT NULL
            );
          `);
          this.database.pragma('user_version = 3');
        })
        .immediate();
      version = 3;
    }
    if (version !== SCHEMA_VERSION)
      throw new Error(`不支持的数据库版本 ${version}，数据未被修改。`);
  }

  listTasks(date: string): Task[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM tasks
         WHERE scheduled_date = ?
         ORDER BY is_completed ASC, sort_order ASC, created_at ASC`,
      )
      .all(date) as TaskRow[];
    return rows.map(taskFromRow);
  }

  listEvents(date: string): Event[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM events
         WHERE event_date = ?
         ORDER BY is_all_day DESC, start_time IS NULL ASC, start_time ASC, created_at ASC`,
      )
      .all(date) as EventRow[];
    return rows.map(eventFromRow);
  }

  createTask(input: TaskInput): Task {
    const id = randomUUID();
    const now = timestamp();
    const nextOrder = this.database
      .prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE scheduled_date = ?',
      )
      .get(input.scheduledDate) as { next_order: number };
    this.database
      .prepare(
        `INSERT INTO tasks (id, title, notes, scheduled_date, is_completed, completed_at, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.notes,
        input.scheduledDate,
        nextOrder.next_order,
        now,
        now,
      );
    return this.getTask(id);
  }

  updateTask(id: string, input: TaskInput): Task {
    const existing = this.findTask(id);
    if (!existing) throw new Error('这条待办已不存在，请刷新后重试。');
    const nextOrder =
      existing.scheduled_date === input.scheduledDate
        ? existing.sort_order
        : (
            this.database
              .prepare(
                'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE scheduled_date = ?',
              )
              .get(input.scheduledDate) as { next_order: number }
          ).next_order;
    this.database
      .prepare(
        'UPDATE tasks SET title = ?, notes = ?, scheduled_date = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.title,
        input.notes,
        input.scheduledDate,
        nextOrder,
        timestamp(),
        id,
      );
    return this.getTask(id);
  }

  setTaskCompleted(id: string, isCompleted: boolean): Task {
    const result = this.database
      .prepare(
        'UPDATE tasks SET is_completed = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        isCompleted ? 1 : 0,
        isCompleted ? timestamp() : null,
        timestamp(),
        id,
      );
    if (result.changes !== 1)
      throw new Error('这条待办已不存在，请刷新后重试。');
    return this.getTask(id);
  }

  deleteTask(id: string) {
    const result = this.database
      .prepare('DELETE FROM tasks WHERE id = ?')
      .run(id);
    if (result.changes !== 1)
      throw new Error('这条待办已不存在，请刷新后重试。');
  }

  moveTask(id: string, direction: MoveDirection) {
    const task = this.findTask(id);
    if (!task) throw new Error('这条待办已不存在，请刷新后重试。');
    if (task.is_completed === 1) throw new Error('已完成的待办不能调整顺序。');

    const rows = this.database
      .prepare(
        'SELECT id FROM tasks WHERE scheduled_date = ? AND is_completed = 0 ORDER BY sort_order ASC, created_at ASC',
      )
      .all(task.scheduled_date) as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    const update = this.database.prepare(
      'UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?',
    );
    const now = timestamp();
    this.database.transaction(() => {
      rows.forEach((row, order) => update.run(order, now, row.id));
    })();
  }

  createEvent(input: EventInput): Event {
    const id = randomUUID();
    const now = timestamp();
    this.database
      .prepare(
        `INSERT INTO events (id, title, event_date, start_time, end_time, is_all_day, location, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.eventDate,
        input.startTime,
        input.endTime,
        input.isAllDay ? 1 : 0,
        input.location,
        input.notes,
        now,
        now,
      );
    return this.getEvent(id);
  }

  updateEvent(id: string, input: EventInput): Event {
    const result = this.database
      .prepare(
        `UPDATE events SET title = ?, event_date = ?, start_time = ?, end_time = ?, is_all_day = ?, location = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title,
        input.eventDate,
        input.startTime,
        input.endTime,
        input.isAllDay ? 1 : 0,
        input.location,
        input.notes,
        timestamp(),
        id,
      );
    if (result.changes !== 1)
      throw new Error('这条日程已不存在，请刷新后重试。');
    return this.getEvent(id);
  }

  deleteEvent(id: string) {
    const result = this.database
      .prepare('DELETE FROM events WHERE id = ?')
      .run(id);
    if (result.changes !== 1)
      throw new Error('这条日程已不存在，请刷新后重试。');
  }

  private findTask(id: string): TaskRow | undefined {
    return this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined;
  }

  private getTask(id: string): Task {
    const row = this.findTask(id);
    if (!row) throw new Error('保存后无法读取待办记录。');
    return taskFromRow(row);
  }

  private getEvent(id: string): Event {
    const row = this.database
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id) as EventRow | undefined;
    if (!row) throw new Error('保存后无法读取日程记录。');
    return eventFromRow(row);
  }
}
