import ExcelJS from 'exceljs';
// ical.js exposes an explicit CommonJS require condition for the Node-based
// test harness; the Electron renderer builds this same import as ESM with Vite.
// @ts-ignore TS1479: the test-only Node16 compiler uses the package require export.
import ICAL from 'ical.js';
import Papa from 'papaparse';
import type {
  ImportSourceType,
  NormalizedImportDraft,
  RecurrenceType,
  Semester,
} from './domain';
import { parseWeekRule } from './timetableParser';

export type ImportColumn =
  | 'courseName'
  | 'weekday'
  | 'startTime'
  | 'endTime'
  | 'classroom'
  | 'teacher'
  | 'firstWeek'
  | 'lastWeek'
  | 'weekRule'
  | 'customWeeks'
  | 'notes';

export type ColumnMapping = Partial<Record<ImportColumn, number | null>>;

export type ImportParseContext = {
  semester: Semester;
  sourceLabel: string;
  contentHash: string;
};

export type TabularParseOptions = {
  sourceType: 'XLSX' | 'CSV';
  sheetName?: string;
  headerRow: number;
  mapping?: ColumnMapping;
};

export type TabularParseResult = {
  sheetNames: string[];
  headers: string[];
  mapping: ColumnMapping;
  drafts: NormalizedImportDraft[];
  warnings: string[];
};

const aliases: Record<ImportColumn, string[]> = {
  courseName: [
    '课程名称',
    '课程名',
    '课程',
    'course name',
    'course',
    'subject',
  ],
  weekday: ['星期', '上课星期', '周几', 'weekday', 'week day', 'day'],
  startTime: ['开始时间', '上课时间', 'start time', 'start'],
  endTime: ['结束时间', '下课时间', 'end time', 'end'],
  classroom: ['教室', '地点', '教室地点', 'classroom', 'room', 'location'],
  teacher: ['教师', '老师', '任课教师', 'teacher', 'instructor'],
  firstWeek: ['开始周次', '起始周', '开始周', 'first week', 'start week'],
  lastWeek: ['结束周次', '截止周', '结束周', 'last week', 'end week'],
  weekRule: [
    '周次',
    '上课周次',
    '重复规则',
    'week rule',
    'weeks',
    'recurrence',
  ],
  customWeeks: ['指定周次', '自定义周次', 'custom weeks'],
  notes: ['备注', '说明', 'notes', 'remarks'],
};

export const courseTemplateHeaders = [
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
];

const localDateKey = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const dateKeyForTime = (time: ICAL.Time) =>
  localDateKey(time.year, time.month, time.day);

const timeText = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

function normalizedHeader(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s_\-：:（）()]/g, '');
}

export function inferColumnMapping(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {};
  for (const field of Object.keys(aliases) as ImportColumn[]) {
    const expected = aliases[field].map(normalizedHeader);
    const index = headers.findIndex((header) =>
      expected.includes(normalizedHeader(header)),
    );
    if (index >= 0) result[field] = index;
  }
  return result;
}

export function parseWeekday(value: string): number | null {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase();
  const dayNames = [
    /^(?:星期|周|礼拜)一$|^mon(?:day)?$/,
    /^(?:星期|周|礼拜)二$|^tue(?:sday)?$/,
    /^(?:星期|周|礼拜)三$|^wed(?:nesday)?$/,
    /^(?:星期|周|礼拜)四$|^thu(?:rsday)?$/,
    /^(?:星期|周|礼拜)五$|^fri(?:day)?$/,
    /^(?:星期|周|礼拜)六$|^sat(?:urday)?$/,
    /^(?:星期|周|礼拜)(?:日|天)$|^sun(?:day)?$/,
  ];
  const found = dayNames.findIndex((pattern) => pattern.test(normalized));
  if (found >= 0) return found + 1;
  const numeric = /^(?:星期|周)?([1-7])$/.exec(normalized);
  return numeric ? Number(numeric[1]) : null;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map(textValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const richText = (value as { richText?: Array<{ text?: string }> })
      .richText;
    if (Array.isArray(richText))
      return richText
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text.trim();
  }
  return '';
}

