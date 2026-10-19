const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const { parseLanguageId } = require('../.test-output/src/validation.js');
const chineseFallback = require('../.test-output/locales/zh-CN.json');
const {
  formatFullDate,
  getMissingTranslationKeys,
  LANGUAGE_OPTIONS,
  setActiveLanguage,
  t,
  translateSystemMessage,
} = require('../.test-output/src/i18n.js');

const localeDirectory = path.join(__dirname, '../locales');
const uiFiles = [
  'src/App.tsx',
  'src/SemesterPlanner.tsx',
  'src/StructuredImport.tsx',
  'src/TimetableImport.tsx',
];

test('all five locale files have the same non-empty translation keys', () => {
  const localeNames = ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'];
  const catalogs = localeNames.map((name) =>
    JSON.parse(
      fs.readFileSync(path.join(localeDirectory, `${name}.json`), 'utf8'),
    ),
  );
  const canonicalKeys = Object.keys(catalogs[0]).sort();
  for (const [index, catalog] of catalogs.entries()) {
    assert.deepEqual(
      Object.keys(catalog).sort(),
      canonicalKeys,
      `${localeNames[index]} keys`,
    );
    for (const key of canonicalKeys)
      assert.equal(
        typeof catalog[key],
        'string',
        `${localeNames[index]}:${key}`,
      );
  }
  assert.deepEqual(getMissingTranslationKeys(), []);
  assert.equal(
    Object.values(catalogs[4]).filter((value) => /[\u3400-\u9fff]/.test(value))
      .length,
    0,
    'English catalog contains untranslated Chinese values',
  );
});

test('every literal translation call in the main UI exists in all locale catalogs', () => {
  const catalogs = ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'].map((name) =>
    JSON.parse(
      fs.readFileSync(path.join(localeDirectory, `${name}.json`), 'utf8'),
    ),
  );
  for (const file of uiFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === 't' &&
        node.arguments.length &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        for (const [index, catalog] of catalogs.entries())
          assert.ok(
            key in catalog,
            `${file} uses missing locale key ${key} (#${index})`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
});

test('static UI text uses localization resources and user-provided course text stays separate', () => {
  for (const file of uiFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (ts.isJsxText(node)) {
        const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
        assert.ok(
          !/[\p{L}]/u.test(text) || text === 'Daybyday' || text === 'd',
          `${file} has unlocalized JSX text: ${text}`,
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  setActiveLanguage('en-US');
  assert.equal(t('中文课程名称'), '中文课程名称');
  assert.equal(t('teacher name'), 'teacher name');
});

test('language validation and native-language labels cover the five requested locales', () => {
  const ids = ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'];
  assert.deepEqual(
    LANGUAGE_OPTIONS.map(({ id }) => id),
    ids,
  );
  for (const id of ids) assert.equal(parseLanguageId(id), id);
  assert.throws(() => parseLanguageId('fr-FR'), /应用语言选项无效/);
});

test('missing translations are reported in development and use the Simplified Chinese fallback', () => {
  const previousWindow = global.window;
  const previousWarn = console.warn;
  const warnings = [];
  const fallbackKey = 'temporary.fallback.test';
  chineseFallback[fallbackKey] = '简体中文后备文字';
  global.window = { location: { hostname: 'localhost' } };
  console.warn = (message) => warnings.push(message);
  try {
    setActiveLanguage('ja-JP');
    assert.equal(t(fallbackKey), '简体中文后备文字');
    assert.deepEqual(warnings, [
      '[i18n] Missing ja-JP translation: temporary.fallback.test',
    ]);
    assert.equal(t('Font size'), '文字サイズ');
  } finally {
    setActiveLanguage('zh-CN');
    console.warn = previousWarn;
    delete chineseFallback[fallbackKey];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('system errors use the active locale and remap templated messages after language changes', () => {
  setActiveLanguage('en-US');
  const englishFallback = t('操作失败，请重试。');
  assert.equal(translateSystemMessage('标题不能为空。'), englishFallback);
  const wrappedError = t('检查失败：{{message}}', {
    message: '标题不能为空。',
  });
  setActiveLanguage('ja-JP');
  assert.equal(
    translateSystemMessage(wrappedError),
    t('检查失败：{{message}}', { message: t('操作失败，请重试。') }),
  );
  const englishSuccess = t(
    '导入完成：新增 {{courses}} 门课程、{{events}} 条日程，跳过 {{skipped}} 条重复内容。',
    { courses: 2, events: 1, skipped: 0 },
  );
  setActiveLanguage('ko-KR');
  assert.equal(
    translateSystemMessage(englishSuccess),
    t(
      '导入完成：新增 {{courses}} 门课程、{{events}} 条日程，跳过 {{skipped}} 条重复内容。',
      { courses: 2, events: 1, skipped: 0 },
    ),
  );
  setActiveLanguage('zh-CN');
  assert.equal(translateSystemMessage('标题不能为空。'), '标题不能为空。');
});

test('all page error slots use the localized system-message renderer', () => {
  for (const file of uiFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(
      source,
      /translateSystemMessage\(/,
      `${file} must localize errors`,
    );
    assert.doesNotMatch(
      source,
      /\bt\(error\)/,
      `${file} has a raw error translation call`,
    );
  }
});

test('theme and language preferences persist in window state and broadcast without database migration', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  const preload = fs.readFileSync(
    path.join(__dirname, '../src/preload.ts'),
    'utf8',
  );
  assert.match(main, /languageId:\s*currentLanguageId/);
  assert.match(main, /currentLanguageId\s*=\s*savedState\.languageId/);
  assert.match(main, /BrowserWindow\.getAllWindows\(\)/);
  assert.match(
    main,
    /backgroundColor:\s*getThemeDefinition\(savedState\.themeId\)\.background/,
  );
  assert.match(preload, /settings:get-initial-language/);
  assert.match(preload, /settings:set-language/);
  assert.match(preload, /settings:preferences-changed/);
});

test('localized full dates use each language and leave calendar date calculation locale-independent', () => {
  const date = new Date(2026, 9, 19, 12);
  const expected = new Map([
    ['zh-CN', '2026年10月19日星期一'],
    ['ja-JP', '2026年10月19日月曜日'],
    ['ko-KR', '2026년 10월 19일 월요일'],
    ['en-US', 'Monday, October 19, 2026'],
  ]);
  for (const [language, label] of expected) {
    setActiveLanguage(language);
    assert.equal(formatFullDate(date), label, language);
  }
  setActiveLanguage('zh-TW');
  assert.match(formatFullDate(date), /2026年10月19日/);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 19);
});

test('the brand stays Daybyday and the retired greeting stays absent', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(app, /className="brand-name">Daybyday<\/span>/);
  assert.match(html, /<title>Daybyday<\/title>/);
  assert.doesNotMatch(app, /A little plan for today/);
});
