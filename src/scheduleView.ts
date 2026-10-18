import type { CourseOccurrence, Event } from './domain';

export type AgendaItem =
  | { kind: 'event'; event: Event }
  | { kind: 'course'; course: CourseOccurrence };

export function mergeAgendaItems(
  events: Event[],
  courses: CourseOccurrence[],
): AgendaItem[] {
  return [
    ...events.map((event) => ({ kind: 'event' as const, event })),
    ...courses.map((course) => ({ kind: 'course' as const, course })),
  ].sort((a, b) => {
    const aAllDay = a.kind === 'event' && a.event.isAllDay;
    const bAllDay = b.kind === 'event' && b.event.isAllDay;
    if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
    const aTime =
      a.kind === 'course' ? a.course.startTime : (a.event.startTime ?? '99:99');
    const bTime =
      b.kind === 'course' ? b.course.startTime : (b.event.startTime ?? '99:99');
    return aTime.localeCompare(bTime);
  });
}