function parseTime(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return timeText(value.getHours(), value.getMinutes());
  }
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return timeText(Math.floor(minutes / 60), minutes % 60);
  }
  const text = textValue(value).normalize('NFKC');
  const match = /^(\d{1,2})[:：](\d{1,2})(?::\d{1,2})?$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? timeText(hour, minute) : null;
}

function parseWeekNumber(value: string): number | null {
  const match = /^\s*(\d{1,2})(?:\s*周)?\s*$/.exec(value.normalize('NFKC'));
  if (!match) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= 52 ? week : null;
}

function parseWeekList(value: string): number[] {
  const normalized = value.normalize('NFKC').replace(/第|周/g, '');
  const matches = [...normalized.matchAll(/\d{1,2}/g)].map((match) =>
    Number(match[0]),
  );
  return [...new Set(matches.filter((week) => week >= 1 && week <= 52))].sort(
    (a, b) => a - b,
  );
}

function parseRecurrence(value: string): RecurrenceType | null {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  if (/^(all|weekly|every week|每周)$/.test(normalized)) return 'ALL';
  if (/^(odd|odd week|单周|奇数周)$/.test(normalized)) return 'ODD';
  if (/^(even|even week|双周|偶数周)$/.test(normalized)) return 'EVEN';
  if (/^(custom|指定周次|自定义)$/.test(normalized)) return 'CUSTOM';
  return null;
}

function parseRuleColumns(row: Map<ImportColumn, string>, warnings: string[]) {
  const weekText = row.get('weekRule') ?? '';
  const firstWeek = parseWeekNumber(row.get('firstWeek') ?? '');
  const lastWeek = parseWeekNumber(row.get('lastWeek') ?? '');
  const customWeeks = parseWeekList(row.get('customWeeks') ?? '');
  let recurrenceType = parseRecurrence(weekText);
  let parsedFirst = firstWeek;
  let parsedLast = lastWeek;
  let parsedCustomWeeks = customWeeks;

  if (weekText && !recurrenceType) {
    const normalized = weekText.normalize('NFKC');
    const withWeekUnit = /周/.test(normalized) ? normalized : `${normalized}周`;
    const parsed = parseWeekRule(withWeekUnit, 52);
    parsedFirst ??= parsed.firstWeek;
    parsedLast ??= parsed.lastWeek;
    if (parsed.customWeeks.length) parsedCustomWeeks = parsed.customWeeks;
    recurrenceType = parsed.recurrenceType;
    if (parsed.issue) warnings.push(parsed.issue);
  }

  const recurrenceText = weekText.toLocaleLowerCase();
  if (!recurrenceType && /单周|奇数周|\bodd\b/.test(recurrenceText))
    recurrenceType = 'ODD';
  if (!recurrenceType && /双周|偶数周|\beven\b/.test(recurrenceText))
    recurrenceType = 'EVEN';
  if (!recurrenceType && parsedCustomWeeks.length) recurrenceType = 'CUSTOM';
  if (parsedCustomWeeks.length && !parsedFirst)
    parsedFirst = parsedCustomWeeks[0];
  if (parsedCustomWeeks.length && !parsedLast)
    parsedLast = parsedCustomWeeks.at(-1) ?? null;

  if (!parsedFirst || !parsedLast) warnings.push('周次范围待确认');
  if (!recurrenceType) warnings.push('重复规则待确认');
  if (recurrenceType === 'CUSTOM' && !parsedCustomWeeks.length) {
    warnings.push('指定周次待确认');
  }
  return {
    firstWeek: parsedFirst,
    lastWeek: parsedLast,
    recurrenceType,
    customWeeks: recurrenceType === 'CUSTOM' ? parsedCustomWeeks : [],
  };
}

function teachingWeek(semester: Semester, dateKey: string): number | null {
  const start = Date.parse(`${semester.firstWeekMonday}T00:00:00Z`);
  const date = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(date) || date < start)
    return null;
  return Math.floor((date - start) / (7 * 86_400_000)) + 1;
}

