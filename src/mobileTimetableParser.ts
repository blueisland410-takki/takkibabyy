import type { OcrLine } from './timetableParser';

export type MobileTimetableImage = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export type MobileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MobileWeekdayColumn = {
  weekday: number;
  left: number;
  right: number;
  center: number;
};

export type MobilePeriodRow = {
  periodNumber: number;
  top: number;
  bottom: number;
  center: number;
};

export type MobileCourseBlock = {
  id: string;
  bounds: MobileRect;
  weekday: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  sourceText: string;
  color: string;
  warnings: string[];
};

export type MobileTimetableAnalysis = {
  imageWidth: number;
  imageHeight: number;
  teachingWeek: number | null;
  weekdayColumns: MobileWeekdayColumn[];
  periodRows: MobilePeriodRow[];
  courseBlocks: MobileCourseBlock[];
  warnings: string[];
};

type Anchor = {
  value: number;
  x: number;
  y: number;
  height: number;
  index: number;
};
type Component = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  red: number;
  green: number;
  blue: number;
};

const median = (values: number[], fallback: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? fallback;
};

const normalized = (text: string) =>
  text.replace(/[\s\u3000]/g, '').replace(/[：:]/g, '');

function weekdayNumber(text: string): number | null {
  const match = normalized(text).match(
    /(?:星期|礼拜|周)([一二三四五六日天1-7])/,
  );
  if (!match) return null;
  const value = match[1];
  return (
    (
      {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        日: 7,
        天: 7,
        '1': 1,
        '2': 2,
        '3': 3,
        '4': 4,
        '5': 5,
        '6': 6,
        '7': 7,
      } as Record<string, number>
    )[value] ?? null
  );
}

function detectTeachingWeek(lines: OcrLine[]): number | null {
  for (const line of lines) {
    const match = normalized(line.text).match(/第(\d{1,2})周/);
    if (match) {
      const week = Number(match[1]);
      if (week >= 1 && week <= 60) return week;
    }
  }
  return null;
}

function weekdayAnchors(lines: OcrLine[]): Anchor[] {
  const anchors = lines.flatMap((line, index) => {
    const value = weekdayNumber(line.text);
    return value === null
      ? []
      : [
          {
            value,
            x: (line.bbox.x0 + line.bbox.x1) / 2,
            y: (line.bbox.y0 + line.bbox.y1) / 2,
            height: Math.max(1, line.bbox.y1 - line.bbox.y0),
            index,
          },
        ];
  });
  if (!anchors.length) return [];
  const lineHeight = median(
    anchors.map((anchor) => anchor.height),
    14,
  );
  const tolerance = Math.max(14, lineHeight * 2.2);
  const groups: Anchor[][] = [];
  for (const anchor of [...anchors].sort((a, b) => a.y - b.y)) {
    const group = groups.find(
      (items) =>
        Math.abs(
          median(
            items.map((item) => item.y),
            anchor.y,
          ) - anchor.y,
        ) <= tolerance,
    );
    if (group) group.push(anchor);
    else groups.push([anchor]);
  }
  const header =
    groups.sort(
      (a, b) =>
        new Set(b.map((item) => item.value)).size -
        new Set(a.map((item) => item.value)).size,
    )[0] ?? [];
  return [
    ...new Map(header.map((anchor) => [anchor.value, anchor])).values(),
  ].sort((a, b) => a.x - b.x);
}

function periodAnchors(lines: OcrLine[], weekdayHeader: Anchor[]): Anchor[] {
  if (!weekdayHeader.length) return [];
  const leftmostWeekday = Math.min(...weekdayHeader.map((item) => item.x));
  const headerY = median(
    weekdayHeader.map((item) => item.y),
    0,
  );
  const candidates = lines.flatMap((line, index) => {
    const text = normalized(line.text);
    const match = text.match(/^(?:第)?0?(\d{1,2})(?:节)?$/);
    const value = match ? Number(match[1]) : 0;
    const x = (line.bbox.x0 + line.bbox.x1) / 2;
    const y = (line.bbox.y0 + line.bbox.y1) / 2;
    if (value < 1 || value > 24 || x >= leftmostWeekday || y <= headerY)
      return [];
    return [
      {
        value,
        x,
        y,
        height: Math.max(1, line.bbox.y1 - line.bbox.y0),
        index,
      },
    ];
  });
  const byNumber = new Map<number, Anchor>();
  for (const anchor of candidates.sort(
    (a, b) => a.value - b.value || a.y - b.y,
  )) {
    if (!byNumber.has(anchor.value)) byNumber.set(anchor.value, anchor);
  }
  return [...byNumber.values()].sort((a, b) => a.y - b.y);
}

