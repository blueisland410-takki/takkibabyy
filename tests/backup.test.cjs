const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const BetterSqlite3 = require('better-sqlite3');
const { PlannerDatabase } = require('../.test-output/src/database.js');
const {
  encodeBackupHeader,
  getBackupFixedPrefixLength,
  getBackupHeaderLength,
  parseBackupHeader,
} = require('../.test-output/src/backupFormat.js');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('backup header records a versioned schema and rejects tampering or truncation', () => {
  const databaseBytes = Buffer.from('sqlite snapshot');
  const preferenceBytes = Buffer.from('{"themeId":"classic"}');
  const metadata = {
    format: 'daybyday-backup',
    formatVersion: 1,
    appVersion: '1.0.0',
    createdAt: '2026-10-20T12:00:00.000Z',
    database: {
      byteLength: databaseBytes.length,
      sha256: hash(databaseBytes),
      schemaVersion: 4,
      counts: {
        tasks: 1,
        events: 2,
        semesters: 1,
        courses: 3,
        courseExceptions: 1,
        importBatches: 0,
      },
    },
    preferences: {
      byteLength: preferenceBytes.length,
      sha256: hash(preferenceBytes),
    },
  };
  const header = encodeBackupHeader(metadata);
  const backupFile = Buffer.concat([header, databaseBytes, preferenceBytes]);
  const parsed = parseBackupHeader(header, backupFile.length);

  assert.equal(parsed.metadata.formatVersion, 1);
  assert.equal(parsed.metadata.database.schemaVersion, 4);
  assert.equal(parsed.databaseOffset, header.length);
  assert.equal(parsed.preferencesOffset, header.length + databaseBytes.length);
  assert.equal(
    hash(backupFile.subarray(parsed.databaseOffset, parsed.preferencesOffset)),
    metadata.database.sha256,
  );
  assert.equal(
    hash(backupFile.subarray(parsed.preferencesOffset)),
    metadata.preferences.sha256,
  );
  assert.throws(
    () => parseBackupHeader(header, header.length + databaseBytes.length),
    /长度与内容不匹配/,
  );

  const corrupted = Buffer.from(header);
  corrupted[corrupted.length - 1] ^= 0xff;
  assert.throws(
    () =>
      parseBackupHeader(
        corrupted,
        header.length + databaseBytes.length + preferenceBytes.length,
      ),
    /信息校验失败/,
  );
  assert.equal(getBackupFixedPrefixLength() < header.length, true);
  assert.equal(
    getBackupHeaderLength(header.subarray(0, getBackupFixedPrefixLength())),
    header.length,
  );
});

test('SQLite online backup captures WAL data and retains tasks, events, courses, and exceptions', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'daybyday-backup-test-'),
  );
  const sourcePath = path.join(directory, 'source.sqlite');
  const snapshotPath = path.join(directory, 'snapshot.sqlite');
  const raw = new BetterSqlite3(sourcePath);
  raw.pragma('journal_mode = WAL');
  raw.close();

  let source;
  let snapshot;
  try {
    source = new PlannerDatabase(sourcePath);
    const task = source.createTask({
      title: '备份保留待办',
      notes: '保留备注',
      scheduledDate: '2026-10-20',
    });
    const event = source.createEvent({
      title: '备份保留日程',
      eventDate: '2026-10-20',
      startTime: '10:00',
      endTime: '11:00',
      isAllDay: false,
      location: '图书馆',
      notes: '',
    });
    const semester = source.createSemester({
      semesterName: '备份测试学期',
      startDate: '2026-08-31',
      endDate: '2026-12-20',
      firstWeekMonday: '2026-08-31',
      isCurrent: true,
    });
    const course = source.createCourse({
      semesterId: semester.id,
      courseName: '备份保留课程',
      weekday: 1,
      startTime: '09:00',
      endTime: '10:30',
      classroom: 'A203',
      teacher: '老师',
      notes: '',
      firstWeek: 1,
      lastWeek: 16,
      recurrenceType: 'ALL',
      customWeeks: [],
    });
    source.saveCourseException({
      courseId: course.id,
      originalDate: '2026-09-07',
      isCancelled: true,
      replacementDate: '2026-09-07',
      startTime: '',
      endTime: '',
      classroom: '',
    });

    await source.backupTo(snapshotPath);
    const snapshotInfo = fs.statSync(snapshotPath);
    assert.ok(snapshotInfo.size > 0);
    snapshot = new PlannerDatabase(snapshotPath);

    assert.equal(snapshot.listTasks('2026-10-20')[0].id, task.id);
    assert.equal(snapshot.listEvents('2026-10-20')[0].id, event.id);
    assert.equal(snapshot.listCourses(semester.id)[0].id, course.id);
    assert.equal(
      snapshot.listCourseOccurrences('2026-09-07', '2026-09-07').length,
      0,
    );
    assert.deepEqual(snapshot.getIntegrityCheck(), {
      integrity: ['ok'],
      foreignKeyViolations: 0,
    });
    assert.deepEqual(snapshot.getBackupRecordCounts(), {
      tasks: 1,
      events: 1,
      semesters: 1,
      courses: 1,
      courseExceptions: 1,
      importBatches: 0,
    });
  } finally {
    snapshot?.close();
    source?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
