const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const ExcelJS = require('exceljs');

const {
  createCourseTemplate,
  createCsvTemplate,
  parseCsvImport,
  parseIcsImport,
  parseXlsxImport,
} = require('../.test-output/importParsers.js');
const { PlannerDatabase } = require('../.test-output/database.js');

const semester = {
  id: 'semester-import-test',
  semesterName: '2026 秋季学期',
  startDate: '2026-09-01',
  endDate: '2026-12-20',
  firstWeekMonday: '2026-08-31',
  isCurrent: true,
  createdAt: 'created',
  updatedAt: 'updated',
};

const context = (
  sourceLabel = 'synthetic.ics',
  selectedSemester = semester,
) => ({
  semester: selectedSemester,
  sourceLabel,
  contentHash: 'a'.repeat(64),
});

const icsHeader = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//DayByDay tests//EN',
];

function openDatabase() {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-import-db-'),
  );
  const databasePath = path.join(temporaryDirectory, 'planner.sqlite');
  const database = new PlannerDatabase(databasePath);
  return {
    database,
    close() {
      database.close();
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    },
  };
}

function courseInput(overrides = {}) {
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

function batchPayload(items, overrides = {}) {
  return {
    options: {
      semesterId: semester.id,
      sourceType: 'ICS',
      sourceLabel: 'synthetic.ics',
      contentHash: 'b'.repeat(64),
      ...overrides,
    },
    items,
  };
}

test('ICS single timed and all-day events retain title, location, description and local calendar dates', () => {
  const text = [
    ...icsHeader,
    'BEGIN:VEVENT',
    'UID:lab@example.test',
    'DTSTART:20260908T060000Z',
    'DTEND:20260908T073000Z',
    'SUMMARY:实验室安全培训',
    'LOCATION:实验楼 A405',
    'DESCRIPTION:请携带学生证',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:holiday@example.test',
    'DTSTART;VALUE=DATE:20261001',
    'DTEND;VALUE=DATE:20261002',
    'SUMMARY:国庆节',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const drafts = parseIcsImport(text, context());
  assert.equal(drafts.length, 2);
  const timed = drafts.find((draft) => draft.courseName === '实验室安全培训');
  const allDay = drafts.find((draft) => draft.courseName === '国庆节');
  assert.equal(timed.kind, 'event');
  assert.equal(timed.eventDate, '2026-09-08');
  assert.equal(
    timed.startTime,
    `${String(new Date(Date.UTC(2026, 8, 8, 6)).getHours()).padStart(2, '0')}:00`,
  );
  assert.equal(
    timed.endTime,
    `${String(new Date(Date.UTC(2026, 8, 8, 7)).getHours()).padStart(2, '0')}:30`,
  );
  assert.equal(timed.classroom, '实验楼 A405');
  assert.match(timed.notes, /学生证/);
  assert.ok(timed.warnings.some((warning) => warning.includes('来源时区')));
  assert.equal(allDay.isAllDay, true);
  assert.equal(allDay.eventDate, '2026-10-01');
  assert.equal(allDay.startTime, null);
});

test('ICS IANA TZID without embedded VTIMEZONE is converted across the DST boundary', () => {
  const springSemester = {
    ...semester,
    startDate: '2026-03-02',
    endDate: '2026-03-20',
    firstWeekMonday: '2026-03-02',
  };
  const text = [
    ...icsHeader,
    'BEGIN:VEVENT',
    'UID:dst-boundary@example.test',
    'DTSTART;TZID=America/New_York:20260308T013000',
    'DTEND;TZID=America/New_York:20260308T033000',
    'SUMMARY:夏令时边界课程',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const [draft] = parseIcsImport(text, context('dst.ics', springSemester));
  const expectedStart = new Date(Date.UTC(2026, 2, 8, 6, 30));
  const expectedEnd = new Date(Date.UTC(2026, 2, 8, 7, 30));
  const expectedDate = (date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  const expectedTime = (date) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  assert.equal(draft.kind, 'event');
  assert.equal(draft.eventDate, expectedDate(expectedStart));
  assert.equal(draft.startTime, expectedTime(expectedStart));
  assert.equal(draft.endTime, expectedTime(expectedEnd));
  assert.ok(draft.warnings.some((warning) => warning.includes('来源时区')));
});

test('ICS weekly RRULE honors the teaching-week Monday, EXDATE cancellation and RECURRENCE-ID move', () => {
  const text = [
    ...icsHeader,
    'BEGIN:VEVENT',
    'UID:korean-weekly@example.test',
    'DTSTART:20260831T090000',
    'DTEND:20260831T103000',
    'RRULE:FREQ=WEEKLY;COUNT=16',
    'EXDATE:20261005T090000',
    'SUMMARY:韩语课',
    'LOCATION:A203',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:korean-weekly@example.test',
    'RECURRENCE-ID:20261019T090000',
    'DTSTART:20261020T130000',
    'DTEND:20261020T143000',
    'SUMMARY:韩语课',
    'LOCATION:B405',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const drafts = parseIcsImport(text, context());
  assert.equal(drafts.length, 1);
  const course = drafts[0];
  assert.equal(course.kind, 'course');
  assert.equal(course.weekday, 1);
  assert.equal(course.firstWeek, 1);
  assert.equal(course.lastWeek, 16);
  assert.equal(course.recurrenceType, 'ALL');
  assert.equal(course.startTime, '09:00');
  assert.equal(course.exceptions.length, 2);
  assert.ok(
    course.exceptions.some(
      (item) => item.isCancelled && item.originalDate === '2026-10-05',
    ),
  );
  assert.ok(
    course.exceptions.some(
      (item) =>
        !item.isCancelled &&
        item.originalDate === '2026-10-19' &&
        item.replacementDate === '2026-10-20' &&
        item.startTime === '13:00' &&
        item.classroom === 'B405',
    ),
  );
});

test('ICS recurring dates outside the target semester are excluded and unsupported recurrence remains explicit events', () => {
  const text = [
    ...icsHeader,
    'BEGIN:VEVENT',
    'UID:monthly@example.test',
    'DTSTART:20260901T110000Z',
    'DTEND:20260901T120000Z',
    'RRULE:FREQ=MONTHLY;COUNT=4',
    'SUMMARY:每月讨论',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const drafts = parseIcsImport(text, context());
  assert.ok(drafts.length > 1);
  assert.ok(drafts.every((draft) => draft.kind === 'event'));
  assert.ok(
    drafts.every(
      (draft) =>
        draft.eventDate >= semester.startDate &&
        draft.eventDate <= semester.endDate,
    ),
  );
});

test('CSV supports bilingual headers, week rules, row identifiers and explicit manual column mapping', () => {
  const csv = [
    '课程名称,星期,开始时间,结束时间,教室,开始周次,结束周次,重复规则,指定周次',
    '韩语课,星期一,09:00,10:30,A203,1,16,单周,',
    'Math 101,Friday,13:00,14:30,B205,1,16,指定周次,"1, 3, 8, 12"',
  ].join('\r\n');
  const parsed = parseCsvImport(csv, context('classes.csv'), { headerRow: 1 });
  assert.equal(parsed.drafts.length, 2);
  assert.equal(parsed.drafts[0].weekday, 1);
  assert.equal(parsed.drafts[0].recurrenceType, 'ODD');
  assert.equal(parsed.drafts[1].weekday, 5);
  assert.equal(parsed.drafts[1].recurrenceType, 'CUSTOM');
  assert.deepEqual(parsed.drafts[1].customWeeks, [1, 3, 8, 12]);
  assert.notEqual(parsed.drafts[0].sourceId, parsed.drafts[1].sourceId);

  const nonstandard =
    'notes,title,day,start,end,weeks\nroom A,Design Lab,Wednesday,10:00,11:20,1-16周';
  const mapped = parseCsvImport(nonstandard, context('other.csv'), {
    headerRow: 1,
    mapping: {
      courseName: 1,
      weekday: 2,
      startTime: 3,
      endTime: 4,
      weekRule: 5,
      classroom: 0,
    },
  });
  assert.equal(mapped.drafts[0].courseName, 'Design Lab');
  assert.equal(mapped.drafts[0].weekday, 3);
  assert.equal(mapped.drafts[0].recurrenceType, 'ALL');
  assert.equal(mapped.drafts[0].classroom, 'room A');
});

test('XLSX supports multiple sheets, selected sheet, formatted times, merged-cell warnings and formula non-execution', async () => {
  const workbook = new ExcelJS.Workbook();
  const irrelevant = workbook.addWorksheet('说明');
  irrelevant.addRow(['这是说明页']);
  const sheet = workbook.addWorksheet('2026 秋季');
  sheet.addRow([
    '课程名称',
    '星期',
    '开始时间',
    '结束时间',
    '教室',
    '开始周次',
    '结束周次',
    '重复规则',
  ]);
  sheet.addRow([
    '数据库',
    '星期二',
    new Date(Date.UTC(1899, 11, 30, 9)),
    '10:30',
    'A301',
    1,
    16,
    '双周',
  ]);
  sheet.getCell('C2').numFmt = 'hh:mm';
  sheet.addRow(['合并课程', '星期三', '13:00', '14:20', 'B201', 1, 16, '每周']);
  sheet.mergeCells('A3:A4');
  sheet.addRow(['', '星期四', '15:00', '16:00', 'B202', 1, 16, '每周']);
  sheet.getCell('A5').value = { formula: '"不执行"', result: '不执行' };
  const written = await workbook.xlsx.writeBuffer();
  const bytes = written.buffer.slice(
    written.byteOffset,
    written.byteOffset + written.byteLength,
  );
  const parsed = await parseXlsxImport(bytes, context('classes.xlsx'), {
    headerRow: 1,
    sheetName: '2026 秋季',
  });
  assert.deepEqual(parsed.sheetNames, ['说明', '2026 秋季']);
  assert.equal(parsed.drafts[0].courseName, '数据库');
  assert.equal(parsed.drafts[0].startTime, '09:00');
  assert.equal(parsed.drafts[0].recurrenceType, 'EVEN');
  assert.ok(parsed.warnings.some((warning) => warning.includes('合并单元格')));
  assert.ok(parsed.warnings.some((warning) => warning.includes('公式未执行')));
  assert.equal(
    parsed.drafts.some((draft) => draft.courseName === '不执行'),
    false,
  );
});

test('downloadable XLSX and CSV templates contain the canonical Chinese course headers and no fake class row', async () => {
  const template = await createCourseTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await template.arrayBuffer());
  const values = workbook.worksheets[0].getRow(1).values.slice(1);
  assert.deepEqual(values, [
    '课程名称',
    '星期',
    '开始时间',
    '结束时间',
    '教室',
    '教师',
    '开始周次',
    '结束周次',
    '重复规则',
    '指定周次',
    '备注',
  ]);
  assert.ok(
    ['', null].includes(workbook.worksheets[0].getRow(2).getCell(1).value),
  );
  assert.match(createCsvTemplate(), /课程名称,星期,开始时间/);
});

test('SQLite batch import keeps course exceptions and events atomic, records source IDs, skips repeat source and safely undoes only untouched additions', () => {
  const store = openDatabase();
  try {
    const db = store.database;
    const createdSemester = db.createSemester({
      semesterName: semester.semesterName,
      startDate: semester.startDate,
      endDate: semester.endDate,
      firstWeekMonday: semester.firstWeekMonday,
      isCurrent: true,
    });
    const task = db.createTask({
      title: '原有待办',
      notes: '',
      scheduledDate: '2026-09-01',
    });
    const oldEvent = db.createEvent({
      title: '原有日程',
      eventDate: '2026-09-01',
      startTime: '08:00',
      endTime: '08:30',
      isAllDay: false,
      location: '',
      notes: '',
    });
    const course = courseInput({ semesterId: createdSemester.id });
    const payload = batchPayload(
      [
        {
          kind: 'course',
          sourceId: 'weekly-uid:monday',
          input: course,
          exceptions: [
            {
              originalDate: '2026-10-05',
              isCancelled: true,
              replacementDate: '2026-10-05',
              startTime: '',
              endTime: '',
              classroom: '',
            },
          ],
        },
        {
          kind: 'event',
          sourceId: 'exam-uid:2026-09-08',
          input: {
            title: '期中考试',
            eventDate: '2026-09-08',
            startTime: '14:00',
            endTime: '16:00',
            isAllDay: false,
            location: 'B101',
            notes: '',
          },
        },
      ],
      { semesterId: createdSemester.id },
    );

    const result = db.importBatch(payload, []);
    assert.equal(result.importedCount, 1);
    assert.equal(result.importedEventCount, 1);
    assert.equal(
      db.listCourseOccurrences('2026-10-05', '2026-10-05').length,
      0,
    );
    assert.equal(db.listEvents('2026-09-08')[0].title, '期中考试');
    assert.equal(db.listTasks('2026-09-01')[0].id, task.id);
    assert.equal(db.listEvents('2026-09-01')[0].id, oldEvent.id);

    const repeated = db.analyzeImportBatch(payload);
    assert.deepEqual(
      repeated.duplicates.map((item) => item.reason),
      ['same-source', 'same-source'],
    );
    const skipped = db.importBatch(
      payload,
      repeated.duplicates.map((item) => ({
        itemIndex: item.itemIndex,
        action: 'skip',
      })),
    );
    assert.equal(skipped.importedCount, 0);
    assert.equal(skipped.importedEventCount, 0);
    assert.equal(skipped.skippedCount, 2);
    assert.equal(db.listCourses(createdSemester.id).length, 1);

    const batchId = db.database
      .prepare('SELECT id FROM import_batches WHERE content_hash = ?')
      .get('b'.repeat(64)).id;
    db.updateCourseSeries(
      db.listCourses(createdSemester.id)[0].id,
      courseInput({
        semesterId: createdSemester.id,
        courseName: '用户后来改过的课程',
      }),
      'preserve-valid',
    );
    const undo = db.undoImportBatch(batchId);
    assert.equal(undo.removedCourseCount, 0);
    assert.equal(undo.removedEventCount, 1);
    assert.equal(undo.retainedItemCount, 1);
    assert.equal(
      db.listCourses(createdSemester.id)[0].courseName,
      '用户后来改过的课程',
    );
    assert.equal(db.listEvents('2026-09-08').length, 0);
    assert.equal(db.listTasks('2026-09-01')[0].id, task.id);
    assert.equal(db.listEvents('2026-09-01')[0].id, oldEvent.id);
  } finally {
    store.close();
  }
});

test('SQLite batch transaction rolls back every item when a later database write fails', () => {
  const store = openDatabase();
  try {
    const db = store.database;
    const createdSemester = db.createSemester({
      semesterName: semester.semesterName,
      startDate: semester.startDate,
      endDate: semester.endDate,
      firstWeekMonday: semester.firstWeekMonday,
      isCurrent: true,
    });
    const payload = batchPayload(
      [
        {
          kind: 'course',
          sourceId: 'good',
          input: courseInput({ semesterId: createdSemester.id }),
          exceptions: [],
        },
        {
          kind: 'course',
          sourceId: 'bad',
          input: courseInput({
            semesterId: createdSemester.id,
            courseName: '',
          }),
          exceptions: [],
        },
      ],
      { semesterId: createdSemester.id },
    );
    assert.throws(() => db.importBatch(payload, []));
    assert.equal(db.listCourses(createdSemester.id).length, 0);
    assert.equal(
      db.database.prepare('SELECT count(*) AS count FROM import_batches').get()
        .count,
      0,
    );
  } finally {
    store.close();
  }
});
