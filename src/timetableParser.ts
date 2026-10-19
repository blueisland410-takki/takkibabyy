import type { ClassPeriodTime, RecurrenceType } from './domain';

export type OcrLine = {
  text: string;
  confidence: number | null;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

type OcrWordRecord = {
  text: string;
  confidence: number;
  bbox: OcrLine['bbox'];
};

type OcrBlockRecord = {
  paragraphs: Array<{
    lines: Array<{
      text: string;
      confidence: number;
      bbox: OcrLine['bbox'];
      words: OcrWordRecord[];
    }>;
  }>;
};

export type ParsedWeekRule = {
  firstWeek: number | null;
  lastWeek: number | null;
  recurrenceType: RecurrenceType | null;
  customWeeks: number[];
  issue: string;
};

export type TimetableCourseDraft = {
  id: string;
  courseName: string;
  weekday: number | null;
  startTime: string;
  endTime: string;
  classroom: string;
  teacher: string;
  firstWeek: number | null;
  lastWeek: number | null;
  recurrenceType: RecurrenceType | null;
  customWeeks: number[];
  periodStart: number | null;
  periodEnd: number | null;
  confidence: number | null;
  sourceText: string;
  issues: string[];
  reviewed: boolean;
};

export type TimetableParseResult = {
  courses: TimetableCourseDraft[];
  weekdayColumnsFound: number;
  unassignedText: string[];
};

export function timeRangeForPeriods(
  startPeriod: number,
  endPeriod: number,
  periods: ClassPeriodTime[],
): { startTime: string; endTime: string } | null {
  if (startPeriod < 1 || endPeriod < startPeriod) return null;
  const byNumber = new Map(
    periods.map((period) => [period.periodNumber, period]),
  );
  const start = byNumber.get(startPeriod);
  const end = byNumber.get(endPeriod);
  if (!start || !end) return null;
  return { startTime: start.startTime, endTime: end.endTime };
}

export function ocrLinesFromBlocks(blocks: OcrBlockRecord[] | null): OcrLine[] {
  const words = (blocks ?? [])
    .flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) =>
          line.words.map((word) => ({
            text: word.text.trim(),
            confidence: Number.isFinite(word.confidence)
              ? word.confidence
              : null,
            bbox: word.bbox,
          })),
        ),
      ),
    )
    .filter((word) => word.text);
  if (!words.length) {
    return (blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines
          .filter((line) => line.text.trim())
          .map((line) => ({
            text: line.text.trim(),
            confidence: Number.isFinite(line.confidence)
              ? line.confidence
              : null,
            bbox: line.bbox,
          })),
      ),
    );
  }
  const typicalHeight =
    words.map((word) => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b)[
      Math.floor(words.length / 2)
    ] ?? 18;
  const verticalGroups: (typeof words)[] = [];
  for (const word of [...words].sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  )) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const group = verticalGroups.find((items) => {
      const centers = items
        .map((item) => (item.bbox.y0 + item.bbox.y1) / 2)
        .sort((a, b) => a - b);
      return (
        Math.abs(centers[Math.floor(centers.length / 2)] - center) <=
        Math.max(12, typicalHeight * 0.65)
      );
    });
    if (group) group.push(word);
    else verticalGroups.push([word]);
  }
  return verticalGroups.flatMap((group) => {
    const columns: (typeof words)[] = [];
    for (const word of [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      const column = columns.at(-1);
      const previous = column?.at(-1);
      if (
        previous &&
        word.bbox.x0 - previous.bbox.x1 <= Math.max(18, typicalHeight * 1.35)
      )
        column?.push(word);
      else columns.push([word]);
    }
    return columns.map((column) => ({
      text: column.map((word) => word.text).join(' '),
      confidence: column.every((word) => word.confidence !== null)
        ? column.reduce((total, word) => total + (word.confidence ?? 0), 0) /
          column.length
        : null,
      bbox: {
        x0: Math.min(...column.map((word) => word.bbox.x0)),
        y0: Math.min(...column.map((word) => word.bbox.y0)),
        x1: Math.max(...column.map((word) => word.bbox.x1)),
        y1: Math.max(...column.map((word) => word.bbox.y1)),
      },
    }));
  });
}