function makeDraft(
  context: ImportParseContext,
  sourceType: ImportSourceType,
  sourceId: string,
  rowNumber: number,
  fields: Map<ImportColumn, string>,
): NormalizedImportDraft {
  const warnings: string[] = [];
  const courseName = fields.get('courseName') ?? '';
  const weekday = parseWeekday(fields.get('weekday') ?? '');
  const startTime = parseTime(fields.get('startTime'));
  const endTime = parseTime(fields.get('endTime'));
  const rule = parseRuleColumns(fields, warnings);
  const semesterWeeks = Math.max(
    1,
    Math.ceil(
      (Date.parse(`${context.semester.endDate}T00:00:00Z`) -
        Date.parse(`${context.semester.firstWeekMonday}T00:00:00Z`)) /
        (7 * 86_400_000),
    ) + 1,
  );
  if (!courseName) warnings.push('课程名称待确认');
  if (!weekday) warnings.push('星期待确认');
  if (!startTime || !endTime) warnings.push('开始或结束时间待确认');
  if (startTime && endTime && endTime <= startTime)
    warnings.push('结束时间必须晚于开始时间');
  if (rule.firstWeek && rule.firstWeek > 52)
    warnings.push('周次超出模型支持范围');
  if (rule.lastWeek && rule.lastWeek > 52)
    warnings.push('周次超出模型支持范围');
  if (rule.firstWeek && rule.firstWeek > semesterWeeks)
    warnings.push(`开始周次超出本学期第 ${semesterWeeks} 周`);
  if (rule.lastWeek && rule.lastWeek > semesterWeeks)
    warnings.push(`结束周次超出本学期第 ${semesterWeeks} 周`);
  if (rule.customWeeks.some((week) => week > semesterWeeks))
    warnings.push(`指定周次超出本学期第 ${semesterWeeks} 周`);
  const rawText = [...fields.entries()]
    .map(([field, value]) => `${field}: ${value}`)
    .join(' | ');
  return {
    id: `${sourceType.toLocaleLowerCase()}-${rowNumber}-${sourceId.slice(-10)}`,
    kind: 'course',
    semesterId: context.semester.id,
    courseName,
    weekday,
    startTime,
    endTime,
    classroom: fields.get('classroom') ?? '',
    teacher: fields.get('teacher') ?? '',
    firstWeek: rule.firstWeek,
    lastWeek: rule.lastWeek,
    recurrenceType: rule.recurrenceType,
    customWeeks: rule.customWeeks,
    exceptions: [],
    eventDate: null,
    isAllDay: false,
    notes: fields.get('notes') ?? '',
    sourceType,
    sourceId,
    sourceLabel: context.sourceLabel,
    rawText,
    warnings: [...new Set(warnings)],
    confidence: null,
    included: true,
    reviewed: false,
  };
}

function parseRows(
  rows: string[][],
  context: ImportParseContext,
  options: TabularParseOptions,
  sheetNames: string[],
  preWarnings: string[] = [],
): TabularParseResult {
  const warnings = [...preWarnings];
  const headerIndex = Math.max(
    0,
    Math.min(rows.length - 1, options.headerRow - 1),
  );
  const headers = rows[headerIndex] ?? [];
  const inferred = inferColumnMapping(headers);
  const mapping = options.mapping ?? inferred;
  const selectedSheet = options.sheetName ?? 'CSV';
  const drafts: NormalizedImportDraft[] = [];

  if (mapping.courseName === undefined || mapping.courseName === null) {
    warnings.push('没有识别到课程名称列，请手动映射表头。');
  }
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (!values || values.every((cell) => !cell.trim())) continue;
    const fields = new Map<ImportColumn, string>();
    for (const field of Object.keys(aliases) as ImportColumn[]) {
      const columnIndex = mapping[field];
      if (columnIndex === undefined || columnIndex === null) continue;
      fields.set(field, values[columnIndex]?.trim() ?? '');
    }
    const sourceId = `${context.contentHash}:${selectedSheet}:row:${index + 1}`;
    const draft = makeDraft(
      context,
      options.sourceType,
      sourceId,
      index + 1,
      fields,
    );
    if (!draft.courseName && !draft.rawText.trim()) continue;
    if (draft.courseName || values.some((cell) => cell.trim()))
      drafts.push(draft);
  }

  if (!drafts.length)
    warnings.push('没有发现课程行。请检查所选工作表和表头行。');
  if (!mapping.weekRule && (!mapping.firstWeek || !mapping.lastWeek)) {
    warnings.push('未映射周次列；课程必须在校对页手动补全周次。');
  }
  return {
    sheetNames,
    headers,
    mapping,
    drafts,
    warnings: [...new Set(warnings)],
  };
}

