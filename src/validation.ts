import type {
  ClassPeriodTime,
  CourseExceptionInput,
  CourseInput,
  FontSizeScale,
  ThemeId,
  ImportBatchDecision,
  ImportBatchPayload,
  ImportExceptionDraft,
  ImportSourceType,
  RecurrenceType,
  SemesterInput,
  SeriesExceptionPolicy,
  EventInput,
  EventUpdate,
  MoveDirection,
  TaskInput,
  TaskUpdate,
} from './domain';
import { getWeekday } from './courseSchedule';
import { isThemeId } from './theme';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FONT_SIZE_SCALES: FontSizeScale[] = [1, 1.15, 1.25, 1.5];

export function parseFontSizeScale(value: unknown): FontSizeScale {
  if (
    typeof value !== 'number' ||
    !FONT_SIZE_SCALES.includes(value as FontSizeScale)
  ) {
    throw new Error('字体大小选项无效，请从 100%、115%、125% 或 150% 中选择。');
  }
  return value as FontSizeScale;
}

export function parseThemeId(value: unknown): ThemeId {
  if (isThemeId(value)) return value;
  throw new Error('主题选项无效。');
}

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

export function parseSemesterInput(value: unknown): SemesterInput {
  const input = record(value, '学期');
  const semesterName = cleanText(input.semesterName, '学期名称', 120);
  if (!semesterName) throw new Error('学期名称不能为空。');
  assertDateKey(input.startDate);
  assertDateKey(input.endDate);
  assertDateKey(input.firstWeekMonday);
  if (input.endDate < input.startDate) {
    throw new Error('学期结束日期不能早于开始日期。');
  }
  if (getWeekday(input.firstWeekMonday) !== 1) {
    throw new Error('第一教学周必须从星期一开始。');
  }
  const firstDay = new Date(`${input.firstWeekMonday}T00:00:00Z`);
  const startDay = new Date(`${input.startDate}T00:00:00Z`);
  const dayOffset = (startDay.getTime() - firstDay.getTime()) / 86_400_000;
  if (dayOffset < 0 || dayOffset > 6 || input.firstWeekMonday > input.endDate) {
    throw new Error('第一教学周星期一须与学期开始日期处于同一周。');
  }
  if (typeof input.isCurrent !== 'boolean') {
    throw new Error('当前学期选项无效。');
  }
  return {
    semesterName,
    startDate: input.startDate,
    endDate: input.endDate,
    firstWeekMonday: input.firstWeekMonday,
    isCurrent: input.isCurrent,
  };
}

const RECURRENCE_TYPES: RecurrenceType[] = ['ALL', 'ODD', 'EVEN', 'CUSTOM'];

export function parseCourseInput(value: unknown): CourseInput {
  const input = record(value, '课程');
  assertId(input.semesterId);
  const courseName = cleanText(input.courseName, '课程名称', 120);
  if (!courseName) throw new Error('课程名称不能为空。');
  if (
    !Number.isInteger(input.weekday) ||
    (input.weekday as number) < 1 ||
    (input.weekday as number) > 7
  ) {
    throw new Error('请选择星期一至星期日。');
  }
  const startTime = cleanTime(input.startTime, '开始时间');
  const endTime = cleanTime(input.endTime, '结束时间');
  if (!startTime || !endTime) throw new Error('课程必须填写开始和结束时间。');
  if (endTime <= startTime) throw new Error('课程结束时间必须晚于开始时间。');
  const firstWeek = input.firstWeek;
  const lastWeek = input.lastWeek;
  if (
    !Number.isInteger(firstWeek) ||
    !Number.isInteger(lastWeek) ||
    (firstWeek as number) < 1 ||
    (lastWeek as number) > 52 ||
    (firstWeek as number) > (lastWeek as number)
  ) {
    throw new Error('课程周次范围无效，请填写 1 至 52 周。');
  }
  if (
    typeof input.recurrenceType !== 'string' ||
    !RECURRENCE_TYPES.includes(input.recurrenceType as RecurrenceType)
  ) {
    throw new Error('课程重复方式无效。');
  }
  const recurrenceType = input.recurrenceType as RecurrenceType;
  if (!Array.isArray(input.customWeeks) || input.customWeeks.length > 52) {
    throw new Error('指定周次格式无效。');
  }
  const customWeeks = [...new Set(input.customWeeks)];
  if (
    customWeeks.some(
      (week) =>
        !Number.isInteger(week) ||
        (week as number) < (firstWeek as number) ||
        (week as number) > (lastWeek as number),
    )
  ) {
    throw new Error('指定周次必须位于课程起止周次范围内。');
  }
  if (recurrenceType === 'CUSTOM' && customWeeks.length === 0) {
    throw new Error('指定周次课程至少选择一周。');
  }
  return {
    semesterId: input.semesterId,
    courseName,
    weekday: input.weekday as number,
    startTime,
    endTime,
    classroom: cleanText(input.classroom ?? '', '教室', 120),
    teacher: cleanText(input.teacher ?? '', '教师', 120),
    notes: cleanText(input.notes ?? '', '备注', 2000),
    firstWeek: firstWeek as number,
    lastWeek: lastWeek as number,
    recurrenceType,
    customWeeks: recurrenceType === 'CUSTOM' ? (customWeeks as number[]) : [],
  };
}

