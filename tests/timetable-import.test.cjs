const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const Tesseract = require('tesseract.js');
const { PlannerDatabase } = require('../.test-output/src/database.js');
const { analyzeCourseImport } = require('../.test-output/src/courseImport.js');
const {
  parseWeekRule,
  parseTimetableLines,
  timeRangeForPeriods,
  ocrLinesFromBlocks,
} = require('../.test-output/src/timetableParser.js');
const { parseClassPeriodTimes } = require('../.test-output/src/validation.js');

let temporaryDirectory;
let database;

function openDatabase() {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-import-test-'),
  );
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

function createSemester(store, name = '合成课表测试学期') {
  return store.createSemester({
    semesterName: name,
    startDate: '2026-08-31',
    endDate: '2026-12-20',
    firstWeekMonday: '2026-08-31',
    isCurrent: true,
  });
}

function courseInput(semester, overrides = {}) {
  return {
    semesterId: semester.id,
    courseName: '韩语课',
    weekday: 1,
    startTime: '09:00',
    endTime: '10:30',
    classroom: 'A203',
    teacher: '金老师',
    notes: '',
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
    ...overrides,
  };
}

function line(text, x, y, confidence = 92, width = 70) {
  return {
    text,
    confidence,
    bbox: { x0: x - width / 2, y0: y, x1: x + width / 2, y1: y + 14 },
  };
}

