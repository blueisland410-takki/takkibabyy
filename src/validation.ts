import type {
  EventInput,
  EventUpdate,
  MoveDirection,
  TaskInput,
  TaskUpdate,
} from './domain';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}格式无效。`);
  }
  return value as Record<string, unknown>;
}

export function assertDateKey(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('请选择有效日期。');
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('日期格式无效，请使用 YYYY-MM-DD。');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    year < 1 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error('这个日期不存在，请重新选择。');
  }
}

export function assertId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('记录编号无效，请刷新页面后重试。');
  }
}

function cleanText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效。`);
  const cleaned = value.trim();
  if (cleaned.length > maxLength)
    throw new Error(`${label}不能超过 ${maxLength} 个字符。`);
  return cleaned;
}

function cleanTitle(value: unknown): string {
  const title = cleanText(value, '标题', 160);
  if (!title) throw new Error('标题不能为空。');
  return title;
}

export function parseTaskInput(value: unknown): TaskInput {
  const input = record(value, '待办');
  const title = cleanTitle(input.title);
  const notes = cleanText(input.notes ?? '', '备注', 2000);
  assertDateKey(input.scheduledDate);
  return { title, notes, scheduledDate: input.scheduledDate };
}

export function parseTaskUpdate(value: unknown): TaskUpdate {
  const input = record(value, '待办');
  assertId(input.id);
  return { id: input.id, ...parseTaskInput(input) };
}

function cleanTime(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new Error(`${label}无效，请使用 24 小时制时间。`);
  }
  return value;
}

export function parseEventInput(value: unknown): EventInput {
  const input = record(value, '日程');
  const title = cleanTitle(input.title);
  assertDateKey(input.eventDate);
  if (typeof input.isAllDay !== 'boolean')
    throw new Error('全天事件选项无效。');

  let startTime = cleanTime(input.startTime, '开始时间');
  let endTime = cleanTime(input.endTime, '结束时间');
  if (input.isAllDay) {
    startTime = null;
    endTime = null;
  } else if (startTime && endTime && endTime <= startTime) {
    throw new Error('结束时间必须晚于开始时间；暂不支持跨午夜日程。');
  }

  return {
    title,
    eventDate: input.eventDate,
    startTime,
    endTime,
    isAllDay: input.isAllDay,
    location: cleanText(input.location ?? '', '地点', 200),
    notes: cleanText(input.notes ?? '', '备注', 2000),
  };
}

export function parseEventUpdate(value: unknown): EventUpdate {
  const input = record(value, '日程');
  assertId(input.id);
  return { id: input.id, ...parseEventInput(input) };
}

export function parseMoveDirection(value: unknown): MoveDirection {
  if (value !== 'up' && value !== 'down') throw new Error('排序操作无效。');
  return value;
}