function inferColumns(anchors: Anchor[], width: number): MobileWeekdayColumn[] {
  if (!anchors.length) return [];
  const centers = anchors.map((anchor) => anchor.x);
  const spacing = median(
    centers.slice(1).map((center, index) => center - centers[index]),
    width / 7,
  );
  return anchors.map((anchor, index) => {
    const left =
      index > 0
        ? (centers[index - 1] + anchor.x) / 2
        : anchor.value === 1
          ? Math.max(0, anchor.x - spacing / 2)
          : 0;
    const right =
      index < anchors.length - 1
        ? (anchor.x + centers[index + 1]) / 2
        : anchor.value === 7
          ? Math.min(width, anchor.x + spacing / 2)
          : width;
    return { weekday: anchor.value, left, right, center: anchor.x };
  });
}

function inferPeriodRows(anchors: Anchor[], height: number): MobilePeriodRow[] {
  if (!anchors.length) return [];
  const centers = anchors.map((anchor) => anchor.y);
  const typicalSpacing = median(
    centers.slice(1).map((center, index) => center - centers[index]),
    height / 12,
  );
  return anchors.map((anchor, index) => ({
    periodNumber: anchor.value,
    top:
      index > 0
        ? (centers[index - 1] + anchor.y) / 2
        : Math.max(0, anchor.y - typicalSpacing / 2),
    bottom:
      index < anchors.length - 1
        ? (anchor.y + centers[index + 1]) / 2
        : Math.min(height, anchor.y + typicalSpacing / 2),
    center: anchor.y,
  }));
}

function isCourseColor(red: number, green: number, blue: number): boolean {
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const chroma = high - low;
  return high < 252 && high > 65 && chroma >= 10 && chroma / high >= 0.04;
}

function nearbyColor(left: number, right: number): boolean {
  return (
    Math.abs(((left >> 16) & 255) - ((right >> 16) & 255)) <= 52 &&
    Math.abs(((left >> 8) & 255) - ((right >> 8) & 255)) <= 52 &&
    Math.abs((left & 255) - (right & 255)) <= 52
  );
}

function detectColorComponents(
  image: MobileTimetableImage,
  columns: MobileWeekdayColumn[],
  rows: MobilePeriodRow[],
): Component[] {
  if (!columns.length || !rows.length) return [];
  const factor = Math.max(
    1,
    Math.ceil(Math.max(image.width, image.height) / 900),
  );
  const left = Math.max(
    0,
    Math.floor(Math.min(...columns.map((item) => item.left)) / factor),
  );
  const right = Math.min(
    image.width,
    Math.ceil(Math.max(...columns.map((item) => item.right)) / factor),
  );
  const top = Math.max(
    0,
    Math.floor(Math.min(...rows.map((item) => item.top)) / factor),
  );
  const bottom = Math.min(
    image.height,
    Math.ceil(Math.max(...rows.map((item) => item.bottom)) / factor),
  );
  const width = Math.max(1, Math.ceil(right) - left);
  const height = Math.max(1, Math.ceil(bottom) - top);
  const colors = new Int32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, (top + y) * factor);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, (left + x) * factor);
      const offset = (sourceY * image.width + sourceX) * 4;
      const red = image.data[offset] ?? 255;
      const green = image.data[offset + 1] ?? 255;
      const blue = image.data[offset + 2] ?? 255;
      const index = y * width + x;
      const color = (red << 16) | (green << 8) | blue;
      colors[index] = color;
      mask[index] = isCourseColor(red, green, blue) ? 1 : 0;
    }
  }
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];
  const dayWidth =
    median(
      columns.map((column) => column.right - column.left),
      image.width / 7,
    ) / factor;
  const periodHeight =
    median(
      rows.map((row) => row.bottom - row.top),
      image.height / 12,
    ) / factor;
  const minArea = Math.max(32, width * height * 0.00018);
  const minWidth = Math.max(8, dayWidth * 0.17);
  const minHeight = Math.max(9, periodHeight * 0.42);

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let read = 0;
    let write = 0;
    queue[write++] = start;
    visited[start] = 1;
    const baseColor = colors[start];
    const component: Component = {
      minX: start % width,
      maxX: start % width,
      minY: Math.floor(start / width),
      maxY: Math.floor(start / width),
      pixelCount: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    while (read < write) {
      const index = queue[read++];
      const x = index % width;
      const y = Math.floor(index / width);
      const color = colors[index];
      component.pixelCount += 1;
      component.minX = Math.min(component.minX, x);
      component.maxX = Math.max(component.maxX, x);
      component.minY = Math.min(component.minY, y);
      component.maxY = Math.max(component.maxY, y);
      component.red += (color >> 16) & 255;
      component.green += (color >> 8) & 255;
      component.blue += color & 255;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height)
            continue;
          const next = nextY * width + nextX;
          if (
            !mask[next] ||
            visited[next] ||
            !nearbyColor(baseColor, colors[next])
          )
            continue;
          visited[next] = 1;
          queue[write++] = next;
        }
      }
    }
    const componentWidth = component.maxX - component.minX + 1;
    const componentHeight = component.maxY - component.minY + 1;
    if (
      component.pixelCount < minArea ||
      componentWidth < minWidth ||
      componentHeight < minHeight
    )
      continue;
    components.push(component);
  }
  return components.map((component) => ({
    ...component,
    minX: (left + component.minX) * factor,
    maxX: (left + component.maxX + 1) * factor,
    minY: (top + component.minY) * factor,
    maxY: (top + component.maxY + 1) * factor,
  }));
}

