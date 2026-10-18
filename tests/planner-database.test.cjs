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
} = require('../.test-output/validation.js');

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
