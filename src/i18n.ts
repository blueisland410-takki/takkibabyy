import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';
import jaJP from '../locales/ja-JP.json';
import koKR from '../locales/ko-KR.json';
import enUS from '../locales/en-US.json';
import type { LanguageId } from './domain';

type Resource = Record<string, string>;
const resources: Record<LanguageId, Resource> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'en-US': enUS,
};

let activeLanguage: LanguageId = 'zh-CN';

const isDevelopmentRenderer = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  id: LanguageId;
  nativeName: string;
}> = [
  { id: 'zh-CN', nativeName: '简体中文' },
  { id: 'zh-TW', nativeName: '繁體中文' },
  { id: 'ja-JP', nativeName: '日本語' },
  { id: 'ko-KR', nativeName: '한국어' },
  { id: 'en-US', nativeName: 'English' },
];

export const setActiveLanguage = (language: LanguageId) => {
  activeLanguage = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
};

export const getActiveLanguage = () => activeLanguage;

export const t = (
  key: string,
  values?: Record<string, string | number>,
): string => {
  const localized = resources[activeLanguage][key];
  if (localized === undefined && isDevelopmentRenderer()) {
    console.warn(`[i18n] Missing ${activeLanguage} translation: ${key}`);
  }
  let message = localized ?? resources['zh-CN'][key] ?? key;
  if (values) {
    for (const [name, value] of Object.entries(values))
      message = message.replaceAll(`{{${name}}}`, String(value));
  }
  return message;
};

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchTemplate = (template: string, message: string) => {
  const parts = template.split(/{{(\w+)}}/g);
  const names: string[] = [];
  const pattern = parts
    .map((part, index) => {
      if (index % 2 === 1) {
        names.push(part);
        return '(.+?)';
      }
      return escapeRegularExpression(part);
    })
    .join('');
  const match = new RegExp(`^${pattern}$`).exec(message);
  if (!match) return undefined;
  return Object.fromEntries(
    names.map((name, index) => [name, match[index + 1]]),
  );
};

/** Localizes app-generated errors while keeping user-entered text out of this path. */
export const translateSystemMessage = (message: string) => {
  const languages = Object.keys(resources) as LanguageId[];
  for (const language of [
    activeLanguage,
    ...languages.filter((id) => id !== activeLanguage),
  ]) {
    for (const [key, value] of Object.entries(resources[language])) {
      if (value === message) return t(key);
      if (value.includes('{{')) {
        const values = matchTemplate(value, message);
        if (values) {
          if ('message' in values)
            values.message = translateSystemMessage(values.message);
          return t(key, values);
        }
      }
    }
  }

  return activeLanguage === 'zh-CN' ? message : t('操作失败，请重试。');
};

export const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(activeLanguage, options).format(date);

export const formatDateKey = (
  dateKey: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day, 12), options);
};

export const formatFullDate = (date: Date) =>
  formatDate(date, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

export const formatWeekdayLabels = (date: Date) =>
  Array.from({ length: 7 }, (_, index) => {
    const day = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + index,
      12,
    );
    return formatDate(day, { weekday: 'narrow' });
  });

export const formatWeekdayNames = () =>
  Array.from({ length: 7 }, (_, index) =>
    formatDate(new Date(2024, 0, 1 + index, 12), { weekday: 'long' }),
  );

export const formatWeekdayNumber = (weekday: number) =>
  formatDate(new Date(2024, 0, weekday, 12), { weekday: 'long' });

export const formatTeachingWeek = (week: number) => {
  if (activeLanguage === 'en-US') return `Teaching week ${week}`;
  if (activeLanguage === 'ja-JP') return `第${week}週`;
  if (activeLanguage === 'ko-KR') return `${week}주차`;
  return `第 ${week} 教学周`;
};

export const getMissingTranslationKeys = () => {
  const keys = Object.keys(resources['zh-CN']).sort();
  return (Object.keys(resources) as LanguageId[]).flatMap((language) =>
    keys
      .filter((key) => !resources[language][key]?.trim())
      .map((key) => `${language}:${key}`),
  );
};
