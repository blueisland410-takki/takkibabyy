const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const BetterSqlite3 = require('better-sqlite3');
const { PlannerDatabase } = require('../.test-output/database.js');
const {
  parseEventInput,
  parseTaskInput,
  parseCourseInput,
  parseSemesterInput,
} = require('../.test-output/validation.js');
const {
  courseDateForWeek,
  getTeachingWeekNumber,
  shiftDateKey,
} = require('../.test-output/courseSchedule.js');
const { mergeAgendaItems } = require('../.test-output/scheduleView.js');

let temporaryDirectory;
let database;

function openDatabase() {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'daybyday-test-'));
  database = new PlannerDatabase(
    path.join(temporaryDirectory, 'planner.sqlite'),
  );
  return database;
}

afterEach(() => {
  database?.close();
  database = undefined;
  if (temporaryDirectory)
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

test('tasks persist, keep completion history, support notes and ordering by date', () => {
  const store = openDatabase();
  const first = store.createTask({
    title: '整理笔记',
    notes: '补上课堂重点',
    scheduledDate: '2026-10-18',
  });
  const second = store.createTask({
    title: '回复邮件',
    notes: '',
    scheduledDate: '2026-10-18',
  });
  const tomorrow = store.createTask({
    title: '明天买咖啡豆',
    notes: '',
    scheduledDate: '2026-10-19',
  });

  assert.equal(store.listTasks('2026-10-18').length, 2);
  assert.equal(store.listTasks('2026-10-19')[0].id, tomorrow.id);

  store.updateTask(second.id, {
    title: '回复重要邮件',
    notes: '先看附件',
    scheduledDate: '2026-10-18',
  });
  store.moveTask(second.id, 'up');
  assert.deepEqual(
    store.listTasks('2026-10-18').map((task) => task.title),
    ['回复重要邮件', '整理笔记'],
  );

  const completed = store.setTaskCompleted(first.id, true);
  assert.equal(completed.isCompleted, true);
  assert.ok(completed.completedAt);
  assert.deepEqual(
    store.listTasks('2026-10-18').map((task) => task.title),
    ['回复重要邮件', '整理笔记'],
  );
  store.setTaskCompleted(first.id, false);
  assert.equal(
    store.listTasks('2026-10-18').find((task) => task.id === first.id)
      .completedAt,
    null,
  );
  store.deleteTask(second.id);
  assert.deepEqual(
    store.listTasks('2026-10-18').map((task) => task.id),
    [first.id],
  );
});

test('events sort all-day first and timed events by start time; edits and deletes persist', () => {
  const store = openDatabase();
  const afternoon = store.createEvent({
    title: '下午会面',
    eventDate: '2026-10-18',
    startTime: '15:00',
    endTime: '16:00',
    isAllDay: false,
    location: '图书馆',
    notes: '',
  });
  const morning = store.createEvent({
    title: '晨间散步',
    eventDate: '2026-10-18',
    startTime: '09:00',
    endTime: null,
    isAllDay: false,
    location: '',
    notes: '',
  });
  const allDay = store.createEvent({
    title: '休息日',
    eventDate: '2026-10-18',
    startTime: null,
    endTime: null,
    isAllDay: true,
    location: '',
    notes: '',
  });

  assert.deepEqual(
    store.listEvents('2026-10-18').map((event) => event.id),
    [allDay.id, morning.id, afternoon.id],
  );
  store.updateEvent(afternoon.id, {
    title: '提前会面',
    eventDate: '2026-10-18',
    startTime: '08:00',
    endTime: '08:30',
    isAllDay: false,
    location: '咖啡店',
    notes: '带文件',
  });
  assert.deepEqual(
    store.listEvents('2026-10-18').map((event) => event.id),
    [allDay.id, afternoon.id, morning.id],
  );
  assert.equal(store.listEvents('2026-10-18')[1].location, '咖啡店');
  store.deleteEvent(morning.id);
  assert.deepEqual(
    store.listEvents('2026-10-18').map((event) => event.id),
    [allDay.id, afternoon.id],
  );
});

test('validation rejects empty titles, impossible local dates and invalid event times', () => {
  assert.throws(
    () => parseTaskInput({ title: '   ', scheduledDate: '2026-10-18' }),
    /不能为空/,
  );
  assert.throws(
    () => parseTaskInput({ title: '任务', scheduledDate: '2026-02-30' }),
    /不存在/,
  );
  assert.throws(
    () =>
      parseEventInput({
        title: '安排',
        eventDate: '2026-10-18',
        startTime: '22:00',
        endTime: '21:00',
        isAllDay: false,
      }),
    /结束时间必须晚于开始时间/,
  );
  assert.throws(
    () =>
      parseEventInput({
        title: '安排',
        eventDate: '2026-10-18',
        startTime: '25:30',
        isAllDay: false,
      }),
    /开始时间无效/,
  );
});

test('future schema version is refused without modifying the existing database file', () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-version-test-'),
  );
  const filePath = path.join(temporaryDirectory, 'planner.sqlite');
  const existing = new BetterSqlite3(filePath);
  existing.exec(
    "CREATE TABLE preserve_me (value TEXT NOT NULL); INSERT INTO preserve_me VALUES ('kept'); PRAGMA user_version = 99;",
  );
  existing.close();

  assert.throws(() => new PlannerDatabase(filePath), /高于当前软件支持的版本/);
  const reopened = new BetterSqlite3(filePath);
  assert.equal(
    reopened.prepare('SELECT value FROM preserve_me').get().value,
    'kept',
  );
  assert.equal(reopened.pragma('user_version', { simple: true }), 99);
  reopened.close();
});