export function parseCourseImportInputs(
  semesterIdValue: unknown,
  value: unknown,
): CourseInput[] {
  assertId(semesterIdValue);
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) {
    throw new Error('请提供 1 至 300 门已校对的课程。');
  }
  return value.map((item) => {
    const course = parseCourseInput(item);
    if (course.semesterId !== semesterIdValue) {
      throw new Error('导入课程的目标学期不一致，请重新检查。');
    }
    return course;
  });
}

export function parseCourseImportDecisions(
  value: unknown,
  courseCount: number,
  duplicateIndexes: Set<number>,
): Array<{ courseIndex: number; action: 'skip' | 'keep' }> {
  if (!Array.isArray(value) || value.length > courseCount) {
    throw new Error('重复课程处理列表无效。');
  }
  const seen = new Set<number>();
  return value.map((raw) => {
    const item = record(raw, '重复课程处理');
    const courseIndex = item.courseIndex;
    if (
      !Number.isInteger(courseIndex) ||
      (courseIndex as number) < 0 ||
      (courseIndex as number) >= courseCount ||
      !duplicateIndexes.has(courseIndex as number) ||
      seen.has(courseIndex as number)
    ) {
      throw new Error('重复课程处理编号无效，请重新检查。');
    }
    if (item.action !== 'skip' && item.action !== 'keep') {
      throw new Error('请选择跳过或保留重复课程。');
    }
    seen.add(courseIndex as number);
    return { courseIndex: courseIndex as number, action: item.action };
  });
}

export function parseImportBatchPayload(value: unknown): ImportBatchPayload {
  const payload = record(value, '导入批次');
  const options = record(payload.options, '导入来源');
  assertId(options.semesterId);
  const sourceTypes: ImportSourceType[] = ['IMAGE', 'ICS', 'XLSX', 'CSV'];
  if (
    typeof options.sourceType !== 'string' ||
    !sourceTypes.includes(options.sourceType as ImportSourceType)
  ) {
    throw new Error('导入文件格式无效。');
  }
  const sourceLabel = cleanText(options.sourceLabel, '来源文件名', 260);
  if (!sourceLabel) throw new Error('来源文件名不能为空。');
  if (
    typeof options.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(options.contentHash)
  ) {
    throw new Error('导入文件指纹无效，请重新选择文件。');
  }
  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 300
  ) {
    throw new Error('请提供 1 至 300 项已校对的导入内容。');
  }
  const items = payload.items.map((rawItem) => {
    const item = record(rawItem, '导入项目');
    if (
      typeof item.sourceId !== 'string' ||
      !item.sourceId.trim() ||
      item.sourceId.length > 500
    ) {
      throw new Error('来源记录标识无效。');
    }
    if (item.kind === 'course') {
      const input = parseCourseInput(item.input);
      if (input.semesterId !== options.semesterId)
        throw new Error('导入课程的目标学期不一致。');
      if (!Array.isArray(item.exceptions) || item.exceptions.length > 100) {
        throw new Error('课程单次调课列表无效。');
      }
      const exceptions: ImportExceptionDraft[] = item.exceptions.map(
        (rawException) => {
          const exception = parseCourseExceptionInput({
            ...record(rawException, '单次课程调整'),
            courseId: '00000000-0000-4000-8000-000000000000',
          });
          return {
            originalDate: exception.originalDate,
            isCancelled: exception.isCancelled,
            replacementDate: exception.replacementDate,
            startTime: exception.startTime,
            endTime: exception.endTime,
            classroom: exception.classroom,
          };
        },
      );
      return {
        kind: 'course' as const,
        sourceId: item.sourceId.trim(),
        input,
        exceptions,
      };
    }
    if (item.kind === 'event') {
      return {
        kind: 'event' as const,
        sourceId: item.sourceId.trim(),
        input: parseEventInput(item.input),
      };
    }
    throw new Error('导入项目类型无效。');
  });
  return {
    options: {
      semesterId: options.semesterId,
      sourceType: options.sourceType as ImportSourceType,
      sourceLabel,
      contentHash: options.contentHash.toLocaleLowerCase(),
    },
    items,
  };
}