export function detectMobileTimetableLayout(
  image: MobileTimetableImage,
  lines: OcrLine[],
): MobileTimetableAnalysis {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.data.length < image.width * image.height * 4
  )
    throw new Error('手机课表图片像素数据无效。');

  const warnings: string[] = [];
  const weekdays = weekdayAnchors(lines);
  const periods = periodAnchors(lines, weekdays);
  const weekdayColumns = inferColumns(weekdays, image.width);
  const periodRows = inferPeriodRows(periods, image.height);
  const teachingWeek = detectTeachingWeek(lines);
  if (teachingWeek === null)
    warnings.push('未找到明确教学周次；截图周次待确认。');
  if (weekdayColumns.length < 5)
    warnings.push('星期列不完整或识别不足；请检查截图裁切和列边界。');
  if (
    weekdayColumns[0]?.weekday !== 1 ||
    weekdayColumns.at(-1)?.weekday !== 7 ||
    (weekdays[0]?.x ?? 0) < image.width * 0.025 ||
    (weekdays.at(-1)?.x ?? image.width) > image.width * 0.975
  )
    warnings.push('截图可能被左右裁切，检测结果仅代表可见区域。');
  if (periodRows.length < 2)
    warnings.push('未识别到足够的节次编号，课程节次需要人工确认。');

  const components = detectColorComponents(image, weekdayColumns, periodRows);
  const courseBlocks = components
    .map((component, index): MobileCourseBlock => {
      const bounds = {
        x: component.minX,
        y: component.minY,
        width: component.maxX - component.minX,
        height: component.maxY - component.minY,
      };
      const centerX = bounds.x + bounds.width / 2;
      const column = weekdayColumns.find(
        (item) => centerX >= item.left && centerX <= item.right,
      );
      const overlappedRows = periodRows.filter((row) => {
        const overlap = Math.max(
          0,
          Math.min(bounds.y + bounds.height, row.bottom) -
            Math.max(bounds.y, row.top),
        );
        return overlap >= Math.min(row.bottom - row.top, bounds.height) * 0.2;
      });
      const sourceText = lines
        .filter((line) => {
          const centerXLine = (line.bbox.x0 + line.bbox.x1) / 2;
          const centerYLine = (line.bbox.y0 + line.bbox.y1) / 2;
          return (
            centerXLine >= bounds.x &&
            centerXLine <= bounds.x + bounds.width &&
            centerYLine >= bounds.y &&
            centerYLine <= bounds.y + bounds.height
          );
        })
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join('\n');
      const blockWarnings: string[] = [];
      if (!column) blockWarnings.push('星期待确认');
      if (!overlappedRows.length) blockWarnings.push('节次待确认');
      if (!sourceText) blockWarnings.push('色块内文字尚未关联，需人工识别');
      if (
        bounds.x <= 1 ||
        bounds.y <= 1 ||
        bounds.x + bounds.width >= image.width - 1 ||
        bounds.y + bounds.height >= image.height - 1
      )
        blockWarnings.push('课程色块可能超出截图边界');
      const rgb = [
        Math.round(component.red / component.pixelCount),
        Math.round(component.green / component.pixelCount),
        Math.round(component.blue / component.pixelCount),
      ];
      return {
        id: `mobile-block-${index + 1}`,
        bounds,
        weekday: column?.weekday ?? null,
        periodStart: overlappedRows[0]?.periodNumber ?? null,
        periodEnd: overlappedRows.at(-1)?.periodNumber ?? null,
        sourceText,
        color: `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`,
        warnings: blockWarnings,
      };
    })
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  if (!courseBlocks.length)
    warnings.push('没有检测到可靠的彩色课程块；可继续人工校正。');
  if (
    courseBlocks.some(
      (block) => block.periodStart === null || block.periodEnd === null,
    )
  )
    warnings.push('部分色块没有可靠节次边界；请在校对中确认。');

  return {
    imageWidth: image.width,
    imageHeight: image.height,
    teachingWeek,
    weekdayColumns,
    periodRows,
    courseBlocks,
    warnings,
  };
}