test('records remain available after the database is closed and reopened', () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-reopen-test-'),
  );
  const filePath = path.join(temporaryDirectory, 'planner.sqlite');
  database = new PlannerDatabase(filePath);
  const task = database.createTask({
    title: '重新启动后仍在',
    notes: '',
    scheduledDate: '2026-10-20',
  });
  const event = database.createEvent({
    title: '保存的约定',
    eventDate: '2026-10-20',
    startTime: '10:00',
    endTime: '11:00',
    isAllDay: false,
    location: '',
    notes: '',
  });
  database.close();

  database = new PlannerDatabase(filePath);
  assert.equal(database.listTasks('2026-10-20')[0].id, task.id);
  assert.equal(database.listEvents('2026-10-20')[0].id, event.id);
});

test('version 1 database migrates to semester planner without changing tasks and events', () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-v1-migration-'),
  );
  const filePath = path.join(temporaryDirectory, 'planner.sqlite');
  const existing = new BetterSqlite3(filePath);
  existing.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL, scheduled_date TEXT NOT NULL, is_completed INTEGER NOT NULL, completed_at TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT NOT NULL, event_date TEXT NOT NULL, start_time TEXT, end_time TEXT, is_all_day INTEGER NOT NULL, location TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO tasks VALUES ('task-keep', '原有待办', '', '2026-08-31', 0, NULL, 0, 'created', 'updated');
    INSERT INTO events VALUES ('event-keep', '原有日程', '2026-08-31', '12:00', '12:30', 0, '', '', 'created', 'updated');
    PRAGMA user_version = 1;
  `);
  existing.close();

  database = new PlannerDatabase(filePath);
  assert.equal(database.listTasks('2026-08-31')[0].title, '原有待办');
  assert.equal(database.listEvents('2026-08-31')[0].title, '原有日程');
  const reopened = new BetterSqlite3(filePath);
  assert.equal(reopened.pragma('user_version', { simple: true }), 2);
  reopened.close();
  assert.equal(database.listSemesters().length, 0);
});

test('semester weeks and ALL, ODD, EVEN, CUSTOM courses use the first teaching Monday', () => {
  const store = openDatabase();
  const semester = store.createSemester({
    semesterName: '2026 秋季学期',
    startDate: '2026-08-31',
    endDate: '2026-12-20',
    firstWeekMonday: '2026-08-31',
    isCurrent: true,
  });
  assert.equal(
    getTeachingWeekNumber(semester.firstWeekMonday, '2026-09-07'),
    2,
  );
  const base = {
    semesterId: semester.id,
    weekday: 1,
    startTime: '09:00',
    endTime: '10:30',
    classroom: 'A203',
    teacher: '',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    customWeeks: [],
  };
  const weekly = store.createCourse({
    ...base,
    courseName: '每周课',
    recurrenceType: 'ALL',
  });
  const odd = store.createCourse({
    ...base,
    courseName: '单周课',
    recurrenceType: 'ODD',
  });
  const even = store.createCourse({
    ...base,
    courseName: '双周课',
    recurrenceType: 'EVEN',
  });
  const custom = store.createCourse({
    ...base,
    courseName: '指定周课程',
    weekday: 4,
    recurrenceType: 'CUSTOM',
    customWeeks: [1, 3, 8, 12],
  });

  const occurrences = store.listCourseOccurrences('2026-08-31', '2026-12-20');
  const byCourse = (course) =>
    occurrences.filter((item) => item.id === course.id);
  assert.equal(byCourse(weekly).length, 16);
  assert.deepEqual(
    byCourse(weekly).map((item) => item.occurrenceDate),
    Array.from({ length: 16 }, (_, index) =>
      courseDateForWeek('2026-08-31', index + 1, 1),
    ),
  );
  assert.deepEqual(
    byCourse(odd).map((item) =>
      getTeachingWeekNumber(semester.firstWeekMonday, item.occurrenceDate),
    ),
    [1, 3, 5, 7, 9, 11, 13, 15],
  );
  assert.deepEqual(
    byCourse(even).map((item) =>
      getTeachingWeekNumber(semester.firstWeekMonday, item.occurrenceDate),
    ),
    [2, 4, 6, 8, 10, 12, 14, 16],
  );
  assert.deepEqual(
    byCourse(custom).map((item) =>
      getTeachingWeekNumber(semester.firstWeekMonday, item.occurrenceDate),
    ),
    [1, 3, 8, 12],
  );
});

test('single cancellation and cross-week move affect only the tracked original occurrence', () => {
  const store = openDatabase();
  const semester = store.createSemester({
    semesterName: '16 周测试学期',
    startDate: '2026-08-31',
    endDate: '2026-12-20',
    firstWeekMonday: '2026-08-31',
    isCurrent: true,
  });
  const course = store.createCourse({
    semesterId: semester.id,
    courseName: '韩语课',
    weekday: 1,
    startTime: '09:00',
    endTime: '10:30',
    classroom: 'A203',
    teacher: 'Kim',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
  });
  const cancelledDate = courseDateForWeek(semester.firstWeekMonday, 6, 1);
  store.saveCourseException({
    courseId: course.id,
    originalDate: cancelledDate,
    isCancelled: true,
    replacementDate: cancelledDate,
    startTime: '',
    endTime: '',
    classroom: '',
  });
  const originalMoveDate = courseDateForWeek(semester.firstWeekMonday, 8, 1);
  const movedDate = courseDateForWeek(semester.firstWeekMonday, 9, 2);
  store.saveCourseException({
    courseId: course.id,
    originalDate: originalMoveDate,
    isCancelled: false,
    replacementDate: movedDate,
    startTime: '08:00',
    endTime: '09:30',
    classroom: 'B405',
  });

  let occurrences = store
    .listCourseOccurrences('2026-08-31', '2026-12-20')
    .filter((item) => item.id === course.id);
  assert.equal(
    occurrences.some((item) => item.occurrenceDate === cancelledDate),
    false,
  );
  assert.equal(
    occurrences.some(
      (item) =>
        item.occurrenceDate ===
        courseDateForWeek(semester.firstWeekMonday, 7, 1),
    ),
    true,
  );
  assert.equal(
    occurrences.some((item) => item.occurrenceDate === originalMoveDate),
    false,
  );
  const moved = occurrences.filter((item) => item.occurrenceDate === movedDate);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].originalDate, originalMoveDate);
  assert.equal(moved[0].classroom, 'B405');

  store.updateCourseSeries(
    course.id,
    {
      ...course,
      startTime: '10:00',
      endTime: '11:30',
    },
    'preserve-valid',
  );
  occurrences = store
    .listCourseOccurrences('2026-08-31', '2026-12-20')
    .filter((item) => item.id === course.id);
  assert.equal(
    occurrences.find(
      (item) =>
        item.occurrenceDate ===
        courseDateForWeek(semester.firstWeekMonday, 7, 1),
    ).startTime,
    '10:00',
  );
  assert.equal(
    occurrences.find((item) => item.occurrenceDate === movedDate).startTime,
    '08:00',
  );
  assert.equal(
    occurrences.find((item) => item.occurrenceDate === movedDate).classroom,
    'B405',
  );
});

test('semester and course validation rejects invalid bounds while allowing schedule conflicts', () => {
  assert.throws(
    () =>
      parseSemesterInput({
        semesterName: '坏学期',
        startDate: '2026-09-02',
        endDate: '2026-09-01',
        firstWeekMonday: '2026-08-31',
        isCurrent: true,
      }),
    /结束日期不能早于开始日期/,
  );
  assert.throws(
    () =>
      parseSemesterInput({
        semesterName: '坏学期',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
        firstWeekMonday: '2026-09-01',
        isCurrent: true,
      }),
    /星期一/,
  );
  const store = openDatabase();
  const semester = store.createSemester({
    semesterName: '边界学期',
    startDate: '2026-08-31',
    endDate: '2026-12-20',
    firstWeekMonday: '2026-08-31',
    isCurrent: true,
  });
  assert.throws(
    () =>
      parseCourseInput({
        semesterId: semester.id,
        courseName: '错误时间',
        weekday: 1,
        startTime: '25:00',
        endTime: '26:00',
        firstWeek: 1,
        lastWeek: 16,
        recurrenceType: 'ALL',
        customWeeks: [],
      }),
    /开始时间无效/,
  );
  const first = store.createCourse({
    semesterId: semester.id,
    courseName: '课程一',
    weekday: 1,
    startTime: '09:00',
    endTime: '10:00',
    classroom: '',
    teacher: '',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
  });
  store.createCourse({
    semesterId: semester.id,
    courseName: '冲突课程',
    weekday: 1,
    startTime: '09:30',
    endTime: '10:30',
    classroom: '',
    teacher: '',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
  });
  assert.equal(
    store
      .listCourseOccurrences('2026-08-31', '2026-08-31')
      .filter((item) => item.occurrenceDate === '2026-08-31').length,
    2,
  );
  assert.throws(
    () =>
      store.saveCourseException({
        courseId: first.id,
        originalDate: '2026-08-31',
        isCancelled: false,
        replacementDate: '2026-12-21',
        startTime: '11:00',
        endTime: '12:00',
        classroom: '',
      }),
    /学期范围内/,
  );
});

test('agenda merges courses and temporary events by time with all-day events first', () => {
  const course = {
    id: 'course',
    courseName: '课程',
    startTime: '09:00',
    occurrenceDate: '2026-08-31',
  };
  const events = [
    { id: 'late', title: '下午安排', isAllDay: false, startTime: '14:00' },
    { id: 'all-day', title: '全天安排', isAllDay: true, startTime: null },
    { id: 'between', title: '中间安排', isAllDay: false, startTime: '10:00' },
  ];
  assert.deepEqual(
    mergeAgendaItems(events, [course]).map((item) =>
      item.kind === 'event' ? item.event.id : item.course.id,
    ),
    ['all-day', 'course', 'between', 'late'],
  );
});

test('week boundaries advance by seven local calendar dates and greeting copy is removed', () => {
  assert.equal(shiftDateKey('2026-10-19', 7), '2026-10-26');
  const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'App.tsx'),
    'utf8',
  );
  assert.equal(appSource.includes('A little plan for today'), false);
});

test('semester, course and one-off exceptions survive reopening with original tasks', () => {
  const store = openDatabase();
  const task = store.createTask({
    title: '已有待办',
    notes: '',
    scheduledDate: '2026-08-31',
  });
  const semester = store.createSemester({
    semesterName: '当前学期',
    startDate: '2026-08-31',
    endDate: '2026-12-20',
    firstWeekMonday: '2026-08-31',
    isCurrent: true,
  });
  const historical = store.createSemester({
    semesterName: '历史学期',
    startDate: '2025-08-25',
    endDate: '2025-12-14',
    firstWeekMonday: '2025-08-25',
    isCurrent: false,
  });
  assert.equal(
    store.listSemesters().filter((item) => item.isCurrent).length,
    1,
  );
  store.setCurrentSemester(historical.id);
  assert.equal(
    store.listSemesters().find((item) => item.id === historical.id).isCurrent,
    true,
  );
  store.setCurrentSemester(semester.id);
  const course = store.createCourse({
    semesterId: semester.id,
    courseName: '持久课程',
    weekday: 1,
    startTime: '09:00',
    endTime: '10:00',
    classroom: 'A203',
    teacher: '',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
  });
  store.saveCourseException({
    courseId: course.id,
    originalDate: '2026-08-31',
    isCancelled: true,
    replacementDate: '2026-08-31',
    startTime: '',
    endTime: '',
    classroom: '',
  });
  store.close();

  database = new PlannerDatabase(
    path.join(temporaryDirectory, 'planner.sqlite'),
  );
  assert.equal(database.listTasks('2026-08-31')[0].id, task.id);
  assert.equal(database.getCurrentSemester().id, semester.id);
  assert.equal(database.listCourses(semester.id)[0].id, course.id);
  assert.equal(
    database.listCourseOccurrences('2026-08-31', '2026-08-31').length,
    0,
  );
  assert.equal(database.listSemesters().length, 2);
});