export function parseCsvImport(
  content: string,
  context: ImportParseContext,
  options: Omit<TabularParseOptions, 'sourceType' | 'sheetName'>,
): TabularParseResult {
  if (content.length > 25 * 1024 * 1024) {
    throw new Error('CSV 文件超过 25 MB，请先拆分或缩小后再导入。');
  }
  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    header: false,
  });
  if (
    parsed.data.length > 10_000 ||
    parsed.data.some((row) => row.length > 200)
  ) {
    throw new Error('CSV 行数或列数过大；最多支持 10,000 行、200 列。');
  }
  const csvWarnings = parsed.errors.map(
    (error) => `CSV 第 ${(error.row ?? 0) + 1} 行：${error.message}`,
  );
  return parseRows(
    parsed.data,
    context,
    { ...options, sourceType: 'CSV' },
    [],
    csvWarnings,
  );
}

function cellText(cell: ExcelJS.Cell): string {
  if (
    cell.type === ExcelJS.ValueType.Formula ||
    cell.type === ExcelJS.ValueType.SharedString
  ) {
    return '';
  }
  return textValue(cell.isMerged ? cell.master.value : cell.value);
}

function excelRows(worksheet: ExcelJS.Worksheet): {
  rows: string[][];
  warnings: string[];
} {
  const rows: string[][] = [];
  const warnings: string[] = [];
  let foundMerged = false;
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const cell = row.getCell(column);
      if (cell.isMerged) foundMerged = true;
      if (cell.type === ExcelJS.ValueType.Formula) {
        warnings.push(
          `Excel 第 ${rowNumber} 行第 ${column} 列包含公式；公式未执行，单元格待人工核对。`,
        );
        values.push('');
        continue;
      }
      if (cell.value instanceof Date) {
        const serialDate = cell.value;
        const format = cell.numFmt ?? '';
        if (/h/i.test(format) && !/[yd]/i.test(format)) {
          values.push(
            timeText(serialDate.getUTCHours(), serialDate.getUTCMinutes()),
          );
        } else {
          values.push(
            localDateKey(
              serialDate.getUTCFullYear(),
              serialDate.getUTCMonth() + 1,
              serialDate.getUTCDate(),
            ),
          );
        }
        continue;
      }
      if (
        typeof cell.value === 'number' &&
        cell.value >= 0 &&
        cell.value < 1 &&
        /h/i.test(cell.numFmt ?? '')
      ) {
        values.push(parseTime(cell.value) ?? '');
        continue;
      }
      values.push(cellText(cell));
    }
    rows[rowNumber - 1] = values;
  });
  if (foundMerged)
    warnings.push(
      '工作表含合并单元格，已读取合并区域主单元格；请校对合并区域中的课程行。',
    );
  return { rows, warnings };
}

export async function parseXlsxImport(
  buffer: ArrayBuffer,
  context: ImportParseContext,
  options: Omit<TabularParseOptions, 'sourceType'>,
): Promise<TabularParseResult> {
  if (buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error('XLSX 文件超过 25 MB，请先拆分或缩小后再导入。');
  }
  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  } catch (failure) {
    throw new Error(
      `无法读取 XLSX 文件：${failure instanceof Error ? failure.message : '文件损坏或格式不支持'}`,
    );
  }
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  if (!sheetNames.length) throw new Error('Excel 文件没有可读取的工作表。');
  if (sheetNames.length > 30)
    throw new Error('Excel 工作表过多，最多支持 30 张工作表。');
  const worksheet = workbook.getWorksheet(options.sheetName ?? sheetNames[0]);
  if (!worksheet) throw new Error('找不到所选工作表，请重新选择。');
  if (
    worksheet.rowCount > 10_000 ||
    worksheet.columnCount > 200 ||
    worksheet.rowCount * worksheet.columnCount > 500_000
  ) {
    throw new Error(
      '所选工作表过大；最多支持 10,000 行、200 列和 500,000 个单元格。',
    );
  }
  const parsedRows = excelRows(worksheet);
  return parseRows(
    parsedRows.rows,
    context,
    { ...options, sourceType: 'XLSX', sheetName: worksheet.name },
    sheetNames,
    parsedRows.warnings,
  );
}

export function teachingWeekForDate(
  semester: Semester,
  dateKey: string,
): number | null {
  return teachingWeek(semester, dateKey);
}

