const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  detectMobileTimetableLayout,
} = require('../.test-output/src/mobileTimetableParser.js');

const fixtureDirectory = path.join(__dirname, 'fixtures', 'mobile-timetable');
const benchmark = JSON.parse(
  fs.readFileSync(
    path.join(fixtureDirectory, 'expected-reference.json'),
    'utf8',
  ),
);

function makeSyntheticMobileTimetable() {
  const width = 700;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  const weekdayCenters = [100, 190, 280, 370, 460, 550, 640];
  const periodCenters = Array.from(
    { length: 8 },
    (_, index) => 160 + index * 48,
  );
  const lines = [
    { text: '第8周', confidence: 94, bbox: { x0: 20, y0: 18, x1: 70, y1: 36 } },
    ...weekdayCenters.map((center, index) => ({
      text: `星期${'一二三四五六日'[index]}`,
      confidence: 95,
      bbox: { x0: center - 20, y0: 68, x1: center + 20, y1: 88 },
    })),
    ...periodCenters.map((center, index) => ({
      text: String(index + 1).padStart(2, '0'),
      confidence: 93,
      bbox: { x0: 16, y0: center - 8, x1: 34, y1: center + 8 },
    })),
  ];
  const expected = benchmark.expectedVisibleBlocks;
  expected.forEach((item, index) => {
    const color = [
      [226, 239, 230],
      [244, 225, 218],
      [229, 231, 245],
      [239, 231, 208],
      [222, 238, 241],
      [242, 226, 236],
      [229, 238, 216],
      [239, 228, 211],
    ][index];
    const centerX = weekdayCenters[item.weekday - 1];
    // Preserve a thin, realistic cell divider between consecutive course blocks.
    const top = periodCenters[item.periodStart - 1] - 22;
    const bottom = periodCenters[item.periodEnd - 1] + 22;
    const left = centerX - 27;
    const right = centerX + 27;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
    lines.push({
      text: item.courseName,
      confidence: 90,
      bbox: {
        x0: left + 4,
        y0: top + 8,
        x1: right - 4,
        y1: Math.min(top + 25, bottom - 2),
      },
    });
  });
  return { image: { width, height, data }, lines };
}

test('mobile timetable synthetic benchmark locates all eight colored blocks and grid cells', () => {
  const { image, lines } = makeSyntheticMobileTimetable();
  const result = detectMobileTimetableLayout(image, lines);

  assert.equal(result.teachingWeek, 8);
  assert.deepEqual(
    result.courseBlocks
      .map(({ weekday, periodStart, periodEnd }) => ({
        weekday,
        periodStart,
        periodEnd,
      }))
      .sort((a, b) => a.weekday - b.weekday || a.periodStart - b.periodStart),
    benchmark.expectedVisibleBlocks
      .map(({ weekday, periodStart, periodEnd }) => ({
        weekday,
        periodStart,
        periodEnd,
      }))
      .sort((a, b) => a.weekday - b.weekday || a.periodStart - b.periodStart),
  );
  assert.equal(result.courseBlocks.length, 8);
  assert.ok(result.courseBlocks.some((block) => block.weekday === 2) === false);
  assert.equal(
    result.courseBlocks.filter(
      (block) =>
        block.weekday === 1 && block.sourceText.includes('数字视频编辑'),
    ).length,
    2,
    'two same-name classes on one day remain separate blocks',
  );
  assert.equal(result.warnings.length, 0);
});

test('mobile grid parser reports clipped day headers and never invents clock times', () => {
  const { image, lines } = makeSyntheticMobileTimetable();
  const clippedLines = lines.filter(
    (line) => !line.text.includes('星期一') && !line.text.includes('星期日'),
  );
  const result = detectMobileTimetableLayout(image, clippedLines);

  assert.ok(result.warnings.some((warning) => warning.includes('裁切')));
  assert.ok(result.courseBlocks.every((block) => !('startTime' in block)));
});

test('a course week range is not mistaken for the screenshot teaching week', () => {
  const { image, lines } = makeSyntheticMobileTimetable();
  const withoutWeekHeader = lines
    .filter((line) => line.text !== '第8周')
    .concat({
      text: '课程 1-16周',
      confidence: 88,
      bbox: { x0: 82, y0: 145, x1: 132, y1: 155 },
    });
  const result = detectMobileTimetableLayout(image, withoutWeekHeader);
  assert.equal(result.teachingWeek, null);
});
