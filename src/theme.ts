import type { ThemeId } from './domain';

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  accent: string;
  background: string;
  buttonText: string;
};

export type ThemeTokens = {
  '--app-bg': string;
  '--surface': string;
  '--surface-secondary': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--accent': string;
  '--accent-hover': string;
  '--accent-subtle': string;
  '--accent-text': string;
  '--border': string;
  '--focus-ring': string;
  '--button-text': string;
};

export const THEME_OPTIONS: readonly ThemeDefinition[] = [
  {
    id: 'classic',
    name: 'Classic',
    accent: '#444444',
    background: '#F5F5F3',
    buttonText: '#FFFFFF',
  },
  {
    id: 'dusty-rose',
    name: 'Dusty Rose',
    accent: '#BC969D',
    background: '#F7F0F1',
    buttonText: '#292722',
  },
  {
    id: 'sage-green',
    name: 'Sage Green',
    accent: '#9AAE9B',
    background: '#F0F4EF',
    buttonText: '#292722',
  },
  {
    id: 'misty-blue',
    name: 'Misty Blue',
    accent: '#97ACBC',
    background: '#EFF3F6',
    buttonText: '#292722',
  },
  {
    id: 'muted-lavender',
    name: 'Muted Lavender',
    accent: '#B3A4BD',
    background: '#F3F0F6',
    buttonText: '#292722',
  },
  {
    id: 'oat-beige',
    name: 'Oat Beige',
    accent: '#B8A58E',
    background: '#F6F2EB',
    buttonText: '#292722',
  },
];

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' &&
  THEME_OPTIONS.some((theme) => theme.id === value);

const mixHex = (first: string, second: string, secondWeight: number) => {
  const channels = [1, 3, 5].map((offset) => {
    const a = Number.parseInt(first.slice(offset, offset + 2), 16);
    const b = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(a * (1 - secondWeight) + b * secondWeight)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
};

export const getThemeTokens = (themeId: ThemeId): ThemeTokens => {
  const theme = THEME_OPTIONS.find((option) => option.id === themeId)!;
  return {
    '--app-bg': theme.background,
    '--surface': mixHex(theme.background, '#FFFFFF', 0.78),
    '--surface-secondary': mixHex(theme.background, theme.accent, 0.055),
    '--text-primary': '#292722',
    '--text-secondary': '#625E57',
    '--accent': theme.accent,
    '--accent-hover': mixHex(theme.accent, '#292722', 0.16),
    '--accent-subtle': mixHex(theme.background, theme.accent, 0.15),
    '--accent-text': theme.id === 'classic' ? '#444444' : '#292722',
    '--border': mixHex(theme.background, '#817B72', 0.21),
    '--focus-ring': mixHex(theme.accent, '#292722', 0.28),
    '--button-text': theme.buttonText,
  };
};

const luminance = (hex: string) => {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

export const contrastRatio = (first: string, second: string) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

export const getThemeDefinition = (themeId: ThemeId) =>
  THEME_OPTIONS.find((theme) => theme.id === themeId)!;