function isWithinSemester(semester: Semester, dateKey: string): boolean {
  return dateKey >= semester.startDate && dateKey <= semester.endDate;
}

function eventTimezoneId(event: ICAL.Event): string | null {
  const parameter = event.component
    .getFirstProperty('dtstart')
    ?.getParameter('tzid');
  if (typeof parameter === 'string' && parameter) return parameter;
  return event.startDate.zone?.tzid ?? null;
}

function icsTimeZoneWarning(event: ICAL.Event, forCourse: boolean): string[] {
  if (event.startDate.isDate) return [];
  const zone = eventTimezoneId(event);
  if (!zone || zone === 'floating' || zone === 'local') return [];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === local) return [];
  return [
    forCourse
      ? `来源时区为 ${zone}，电脑本地时区为 ${local || '未知'}；课程保留来源墙上时间，请核对。`
      : `来源时区为 ${zone}，日程时间已换算为电脑本地时区 ${local || '未知'}，请核对。`,
  ];
}

function localDateFromIcsTime(time: ICAL.Time, event: ICAL.Event): Date {
  const zone = eventTimezoneId(event);
  if (!zone || zone === 'floating' || zone === 'local') return time.toJSDate();
  if (ICAL.TimezoneService.has(zone)) return time.toJSDate();

  // ICS files often refer to an IANA TZID without embedding VTIMEZONE. Use
  // the operating system's IANA table for the instant-to-local conversion.
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const targetWallTime = Date.UTC(
      time.year,
      time.month - 1,
      time.day,
      time.hour,
      time.minute,
      time.second,
    );
    let instant = targetWallTime;
    for (let pass = 0; pass < 4; pass += 1) {
      const parts = formatter.formatToParts(new Date(instant));
      const values = new Map(
        parts.map((part) => [part.type, Number(part.value)]),
      );
      const wallTimeAtInstant = Date.UTC(
        values.get('year') ?? time.year,
        (values.get('month') ?? time.month) - 1,
        values.get('day') ?? time.day,
        values.get('hour') ?? time.hour,
        values.get('minute') ?? time.minute,
        values.get('second') ?? time.second,
      );
      const next = targetWallTime - (wallTimeAtInstant - instant);
      if (next === instant) break;
      instant = next;
    }
    return new Date(instant);
  } catch {
    // Keep the displayed wall time instead of guessing an offset for an
    // unsupported timezone. The preview includes the source TZID warning.
    return new Date(
      time.year,
      time.month - 1,
      time.day,
      time.hour,
      time.minute,
      time.second,
    );
  }
}

function expandOccurrences(
  event: ICAL.Event,
  semester: Semester,
): Array<{
  recurrenceId: ICAL.Time;
  start: ICAL.Time;
  end: ICAL.Time;
  item: ICAL.Event;
  canceled: boolean;
}> {
  const results: Array<{
    recurrenceId: ICAL.Time;
    start: ICAL.Time;
    end: ICAL.Time;
    item: ICAL.Event;
    canceled: boolean;
  }> = [];
  const iterator = event.iterator();
  let occurrence: ICAL.Time | null;
  let guard = 0;
  while ((occurrence = iterator.next()) && guard < 10_000) {
    guard += 1;
    const baseDate = dateKeyForTime(occurrence);
    if (baseDate > semester.endDate) break;
    if (baseDate < semester.firstWeekMonday) continue;
    const details = event.getOccurrenceDetails(occurrence);
    const item = details.item;
    const status = String(
      item.component.getFirstPropertyValue('status') ?? '',
    ).toLocaleUpperCase();
    results.push({
      recurrenceId: occurrence,
      start: details.startDate,
      end: details.endDate,
      item,
      canceled: status === 'CANCELLED',
    });
  }
  if (guard >= 10_000) {
    throw new Error(
      '重复事件展开超过安全上限 10,000 次；请缩小学期日期范围或检查 RRULE。',
    );
  }
  return results;
}