test('version 2 database receives additive OCR and import-history migrations without changing saved courses or exceptions', () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-v2-migration-'),
  );
  const filePath = path.join(temporaryDirectory, 'planner.sqlite');
  const BetterSqlite3 = require('better-sqlite3');
  const existing = new BetterSqlite3(filePath);
  existing.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, notes TEXT, scheduled_date TEXT, is_completed INTEGER, completed_at TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, event_date TEXT, start_time TEXT, end_time TEXT, is_all_day INTEGER, location TEXT, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE semesters (id TEXT PRIMARY KEY, semester_name TEXT, start_date TEXT, end_date TEXT, first_week_monday TEXT, is_current INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE courses (id TEXT PRIMARY KEY, semester_id TEXT REFERENCES semesters(id), course_name TEXT, weekday INTEGER, start_time TEXT, end_time TEXT, classroom TEXT, teacher TEXT, notes TEXT, first_week INTEGER, last_week INTEGER, recurrence_type TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE course_custom_weeks (course_id TEXT REFERENCES courses(id), week_number INTEGER, PRIMARY KEY(course_id, week_number));
    CREATE TABLE course_exceptions (course_id TEXT REFERENCES courses(id), original_date TEXT, is_cancelled INTEGER, replacement_date TEXT, start_time TEXT, end_time TEXT, classroom TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(course_id, original_date));
    INSERT INTO tasks VALUES ('task-keep', '旧待办', '', '2026-08-31', 0, NULL, 0, 'c', 'u');
    INSERT INTO events VALUES ('event-keep', '旧日程', '2026-08-31', '13:00', '13:30', 0, '', '', 'c', 'u');
    INSERT INTO semesters VALUES ('semester-keep', '旧学期', '2026-08-31', '2026-12-20', '2026-08-31', 1, 'c', 'u');
    INSERT INTO courses VALUES ('course-keep', 'semester-keep', '旧课程', 1, '09:00', '10:00', 'A203', '', '', 1, 16, 'ALL', 'c', 'u');
    INSERT INTO course_exceptions VALUES ('course-keep', '2026-09-07', 1, '2026-09-07', '', '', '', 'c', 'u');
    PRAGMA user_version = 2;
  `);
  existing.close();

  database = new PlannerDatabase(filePath);
  assert.equal(database.listTasks('2026-08-31')[0].title, '旧待办');
  assert.equal(database.listEvents('2026-08-31')[0].title, '旧日程');
  assert.equal(database.listCourses('semester-keep')[0].courseName, '旧课程');
  assert.equal(
    database.listCourseOccurrences('2026-09-07', '2026-09-07').length,
    0,
  );
  const reopened = new BetterSqlite3(filePath);
  assert.equal(reopened.pragma('user_version', { simple: true }), 4);
  assert.equal(
    reopened.prepare('SELECT count(*) AS count FROM import_batches').get()
      .count,
    0,
  );
  assert.equal(
    reopened.prepare('SELECT count(*) AS count FROM import_batch_items').get()
      .count,
    0,
  );
  reopened.close();
});

function headers() {
  return [
    '星期一',
    '星期二',
    '星期三',
    '星期四',
    '星期五',
    '星期六',
    '星期日',
  ].map((text, index) => line(text, 100 + index * 100, 10));
}

test('week rules parse ranges, odd/even and explicit non-consecutive weeks against teaching-week bounds', () => {
  assert.deepEqual(parseWeekRule('1-16周', 16), {
    firstWeek: 1,
    lastWeek: 16,
    recurrenceType: 'ALL',
    customWeeks: [],
    issue: '',
  });
  assert.equal(parseWeekRule('1～16周 单周', 16).recurrenceType, 'ODD');
  assert.equal(parseWeekRule('1至8周（双）', 16).recurrenceType, 'EVEN');
  assert.deepEqual(
    parseWeekRule('第1、3、5、8、12周', 16).customWeeks,
    [1, 3, 5, 8, 12],
  );
  assert.match(parseWeekRule('1-18周', 16).issue, /超出当前学期范围/);
  assert.match(parseWeekRule('单周 双周', 16).issue, /互相矛盾/);
});

test('standard seven-column synthetic schedule creates coordinate-based candidates and preserves raw OCR lines', () => {
  const lines = [
    ...headers(),
    line('韩语课', 100, 130),
    line('09:00-10:30', 100, 150),
    line('教室:A203', 100, 170),
    line('第1-16周 单周', 100, 190),
    line('English 101', 200, 130),
    line('10:00-11:30', 200, 150),
    line('Room B205', 200, 170),
    line('第2、4、6周', 200, 190),
  ];
  const result = parseTimetableLines(lines, 16);
  assert.equal(result.weekdayColumnsFound, 7);
  assert.equal(result.courses.length, 2);
  assert.equal(result.courses[0].courseName, '韩语课');
  assert.equal(result.courses[0].weekday, 1);
  assert.equal(result.courses[0].startTime, '09:00');
  assert.equal(result.courses[0].classroom, 'A203');
  assert.equal(result.courses[0].recurrenceType, 'ODD');
  assert.equal(result.courses[1].courseName, 'English 101');
  assert.equal(result.courses[1].weekday, 2);
  assert.deepEqual(result.courses[1].customWeeks, [2, 4, 6]);
  assert.equal(result.courses[0].reviewed, false);
});

test('merged/multiline course cells are grouped conservatively into a single course candidate', () => {
  const result = parseTimetableLines(
    [
      ...headers(),
      line('计算机导论 CS101', 100, 150),
      line('14:00-15:30', 100, 174),
      line('教室:C301', 100, 198),
      line('第1-16周 双周', 100, 222),
    ],
    16,
  );
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].courseName, '计算机导论 CS101');
  assert.equal(result.courses[0].recurrenceType, 'EVEN');
});

test('period-only timetable remains marked for clock-time confirmation and a saved template maps section ranges', () => {
  const lines = [
    ...headers(),
    line('第1节', 22, 140, 90, 55),
    line('口语课 第1节', 100, 140),
    line('第2节', 22, 220, 90, 55),
  ];
  const result = parseTimetableLines(lines, 16);
  assert.equal(result.courses[0].periodStart, 1);
  assert.equal(result.courses[0].startTime, '');
  assert.ok(
    result.courses[0].issues.includes('节次已识别，需套用时间模板或填写钟点'),
  );
  const periods = parseClassPeriodTimes([
    { periodNumber: 1, startTime: '08:00', endTime: '08:45' },
    { periodNumber: 2, startTime: '08:55', endTime: '09:40' },
  ]);
  assert.deepEqual(timeRangeForPeriods(1, 2, periods), {
    startTime: '08:00',
    endTime: '09:40',
  });
  assert.equal(timeRangeForPeriods(3, 4, periods), null);
});

test('two weekly meetings of the same course at different times are kept distinct and overlapping courses warn', () => {
  const semester = { id: 'semester', semesterId: 'semester' };
  const first = courseInput(semester, { startTime: '09:00', endTime: '10:00' });
  const second = courseInput(semester, {
    startTime: '10:00',
    endTime: '11:00',
  });
  const exactDuplicate = courseInput(semester, {
    startTime: '09:00',
    endTime: '10:00',
  });
  const overlap = courseInput(semester, {
    courseName: '另一门课',
    startTime: '09:30',
    endTime: '10:30',
  });
  const analysis = analyzeCourseImport(
    [],
    [first, second, exactDuplicate, overlap],
  );
  assert.equal(analysis.duplicates.length, 1);
  assert.equal(analysis.duplicates[0].courseIndex, 2);
  assert.ok(
    analysis.conflicts.some(
      (item) => item.firstCourseIndex === 0 && item.secondCourseIndex === 3,
    ),
  );
});

test('incomplete/low-confidence OCR and unsupported or empty layouts are never treated as confirmed courses', () => {
  const incomplete = parseTimetableLines(
    [...headers(), line('课程名待识别', 100, 140, 24)],
    16,
  ).courses[0];
  assert.ok(incomplete.issues.includes('周次规则待确认'));
  assert.ok(incomplete.issues.includes('识别置信度偏低，请对照原图检查'));
  assert.equal(incomplete.recurrenceType, null);
  assert.equal(
    parseTimetableLines([line('只有文字，没有星期表头', 100, 10)], 16).courses
      .length,
    0,
  );
  assert.equal(parseTimetableLines([], 16).courses.length, 0);
});

test('edited course fields are exactly what the confirmed SQLite batch stores and appear in day/week occurrence queries', () => {
  const store = openDatabase();
  const semester = createSemester(store);
  const edited = courseInput(semester, {
    courseName: '已人工校正的课程 CS202',
    startTime: '11:00',
    endTime: '12:20',
  });
  const analysis = store.analyzeCourseImport(semester.id, [edited]);
  assert.deepEqual(analysis, { duplicates: [], conflicts: [] });
  assert.deepEqual(store.importCourses(semester.id, [edited], []), {
    importedCount: 1,
    skippedCount: 0,
  });
  assert.equal(
    store.listCourses(semester.id)[0].courseName,
    '已人工校正的课程 CS202',
  );
  assert.equal(
    store.listCourseOccurrences('2026-08-31', '2026-09-06')[0].startTime,
    '11:00',
  );
});

test('reimport of the same timetable is surfaced as a duplicate and defaults to skip without overwriting', () => {
  const store = openDatabase();
  const semester = createSemester(store);
  const original = courseInput(semester);
  store.importCourses(semester.id, [original], []);
  const analysis = store.analyzeCourseImport(semester.id, [original]);
  assert.equal(analysis.duplicates.length, 1);
  assert.equal(
    analysis.duplicates[0].existingCourseId,
    store.listCourses(semester.id)[0].id,
  );
  assert.deepEqual(
    store.importCourses(
      semester.id,
      [original],
      [{ courseIndex: 0, action: 'skip' }],
    ),
    {
      importedCount: 0,
      skippedCount: 1,
    },
  );
  assert.equal(store.listCourses(semester.id).length, 1);
});

test('SQLite transaction rolls an entire batch back when a later course fails', () => {
  const store = openDatabase();
  const semester = createSemester(store);
  const valid = courseInput(semester);
  const invalid = courseInput(semester, { courseName: '' });
  assert.throws(() => store.importCourses(semester.id, [valid, invalid], []));
  assert.equal(store.listCourses(semester.id).length, 0);
});

test('period template is stored and survives reopening without changing existing tasks, events, or exceptions', () => {
  const store = openDatabase();
  const semester = createSemester(store);
  store.createTask({
    title: '仍然保留的待办',
    notes: '',
    scheduledDate: '2026-08-31',
  });
  store.createEvent({
    title: '仍然保留的日程',
    eventDate: '2026-08-31',
    startTime: '13:00',
    endTime: '13:30',
    isAllDay: false,
    location: '',
    notes: '',
  });
  const course = store.createCourse(courseInput(semester));
  store.saveCourseException({
    courseId: course.id,
    originalDate: '2026-09-07',
    isCancelled: true,
    replacementDate: '2026-09-07',
    startTime: '',
    endTime: '',
    classroom: '',
  });
  store.saveClassPeriodTimes([
    { periodNumber: 1, startTime: '08:00', endTime: '08:45' },
  ]);
  store.close();
  database = new PlannerDatabase(
    path.join(temporaryDirectory, 'planner.sqlite'),
  );
  assert.equal(database.getClassPeriodTimes()[0].startTime, '08:00');
  assert.equal(database.listTasks('2026-08-31')[0].title, '仍然保留的待办');
  assert.equal(database.listEvents('2026-08-31')[0].title, '仍然保留的日程');
  assert.equal(
    database.listCourseOccurrences('2026-09-07', '2026-09-07').length,
    0,
  );
  assert.equal(database.listCourses(semester.id).length, 1);
});

test('period template rejects gaps, invalid times, and overlaps', () => {
  assert.throws(() =>
    parseClassPeriodTimes([
      { periodNumber: 2, startTime: '09:00', endTime: '10:00' },
    ]),
  );
  assert.throws(() =>
    parseClassPeriodTimes([
      { periodNumber: 1, startTime: '10:00', endTime: '09:00' },
    ]),
  );
  assert.throws(() =>
    parseClassPeriodTimes([
      { periodNumber: 1, startTime: '09:00', endTime: '10:00' },
      { periodNumber: 2, startTime: '09:45', endTime: '10:30' },
    ]),
  );
});

test('synthetic timetable image is a valid independent PNG and bundled OCR assets are all local', () => {
  const fixture = path.join(
    __dirname,
    'fixtures',
    'synthetic-standard-timetable.png',
  );
  const png = fs.readFileSync(fixture);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'resources',
        'ocr',
        'lang',
        'chi_sim.traineddata.gz',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'resources',
        'ocr',
        'lang',
        'eng.traineddata.gz',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'resources',
        'ocr',
        'runtime',
        'worker.min.js',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'resources',
        'ocr',
        'runtime',
        'tesseract-core-lstm.wasm.js',
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        '..',
        'resources',
        'better-sqlite3',
        'prebuilds',
        'win32-x64.node',
      ),
    ),
  );
});

const stagedSqliteRuntime = path.join(
  __dirname,
  '..',
  '.package-temp',
  'platform-resources',
  `${process.platform}-${process.arch}`,
  'better-sqlite3',
);
const fallbackWindowsSqliteRuntime = path.join(
  __dirname,
  '..',
  'resources',
  'better-sqlite3',
);
const sqliteRuntimePath = fs.existsSync(stagedSqliteRuntime)
  ? stagedSqliteRuntime
  : process.platform === 'win32' && process.arch === 'x64'
    ? fallbackWindowsSqliteRuntime
    : undefined;

test(
  'the staged platform SQLite runtime opens an in-memory database',
  { skip: !sqliteRuntimePath },
  () => {
    const sqliteRuntime = require(sqliteRuntimePath);
    const packagedDatabase = new sqliteRuntime(':memory:');
    try {
      assert.deepEqual(packagedDatabase.prepare('SELECT 1 AS value').get(), {
        value: 1,
      });
    } finally {
      packagedDatabase.close();
    }
  },
);

test(
  'offline Tesseract.js recognizes the synthetic Chinese timetable and returns text coordinates',
  { timeout: 120_000 },
  async () => {
    const root = path.join(__dirname, '..');
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'daybyday-ocr-test-'),
    );
    const worker = await Tesseract.createWorker(
      'eng+chi_sim',
      Tesseract.OEM.LSTM_ONLY,
      {
        langPath: path.join(root, 'resources', 'ocr', 'lang'),
        corePath: path.join(
          root,
          'resources',
          'ocr',
          'runtime',
          'tesseract-core-lstm.wasm.js',
        ),
        cachePath: path.join(temporaryDirectory, 'cache'),
        gzip: true,
        cacheMethod: 'none',
      },
    );
    try {
      const result = await worker.recognize(
        path.join(__dirname, 'fixtures', 'synthetic-standard-timetable.png'),
        {},
        { text: true, blocks: true },
      );
      const normalizedText = result.data.text.replace(/\s/g, '');
      assert.match(normalizedText, /星期一/);
      assert.match(normalizedText, /韩语课/);
      assert.match(normalizedText, /English101/);
      assert.ok(
        result.data.blocks?.some((block) =>
          block.paragraphs.some((paragraph) => paragraph.lines.length > 0),
        ),
      );
      const parsed = parseTimetableLines(
        ocrLinesFromBlocks(result.data.blocks),
        16,
      );
      assert.equal(parsed.weekdayColumnsFound, 7);
      assert.equal(parsed.courses.length, 4);
      assert.ok(
        parsed.courses.some(
          (course) =>
            course.courseName === '韩语课' && course.recurrenceType === 'ODD',
        ),
      );
      assert.ok(
        parsed.courses.some(
          (course) =>
            course.courseName === 'English 101' && course.classroom === 'B205',
        ),
      );
      assert.ok(
        parsed.courses.some(
          (course) =>
            course.courseName === '体育选修' && course.recurrenceType === null,
        ),
      );
    } finally {
      await worker.terminate();
    }
  },
);

test('the main Day view keeps the removed greeting out of the source UI', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'App.tsx'),
    'utf8',
  );
  assert.equal(source.includes('A little plan for today'), false);
});
