import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Event,
  EventInput,
  Task,
  TaskInput,
  MoveDirection,
} from './domain';

const SCHEMA_VERSION = 1;

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

export class PlannerDatabase {
  private readonly database: Database.Database;

  constructor(filePath: string) {
    const database = new Database(filePath);
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

  private migrate() {
    const version = Number(
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
          this.database.pragma(`user_version = ${SCHEMA_VERSION}`);
        })
        .immediate();
    }
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
