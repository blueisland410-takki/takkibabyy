const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseThemeId } = require('../.test-output/validation.js');
const {
  THEME_OPTIONS,
  contrastRatio,
  getThemeTokens,
} = require('../.test-output/theme.js');

test('all six themes use the requested accent and background colors', () => {
  assert.deepEqual(
    THEME_OPTIONS.map(({ id, accent, background }) => [
      id,
      accent.toLowerCase(),
      background.toLowerCase(),
    ]),
    [
      ['classic', '#444444', '#f5f5f3'],
      ['dusty-rose', '#bc969d', '#f7f0f1'],
      ['sage-green', '#9aae9b', '#f0f4ef'],
      ['misty-blue', '#97acbc', '#eff3f6'],
      ['muted-lavender', '#b3a4bd', '#f3f0f6'],
      ['oat-beige', '#b8a58e', '#f6f2eb'],
    ],
  );
});

test('every theme keeps normal and button text at WCAG AA contrast', () => {
  for (const theme of THEME_OPTIONS) {
    const tokens = getThemeTokens(theme.id);
    assert.ok(
      contrastRatio(tokens['--text-primary'], tokens['--app-bg']) >= 4.5,
      `${theme.name} primary text on app background`,
    );
    assert.ok(
      contrastRatio(tokens['--text-secondary'], tokens['--app-bg']) >= 4.5,
      `${theme.name} secondary text on app background`,
    );
    assert.ok(
      contrastRatio(tokens['--text-secondary'], tokens['--surface']) >= 4.5,
      `${theme.name} secondary text on surface`,
    );
    assert.ok(
      contrastRatio(tokens['--accent-text'], tokens['--accent-subtle']) >= 4.5,
      `${theme.name} selected text on selected background`,
    );
    assert.ok(
      contrastRatio(tokens['--focus-ring'], tokens['--app-bg']) >= 3,
      `${theme.name} focus ring on app background`,
    );
    assert.ok(
      contrastRatio(theme.buttonText, theme.accent) >= 4.5,
      `${theme.name} button text on accent`,
    );
  }
});

test('theme preference validation accepts only the six supported ids', () => {
  for (const theme of THEME_OPTIONS)
    assert.equal(parseThemeId(theme.id), theme.id);
  for (const invalid of ['Classic', 'rose', '', null, undefined, 1])
    assert.throws(() => parseThemeId(invalid), /主题选项无效/);
});

test('all visible application titles use Daybyday without the old punctuation', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(app, /aria-label="Daybyday"/);
  assert.match(app, /className="brand-name">Daybyday<\/span>/);
  assert.match(main, /title: 'Daybyday'/);
  assert.match(html, /<title>Daybyday<\/title>/);
  assert.doesNotMatch(app, /brand-name">daybyday\.<\/span>/i);
  assert.doesNotMatch(html, /<title>daybyday\.<\/title>/i);
});
