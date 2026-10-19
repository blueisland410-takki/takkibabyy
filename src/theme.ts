import type { ThemeId } from './domain';

export type ThemeDefinition = {
  id: ThemeId;
  name: string;
  accent: string;
  background: string;
  subtle: string;
  buttonText: string;
  group: 'soft' | 'pop';
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
    subtle: '#DCDCDC',
    buttonText: '#FFFFFF',
    group: 'soft',
  },
  {
    id: 'dusty-rose',
    name: 'Dusty Rose',
    accent: '#BC969D',
    background: '#F7F0F1',
    subtle: '#EDE0E2',
    buttonText: '#292722',
    group: 'soft',
  },
  {
    id: 'sage-green',
    name: 'Sage Green',
    accent: '#9AAE9B',
    background: '#F0F4EF',
    subtle: '#DFE8DF',
    buttonText: '#292722',
    group: 'soft',
  },
  {
    id: 'misty-blue',
    name: 'Misty Blue',
    accent: '#97ACBC',
    background: '#EFF3F6',
    subtle: '#DDE6EC',
    buttonText: '#292722',
    group: 'soft',
  },
  {
    id: 'muted-lavender',
    name: 'Muted Lavender',
    accent: '#B3A4BD',
    background: '#F3F0F6',
    subtle: '#E7E1EC',
    buttonText: '#292722',
    group: 'soft',
  },
  {
    id: 'oat-beige',
    name: 'Oat Beige',
    accent: '#B8A58E',
    background: '#F6F2EB',
    subtle: '#E9E1D6',
    buttonText: '#292722',
    group: 'soft',
  },
  {
    id: 'mint-pop',
    name: 'Mint Pop',
    accent: '#46D9AD',
    background: '#E9FFF7',
    subtle: '#B9F5E0',
    buttonText: '#173A30',
    group: 'pop',
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    accent: '#315CE8',
    background: '#EDF1FF',
    subtle: '#C6D3FF',
    buttonText: '#FFFFFF',
    group: 'pop',
  },
  {
    id: 'y2k-pink',
    name: 'Y2K Pink',
    accent: '#FF65C3',
    background: '#FFF0FA',
    subtle: '#FFC6E9',
    buttonText: '#45223A',
    group: 'pop',
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
    '--accent-subtle': theme.subtle,
    '--accent-text': theme.id === 'classic' ? '#444444' : '#292722',
    '--border': mixHex(theme.background, theme.accent, 0.2),
    '--focus-ring': mixHex(theme.accent, '#292722', 0.4),
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
