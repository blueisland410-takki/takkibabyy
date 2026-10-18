import type { CourseInput, RecurrenceType } from './domain';

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateKeyFromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromUtc(date);
}

export function getTeachingWeekNumber(
  firstWeekMonday: string,
  dateKey: string,
): number {
  const days =
    (dateFromKey(dateKey).getTime() - dateFromKey(firstWeekMonday).getTime()) /
    86_400_000;
  return Math.floor(days / 7) + 1;
}

export function getWeekday(dateKey: string): number {
  const day = dateFromKey(dateKey).getUTCDay();
  return day === 0 ? 7 : day;
}

export function courseMatchesWeek(
  recurrenceType: RecurrenceType,
  customWeeks: number[],
  firstWeek: number,
  lastWeek: number,
  week: number,
): boolean {
  if (week < firstWeek || week > lastWeek) return false;
  switch (recurrenceType) {
    case 'ALL':
      return true;
    case 'ODD':
      return week % 2 === 1;
    case 'EVEN':
      return week % 2 === 0;
    case 'CUSTOM':
      return customWeeks.includes(week);
  }
}

export function courseOccursOnDate(
  course: Pick<
    CourseInput,
    'weekday' | 'firstWeek' | 'lastWeek' | 'recurrenceType' | 'customWeeks'
  >,
  semester: { startDate: string; endDate: string; firstWeekMonday: string },
  dateKey: string,
): boolean {
  if (dateKey < semester.startDate || dateKey > semester.endDate) return false;
  if (getWeekday(dateKey) !== course.weekday) return false;
  const week = getTeachingWeekNumber(semester.firstWeekMonday, dateKey);
  return courseMatchesWeek(
    course.recurrenceType,
    course.customWeeks,
    course.firstWeek,
    course.lastWeek,
    week,
  );
}

export function courseDateForWeek(
  firstWeekMonday: string,
  week: number,
  weekday: number,
): string {
  return shiftDateKey(firstWeekMonday, (week - 1) * 7 + weekday - 1);
}
