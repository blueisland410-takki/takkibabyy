import type {
  Course,
  CourseImportAnalysis,
  CourseImportConflict,
  CourseImportDuplicate,
  CourseInput,
  RecurrenceType,
} from './domain';

type ComparableCourse = Pick<
  CourseInput,
  | 'courseName'
  | 'weekday'
  | 'startTime'
  | 'endTime'
  | 'classroom'
  | 'firstWeek'
  | 'lastWeek'
  | 'recurrenceType'
  | 'customWeeks'
>;

function meetingWeeks(course: ComparableCourse): number[] {
  const result: number[] = [];
  for (let week = course.firstWeek; week <= course.lastWeek; week += 1) {
    const occurs =
      course.recurrenceType === 'ALL' ||
      (course.recurrenceType === 'ODD' && week % 2 === 1) ||
      (course.recurrenceType === 'EVEN' && week % 2 === 0) ||
      (course.recurrenceType === 'CUSTOM' && course.customWeeks.includes(week));
    if (occurs) result.push(week);
  }
  return result;
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .toLocaleLowerCase();
}

function isSameMeeting(a: ComparableCourse, b: ComparableCourse): boolean {
  return (
    normalizedName(a.courseName) === normalizedName(b.courseName) &&
    a.weekday === b.weekday &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    normalizedName(a.classroom) === normalizedName(b.classroom) &&
    JSON.stringify(meetingWeeks(a)) === JSON.stringify(meetingWeeks(b))
  );
}

function sharedWeek(a: ComparableCourse, b: ComparableCourse): boolean {
  const bWeeks = new Set(meetingWeeks(b));
  return meetingWeeks(a).some((week) => bWeeks.has(week));
}

function overlaps(a: ComparableCourse, b: ComparableCourse): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

export function analyzeCourseImport(
  existing: Course[],
  incoming: CourseInput[],
): CourseImportAnalysis {
  const duplicates: CourseImportDuplicate[] = [];
  const conflicts: CourseImportConflict[] = [];
  const uniqueIncoming: Array<{ input: CourseInput; originalIndex: number }> =
    [];
  const compared: Array<{ input: CourseInput; originalIndex: number }> = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const candidate = incoming[index];
    const duplicate = existing.find((course) =>
      isSameMeeting(course, candidate),
    );
    if (duplicate) {
      duplicates.push({
        courseIndex: index,
        existingCourseId: duplicate.id,
        courseName: candidate.courseName,
      });
    } else {
      const earlier = uniqueIncoming.find(({ input }) =>
        isSameMeeting(input, candidate),
      );
      if (earlier) {
        duplicates.push({
          courseIndex: index,
          earlierCourseIndex: earlier.originalIndex,
          courseName: candidate.courseName,
        });
      } else {
        uniqueIncoming.push({ input: candidate, originalIndex: index });
      }
    }

    for (const course of existing) {
      if (
        course.weekday === candidate.weekday &&
        sharedWeek(course, candidate) &&
        overlaps(course, candidate) &&
        !isSameMeeting(course, candidate)
      ) {
        conflicts.push({
          firstCourseIndex: index,
          secondCourseIndex: -1,
          weekday: candidate.weekday,
          firstCourseName: candidate.courseName,
          secondCourseName: course.courseName,
        });
      }
    }
    for (const earlier of compared) {
      if (
        earlier.input.weekday === candidate.weekday &&
        sharedWeek(earlier.input, candidate) &&
        overlaps(earlier.input, candidate) &&
        !isSameMeeting(earlier.input, candidate)
      ) {
        conflicts.push({
          firstCourseIndex: earlier.originalIndex,
          secondCourseIndex: index,
          weekday: candidate.weekday,
          firstCourseName: earlier.input.courseName,
          secondCourseName: candidate.courseName,
        });
      }
    }
    compared.push({ input: candidate, originalIndex: index });
  }
  return { duplicates, conflicts };
}

export function parseImportDecisionAction(value: unknown): 'skip' | 'keep' {
  if (value !== 'skip' && value !== 'keep')
    throw new Error('重复课程处理方式无效。');
  return value;
}

export function courseRecurrenceWeeks(
  recurrenceType: RecurrenceType,
  customWeeks: number[],
  firstWeek: number,
  lastWeek: number,
): number[] {
  return meetingWeeks({
    courseName: '',
    weekday: 1,
    startTime: '',
    endTime: '',
    classroom: '',
    recurrenceType,
    customWeeks,
    firstWeek,
    lastWeek,
  });
}