export function parseImportBatchDecisions(
  value: unknown,
  itemCount: number,
  duplicateIndexes: Set<number>,
): ImportBatchDecision[] {
  if (!Array.isArray(value) || value.length > itemCount) {
    throw new Error('导入重复项处理列表无效。');
  }
  const seen = new Set<number>();
  return value.map((raw) => {
    const item = record(raw, '导入重复项处理');
    if (
      !Number.isInteger(item.itemIndex) ||
      (item.itemIndex as number) < 0 ||
      (item.itemIndex as number) >= itemCount ||
      !duplicateIndexes.has(item.itemIndex as number) ||
      seen.has(item.itemIndex as number)
    ) {
      throw new Error('导入重复项编号无效，请重新检查。');
    }
    if (item.action !== 'skip' && item.action !== 'keep') {
      throw new Error('请选择跳过或保留重复内容。');
    }
    seen.add(item.itemIndex as number);
    return { itemIndex: item.itemIndex as number, action: item.action };
  });
}

export function parseClassPeriodTimes(value: unknown): ClassPeriodTime[] {
  if (!Array.isArray(value) || value.length > 24) {
    throw new Error('节次模板最多支持 24 节。');
  }
  const periods = value
    .map((raw) => {
      const item = record(raw, '节次时间');
      if (
        !Number.isInteger(item.periodNumber) ||
        (item.periodNumber as number) < 1 ||
        (item.periodNumber as number) > 24
      ) {
        throw new Error('节次编号必须为 1 至 24。');
      }
      const startTime = cleanTime(item.startTime, '开始时间');
      const endTime = cleanTime(item.endTime, '结束时间');
      if (!startTime || !endTime || endTime <= startTime) {
        throw new Error('每节课都需要有效时间，且结束时间晚于开始时间。');
      }
      return { periodNumber: item.periodNumber as number, startTime, endTime };
    })
    .sort((a, b) => a.periodNumber - b.periodNumber);
  if (periods.some((period, index) => period.periodNumber !== index + 1)) {
    throw new Error('节次必须从第 1 节连续设置，不能跳过中间节次。');
  }
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index].startTime < periods[index - 1].endTime) {
      throw new Error('节次时间不能重叠或倒序。');
    }
  }
  return periods;
}

export function parseCourseExceptionInput(
  value: unknown,
): CourseExceptionInput {
  const input = record(value, '单次课程调整');
  assertId(input.courseId);
  assertDateKey(input.originalDate);
  if (typeof input.isCancelled !== 'boolean') {
    throw new Error('停课状态无效。');
  }
  if (input.isCancelled) {
    return {
      courseId: input.courseId,
      originalDate: input.originalDate,
      isCancelled: true,
      replacementDate: input.originalDate,
      startTime: '',
      endTime: '',
      classroom: '',
    };
  }
  assertDateKey(input.replacementDate);
  const startTime = cleanTime(input.startTime, '开始时间');
  const endTime = cleanTime(input.endTime, '结束时间');
  if (!startTime || !endTime || endTime <= startTime) {
    throw new Error('调整后的课程时间必须有效，且结束时间晚于开始时间。');
  }
  return {
    courseId: input.courseId,
    originalDate: input.originalDate,
    isCancelled: false,
    replacementDate: input.replacementDate,
    startTime,
    endTime,
    classroom: cleanText(input.classroom ?? '', '教室', 120),
  };
}

export function parseSeriesExceptionPolicy(
  value: unknown,
): SeriesExceptionPolicy {
  if (value !== 'preserve-valid' && value !== 'clear-all') {
    throw new Error('请明确选择如何处理已有的单次课程调整。');
  }
  return value;
}