const DAY_WORDS: Array<[number, RegExp]> = [
  [1, /^(?:星期|周|礼拜)一$/i],
  [2, /^(?:星期|周|礼拜)二$/i],
  [3, /^(?:星期|周|礼拜)三$/i],
  [4, /^(?:星期|周|礼拜)四$/i],
  [5, /^(?:星期|周|礼拜)五$/i],
  [6, /^(?:星期|周|礼拜)六$/i],
  [7, /^(?:星期|周|礼拜)日$|^(?:星期|周|礼拜)天$/i],
];

function normalize(value: string): string {
  return value.replace(/[\s\u3000]/g, '').replace(/，/g, ',');
}

export function parseWeekRule(
  text: string,
  semesterWeeks: number,
): ParsedWeekRule {
  const source = normalize(text);
  const ranges = [
    ...source.matchAll(
      /(?:第)?(\d{1,2})\s*(?:-|－|–|—|~|～|至|到)\s*(\d{1,2})\s*周/g,
    ),
  ];
  const listMatch = source.match(
    /(?:第)?(\d{1,2}(?:[、,，和及]\d{1,2})+)\s*周/,
  );
  const isOdd = /单周|单数周|\(单\)|（单）/.test(source);
  const isEven = /双周|偶数周|\(双\)|（双）/.test(source);
  const qualifier = /周[（(]([^）)]+)[）)]/.exec(source)?.[1];
  const unclearQualifier = Boolean(
    qualifier && !/(?:单|双|奇|偶)/.test(qualifier),
  );
  if (isOdd && isEven) {
    return {
      firstWeek: null,
      lastWeek: null,
      recurrenceType: null,
      customWeeks: [],
      issue: '单双周标记互相矛盾，请确认。',
    };
  }

  let firstWeek: number | null = null;
  let lastWeek: number | null = null;
  let customWeeks: number[] = [];
  if (ranges.length === 1) {
    firstWeek = Number(ranges[0][1]);
    lastWeek = Number(ranges[0][2]);
  } else if (ranges.length > 1) {
    return {
      firstWeek: null,
      lastWeek: null,
      recurrenceType: null,
      customWeeks: [],
      issue: '发现多个周次范围，无法安全合并。',
    };
  }
  if (listMatch)
    customWeeks = [
      ...new Set(listMatch[1].split(/[、,，和及]/).map(Number)),
    ].sort((a, b) => a - b);
  if (firstWeek === null && customWeeks.length > 0) {
    firstWeek = customWeeks[0];
    lastWeek = customWeeks[customWeeks.length - 1];
  }
  if (firstWeek === null || lastWeek === null) {
    return {
      firstWeek: null,
      lastWeek: null,
      recurrenceType: null,
      customWeeks: [],
      issue: '未识别到明确周次，请手动填写。',
    };
  }
  if (
    firstWeek < 1 ||
    lastWeek < firstWeek ||
    lastWeek > semesterWeeks ||
    customWeeks.some(
      (week) => week < firstWeek! || week > lastWeek! || week > semesterWeeks,
    )
  ) {
    return {
      firstWeek,
      lastWeek,
      recurrenceType: null,
      customWeeks,
      issue: `周次超出当前学期范围（1–${semesterWeeks}周），请确认。`,
    };
  }
  if (isOdd || isEven) {
    return {
      firstWeek,
      lastWeek,
      recurrenceType: isOdd ? 'ODD' : 'EVEN',
      customWeeks: [],
      issue: '',
    };
  }
  if (unclearQualifier) {
    return {
      firstWeek,
      lastWeek,
      recurrenceType: null,
      customWeeks: [],
      issue: '周次附加标记未识别，请确认重复规则。',
    };
  }
  if (customWeeks.length > 0 && !ranges.length) {
    return {
      firstWeek,
      lastWeek,
      recurrenceType: 'CUSTOM',
      customWeeks,
      issue: '',
    };
  }
  return {
    firstWeek,
    lastWeek,
    recurrenceType: 'ALL',
    customWeeks: [],
    issue: '',
  };
}

function weekdayFromText(text: string): number | null {
  const source = normalize(text).replace(/[：:]/g, '');
  for (const [weekday, pattern] of DAY_WORDS)
    if (pattern.test(source)) return weekday;
  const english =
    /^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i.exec(
      source,
    );
  if (!english) return null;
  return (
    (
      { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 } as Record<
        string,
        number
      >
    )[english[1].slice(0, 3).toLowerCase()] ?? null
  );
}