function exceptionDraft(occurrence: {
  recurrenceId: ICAL.Time;
  start: ICAL.Time;
  end: ICAL.Time;
  item: ICAL.Event;
  canceled: boolean;
}): NormalizedImportDraft['exceptions'][number] {
  const originalDate = dateKeyForTime(occurrence.recurrenceId);
  const replacementDate = dateKeyForTime(occurrence.start);
  const startTime = occurrence.start.isDate
    ? null
    : timeText(occurrence.start.hour, occurrence.start.minute);
  const endTime = occurrence.end.isDate
    ? null
    : timeText(occurrence.end.hour, occurrence.end.minute);
  return {
    originalDate,
    isCancelled: occurrence.canceled,
    replacementDate,
    startTime: startTime ?? '',
    endTime: endTime ?? '',
    classroom: occurrence.item.location ?? '',
  };
}

function draftFromIcsEvent(
  event: ICAL.Event,
  context: ImportParseContext,
): NormalizedImportDraft {
  const start = event.startDate;
  const end = event.endDate;
  const allDay = start.isDate;
  const startDate = allDay ? null : localDateFromIcsTime(start, event);
  const endDate = allDay ? null : localDateFromIcsTime(end, event);
  const eventDate = allDay
    ? dateKeyForTime(start)
    : localDateKey(
        startDate!.getFullYear(),
        startDate!.getMonth() + 1,
        startDate!.getDate(),
      );
  const sourceId = event.uid || `${event.summary}-${eventDate}`;
  const warnings = icsTimeZoneWarning(event, false);
  if (
    !allDay &&
    startDate &&
    endDate &&
    localDateKey(
      endDate.getFullYear(),
      endDate.getMonth() + 1,
      endDate.getDate(),
    ) !== eventDate
  ) {
    warnings.push(
      '该 ICS 事件跨越本地午夜；当前日程模型不保存跨日结束日期，请调整或拆分。',
    );
  }
  if (!event.uid)
    warnings.push('ICS 事件缺少 UID，重复检测只能使用内容与日期。');
  return {
    id: `ics-${sourceId}-${eventDate}`,
    kind: 'event',
    semesterId: context.semester.id,
    courseName: event.summary || '',
    weekday: null,
    startTime: allDay
      ? null
      : timeText(startDate!.getHours(), startDate!.getMinutes()),
    endTime: allDay
      ? null
      : timeText(endDate!.getHours(), endDate!.getMinutes()),
    classroom: event.location || '',
    teacher: '',
    firstWeek: null,
    lastWeek: null,
    recurrenceType: null,
    customWeeks: [],
    exceptions: [],
    eventDate,
    isAllDay: allDay,
    notes: event.description || '',
    sourceType: 'ICS',
    sourceId: `${sourceId}:${eventDate}`,
    sourceLabel: context.sourceLabel,
    rawText: event.component.toString(),
    warnings,
    confidence: null,
    included: true,
    reviewed: false,
  };
}

function recurrenceForWeeks(weeks: number[]): {
  firstWeek: number;
  lastWeek: number;
  recurrenceType: RecurrenceType;
  customWeeks: number[];
} {
  const unique = [...new Set(weeks)].sort((a, b) => a - b);
  const firstWeek = unique[0];
  const lastWeek = unique.at(-1) ?? firstWeek;
  const all = Array.from(
    { length: lastWeek - firstWeek + 1 },
    (_, index) => firstWeek + index,
  );
  if (JSON.stringify(unique) === JSON.stringify(all)) {
    return { firstWeek, lastWeek, recurrenceType: 'ALL', customWeeks: [] };
  }
  const odd = all.filter((week) => week % 2 === 1);
  const even = all.filter((week) => week % 2 === 0);
  if (JSON.stringify(unique) === JSON.stringify(odd)) {
    return { firstWeek, lastWeek, recurrenceType: 'ODD', customWeeks: [] };
  }
  if (JSON.stringify(unique) === JSON.stringify(even)) {
    return { firstWeek, lastWeek, recurrenceType: 'EVEN', customWeeks: [] };
  }
  return { firstWeek, lastWeek, recurrenceType: 'CUSTOM', customWeeks: unique };
}

export function parseIcsImport(
  text: string,
  context: ImportParseContext,
): NormalizedImportDraft[] {
  if (!text.trim()) throw new Error('ICS 文件为空。');
  if (text.length > 25 * 1024 * 1024) throw new Error('ICS 文件超过 25 MB。');
  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch (failure) {
    throw new Error(
      `无法解析 ICS 文件：${failure instanceof Error ? failure.message : '格式错误'}`,
    );
  }
  if (calendar.name !== 'vcalendar')
    throw new Error('文件不是有效的 iCalendar 日历（缺少 VCALENDAR）。');

  const timezoneComponents = calendar.getAllSubcomponents('vtimezone');
  const priorZones = new Map<string, ICAL.Timezone | undefined>();
  for (const component of timezoneComponents) {
    const zone = new ICAL.Timezone(component);
    priorZones.set(
      zone.tzid,
      ICAL.TimezoneService.has(zone.tzid)
        ? ICAL.TimezoneService.get(zone.tzid)
        : undefined,
    );
    ICAL.TimezoneService.register(zone);
  }

  try {
    const components = calendar.getAllSubcomponents('vevent');
    if (components.length > 500)
      throw new Error('ICS 文件含超过 500 个原始事件，请拆分后导入。');
    const events = components.map((component) => new ICAL.Event(component));
    const masters = events.filter((event) => !event.isRecurrenceException());
    const exceptionUids = new Set(
      events
        .filter((event) => event.isRecurrenceException())
        .map((event) => event.uid),
    );
    const drafts: NormalizedImportDraft[] = [];

    for (const event of masters) {
      const title = event.summary?.trim() ?? '';
      if (!title || !event.startDate) continue;
      const startKey = dateKeyForTime(event.startDate);
      if (!event.isRecurring()) {
        if (isWithinSemester(context.semester, startKey))
          drafts.push(draftFromIcsEvent(event, context));
        continue;
      }

      const recurrenceProperties = event.component.getAllProperties('rrule');
      const weeklyRulesOnly =
        recurrenceProperties.length > 0 &&
        recurrenceProperties.every((property) => {
          const rule = property.getFirstValue();
          return (
            typeof rule === 'object' &&
            rule !== null &&
            'freq' in rule &&
            rule.freq === 'WEEKLY'
          );
        });
      if (!weeklyRulesOnly || event.startDate.isDate) {
        for (const occurrence of expandOccurrences(event, context.semester)) {
          if (
            !occurrence.canceled &&
            isWithinSemester(context.semester, dateKeyForTime(occurrence.start))
          ) {
            drafts.push(draftFromIcsEvent(occurrence.item, context));
          }
        }
        continue;
      }

      const occurrences = expandOccurrences(event, context.semester);
      const groups = new Map<string, typeof occurrences>();
      for (const occurrence of occurrences) {
        if (occurrence.canceled) continue;
        const weekDay =
          occurrence.recurrenceId.dayOfWeek() === 1
            ? 7
            : occurrence.recurrenceId.dayOfWeek() - 1;
        const key = [
          weekDay,
          timeText(event.startDate.hour, event.startDate.minute),
          timeText(event.endDate.hour, event.endDate.minute),
          event.location,
        ].join('|');
        const group = groups.get(key) ?? [];
        group.push(occurrence);
        groups.set(key, group);
      }
      if (!groups.size) continue;

      let groupIndex = 0;
      for (const [key, meetings] of groups) {
        groupIndex += 1;
        const [weekdayText, startTime, endTime, classroom] = key.split('|');
        const weekdayNumber = Number(weekdayText);
        const exdates = event.component
          .getAllProperties('exdate')
          .flatMap((property) => property.getValues())
          .filter((time): time is ICAL.Time => time instanceof ICAL.Time)
          .filter(
            (time) =>
              isWithinSemester(context.semester, dateKeyForTime(time)) &&
              (time.dayOfWeek() === 1 ? 7 : time.dayOfWeek() - 1) ===
                weekdayNumber,
          );
        const exceptionEvents = events
          .filter(
            (exception) =>
              exception.isRecurrenceException() && exception.uid === event.uid,
          )
          .filter((exception) => {
            const recurrenceId = exception.recurrenceId;
            return (
              isWithinSemester(
                context.semester,
                dateKeyForTime(recurrenceId),
              ) &&
              (recurrenceId.dayOfWeek() === 1
                ? 7
                : recurrenceId.dayOfWeek() - 1) === weekdayNumber
            );
          });
        const allDates = [
          ...meetings.map((meeting) => dateKeyForTime(meeting.recurrenceId)),
          ...exdates.map(dateKeyForTime),
          ...exceptionEvents.map((exception) =>
            dateKeyForTime(exception.recurrenceId),
          ),
        ];
        const weeks = allDates
          .map((date) => teachingWeek(context.semester, date))
          .filter((week): week is number => week !== null);
        if (!weeks.length) continue;
        const ruleValue = event.component.getFirstPropertyValue('rrule');
        const ruleInterval =
          typeof ruleValue === 'object' &&
          ruleValue !== null &&
          'interval' in ruleValue
            ? Number(ruleValue.interval)
            : 0;
        let recurrence = recurrenceForWeeks(weeks);
        if (ruleInterval === 1) {
          const firstWeek = Math.min(...weeks);
          const lastWeek = Math.max(...weeks);
          recurrence = {
            firstWeek,
            lastWeek,
            recurrenceType: 'ALL',
            customWeeks: [],
          };
        }
        const warnings = [...icsTimeZoneWarning(event, true)];
        if (exceptionUids.has(event.uid))
          warnings.push('包含单次调整；会随课程系列导入并保留例外。');
        const sourceId = `${event.uid || title}:weekday:${weekdayText}:${groupIndex}`;
        const firstMeeting = meetings[0];
        const draft: NormalizedImportDraft = {
          id: `ics-course-${sourceId}`,
          kind: 'course',
          semesterId: context.semester.id,
          courseName: title,
          weekday: Number(weekdayText),
          startTime,
          endTime,
          classroom,
          teacher: '',
          ...recurrence,
          exceptions: [],
          eventDate: null,
          isAllDay: false,
          notes: firstMeeting.item.description || '',
          sourceType: 'ICS',
          sourceId,
          sourceLabel: context.sourceLabel,
          rawText: firstMeeting.item.component.toString(),
          warnings,
          confidence: null,
          included: true,
          reviewed: false,
        };
        drafts.push(draft);

        for (const occurrence of meetings) {
          const changed =
            occurrence.item.uid === event.uid &&
            occurrence.item.component.hasProperty('recurrence-id');
          if (!changed) continue;
          const originalDate = dateKeyForTime(occurrence.recurrenceId);
          const moved =
            dateKeyForTime(occurrence.start) !== originalDate ||
            occurrence.start.hour !== event.startDate.hour ||
            occurrence.start.minute !== event.startDate.minute ||
            occurrence.item.location !== event.location;
          if (!moved) continue;
          draft.exceptions.push(exceptionDraft(occurrence));
        }
        for (const exception of exceptionEvents) {
          const isCancelled =
            String(
              exception.component.getFirstPropertyValue('status') ?? '',
            ).toLocaleUpperCase() === 'CANCELLED';
          if (
            isCancelled &&
            !draft.exceptions.some(
              (item) =>
                item.originalDate === dateKeyForTime(exception.recurrenceId),
            )
          ) {
            const originalDate = dateKeyForTime(exception.recurrenceId);
            draft.exceptions.push({
              originalDate,
              isCancelled: true,
              replacementDate: originalDate,
              startTime: '',
              endTime: '',
              classroom: '',
            });
          }
        }
        for (const excluded of exdates) {
          const originalDate = dateKeyForTime(excluded);
          if (
            !draft.exceptions.some((item) => item.originalDate === originalDate)
          ) {
            draft.exceptions.push({
              originalDate,
              isCancelled: true,
              replacementDate: originalDate,
              startTime: '',
              endTime: '',
              classroom: '',
            });
          }
        }
      }
    }

    if (!drafts.length)
      throw new Error('当前学期范围内没有可导入的 ICS 事件或课程。');
    if (drafts.length > 300)
      throw new Error(
        'ICS 在当前学期展开后超过 300 项，请缩小学期范围或分批导入。',
      );
    return drafts;
  } finally {
    for (const [id, previous] of priorZones) {
      if (previous) ICAL.TimezoneService.register(previous, id);
      else ICAL.TimezoneService.remove(id);
    }
  }
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function createCourseTemplate(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('课程表');
  sheet.addRow(courseTemplateHeaders);
  sheet.addRow(Array.from({ length: courseTemplateHeaders.length }, () => ''));
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [
    { width: 20 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 30 },
  ];
  const bytes = await workbook.xlsx.writeBuffer();
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function createCsvTemplate(): string {
  return Papa.unparse([courseTemplateHeaders]);
}