function periodFromText(text: string): [number, number] | null {
  const match = normalize(text).match(
    /(?:第)?(\d{1,2})(?:-|－|–|—|~|～|至|到)?(\d{1,2})?节/,
  );
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2] ?? match[1]);
  return first > 0 && last >= first && last <= 24 ? [first, last] : null;
}

function timeFromText(text: string): [string, string] | null {
  const match = normalize(text).match(
    /([01]?\d|2[0-3]):([0-5]\d)(?:-|－|–|—|~|～|至|到)([01]?\d|2[0-3]):([0-5]\d)/,
  );
  if (!match) return null;
  const start = `${match[1].padStart(2, '0')}:${match[2]}`;
  const end = `${match[3].padStart(2, '0')}:${match[4]}`;
  return end > start ? [start, end] : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 16;
}

function extractCourseName(lines: string[]): string {
  const ignore =
    /^(?:第?\d{1,2}(?:[-~～至到]\d{1,2})?节|(?:星期|周)\S+|(?:任课教师|教师|老师|teacher|教室|地点|room|周次)\s*[:：]?)/i;
  for (const line of lines) {
    const cleaned = line
      .replace(/\([^)]*\d+\s*周[^)]*\)|（[^）]*\d+\s*周[^）]*）/g, '')
      .trim();
    if (cleaned && !ignore.test(cleaned) && !timeFromText(cleaned)) {
      return cleaned
        .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')
        .slice(0, 120);
    }
  }
  return '';
}

function labeledValue(text: string, labels: string): string {
  const match = text.match(
    new RegExp(`(?:${labels})\\s*[:：]\\s*([^\\n]+)`, 'i'),
  );
  return match?.[1]?.trim() ?? '';
}

export function parseTimetableLines(
  lines: OcrLine[],
  semesterWeeks: number,
): TimetableParseResult {
  const usable = lines.filter((line) => line.text.trim().length > 0);
  const anchors = usable.flatMap((line, index) => {
    const weekday = weekdayFromText(line.text);
    return weekday === null
      ? []
      : [
          {
            index,
            weekday,
            x: (line.bbox.x0 + line.bbox.x1) / 2,
            y: (line.bbox.y0 + line.bbox.y1) / 2,
          },
        ];
  });
  const yTolerance = Math.max(
    24,
    median(usable.map((line) => line.bbox.y1 - line.bbox.y0)) * 2.4,
  );
  const headerGroups: (typeof anchors)[] = [];
  for (const anchor of [...anchors].sort((a, b) => a.y - b.y)) {
    const group = headerGroups.find(
      (items) =>
        Math.abs(median(items.map((item) => item.y)) - anchor.y) <= yTolerance,
    );
    if (group) group.push(anchor);
    else headerGroups.push([anchor]);
  }
  const header =
    headerGroups.sort(
      (a, b) =>
        new Set(b.map((item) => item.weekday)).size -
        new Set(a.map((item) => item.weekday)).size,
    )[0] ?? [];
  const uniqueHeader = [
    ...new Map(header.map((item) => [item.weekday, item])).values(),
  ].sort((a, b) => a.x - b.x);
  const headerIndexes = new Set(uniqueHeader.map((item) => item.index));
  const headerCenterY = median(uniqueHeader.map((item) => item.y));
  const unassignedText: string[] = [];
  if (new Set(uniqueHeader.map((item) => item.weekday)).size < 3) {
    return {
      courses: [],
      weekdayColumnsFound: new Set(uniqueHeader.map((item) => item.weekday))
        .size,
      unassignedText: usable.map((line) => line.text),
    };
  }

  const leftBoundary = uniqueHeader[0].x;
  const sectionAnchors = usable.flatMap((line, index) => {
    if (
      headerIndexes.has(index) ||
      (line.bbox.x0 + line.bbox.x1) / 2 >= leftBoundary
    )
      return [];
    const match = normalize(line.text).match(/(?:第)?(\d{1,2})\s*节/);
    return match
      ? [
          {
            index,
            period: Number(match[1]),
            y: (line.bbox.y0 + line.bbox.y1) / 2,
          },
        ]
      : [];
  });

  const assigned = new Map<number, OcrLine[]>();
  for (let index = 0; index < usable.length; index += 1) {
    if (
      headerIndexes.has(index) ||
      sectionAnchors.some((anchor) => anchor.index === index)
    )
      continue;
    const line = usable[index];
    const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
    if (lineCenterY < headerCenterY + yTolerance) continue;
    const x = (line.bbox.x0 + line.bbox.x1) / 2;
    let weekday: number | null = null;
    for (let column = 0; column < uniqueHeader.length; column += 1) {
      const lower =
        column === 0
          ? -Infinity
          : (uniqueHeader[column - 1].x + uniqueHeader[column].x) / 2;
      const upper =
        column === uniqueHeader.length - 1
          ? Infinity
          : (uniqueHeader[column].x + uniqueHeader[column + 1].x) / 2;
      if (x >= lower && x <= upper) weekday = uniqueHeader[column].weekday;
    }
    if (weekday === null) {
      if (line.text.trim()) unassignedText.push(line.text);
      continue;
    }
    const bucket = assigned.get(weekday) ?? [];
    bucket.push(line);
    assigned.set(weekday, bucket);
  }

  const courses: TimetableCourseDraft[] = [];
  const splitGap = Math.max(
    25,
    median(usable.map((line) => line.bbox.y1 - line.bbox.y0)) * 2.2,
  );
  for (const [weekday, dayLines] of assigned) {
    const sorted = [...dayLines].sort(
      (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
    );
    const groups: OcrLine[][] = [];
    for (const line of sorted) {
      const previousGroup = groups.at(-1);
      const previous = previousGroup?.at(-1);
      if (previous && line.bbox.y0 - previous.bbox.y1 <= splitGap)
        previousGroup?.push(line);
      else groups.push([line]);
    }
    for (const group of groups) {
      const sourceText = group.map((line) => line.text.trim()).join('\n');
      if (!sourceText.trim()) continue;
      const time = timeFromText(sourceText);
      const period = periodFromText(sourceText);
      const centerY =
        (Math.min(...group.map((line) => line.bbox.y0)) +
          Math.max(...group.map((line) => line.bbox.y1))) /
        2;
      const nearestSection = [...sectionAnchors].sort(
        (a, b) => Math.abs(a.y - centerY) - Math.abs(b.y - centerY),
      )[0];
      const inferredPeriod =
        period ??
        (nearestSection &&
        Math.abs(nearestSection.y - centerY) <= splitGap * 1.8
          ? ([nearestSection.period, nearestSection.period] as [number, number])
          : null);
      const weekRule = parseWeekRule(sourceText, semesterWeeks);
      const courseName = extractCourseName(sourceText.split('\n'));
      const issues: string[] = [];
      if (!courseName) issues.push('课程名称待确认');
      if (!time)
        issues.push(
          inferredPeriod
            ? '节次已识别，需套用时间模板或填写钟点'
            : '时间/节次待确认',
        );
      if (weekRule.issue) issues.push(weekRule.issue);
      if (weekRule.recurrenceType === null) issues.push('周次规则待确认');
      const confidenceValues = group
        .map((line) => line.confidence)
        .filter((value): value is number => value !== null);
      const confidence = confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) /
          confidenceValues.length
        : null;
      if (confidence !== null && confidence < 65)
        issues.push('识别置信度偏低，请对照原图检查');
      courses.push({
        id: `ocr-${courses.length + 1}`,
        courseName,
        weekday,
        startTime: time?.[0] ?? '',
        endTime: time?.[1] ?? '',
        classroom:
          labeledValue(sourceText, '教室|地点|room') ||
          (sourceText.match(
            /(?:^|\n)\s*Room\s+([A-Z]{1,3}\s?\d{3,4})\b/i,
          )?.[1] ??
            '') ||
          (sourceText.match(
            /(?:^|\n)\s*([A-Z]{1,3}\s?\d{3,4})\s*(?:\n|$)/,
          )?.[1] ??
            ''),
        teacher: labeledValue(sourceText, '任课教师|教师|老师|teacher'),
        firstWeek: weekRule.firstWeek,
        lastWeek: weekRule.lastWeek,
        recurrenceType: weekRule.recurrenceType,
        customWeeks: weekRule.customWeeks,
        periodStart: inferredPeriod?.[0] ?? null,
        periodEnd: inferredPeriod?.[1] ?? null,
        confidence,
        sourceText,
        issues: [...new Set(issues)],
        reviewed: false,
      });
    }
  }
  return { courses, weekdayColumnsFound: uniqueHeader.length, unassignedText };
}
