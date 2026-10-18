import type {
  Course,
  CourseExceptionInput,
  CourseInput,
  DayData,
  Event,
  EventInput,
  EventUpdate,
  MoveDirection,
  Semester,
  SemesterInput,
  SeriesExceptionPolicy,
  Task,
  TaskInput,
  TaskUpdate,
} from './domain';

export {};

declare global {
  interface Window {
    dayByDay: {
      getAlwaysOnTop: () => Promise<boolean>;
      toggleAlwaysOnTop: () => Promise<boolean>;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      getDay: (date: string) => Promise<DayData>;
      createTask: (input: TaskInput) => Promise<Task>;
      updateTask: (input: TaskUpdate) => Promise<Task>;
      setTaskCompleted: (id: string, isCompleted: boolean) => Promise<Task>;
      deleteTask: (id: string) => Promise<void>;
      moveTask: (id: string, direction: MoveDirection) => Promise<void>;
      createEvent: (input: EventInput) => Promise<Event>;
      updateEvent: (input: EventUpdate) => Promise<Event>;
      deleteEvent: (id: string) => Promise<void>;
      listSemesters: () => Promise<Semester[]>;
      createSemester: (input: SemesterInput) => Promise<Semester>;
      updateSemester: (id: string, input: SemesterInput) => Promise<Semester>;
      setCurrentSemester: (id: string) => Promise<Semester>;
      listCourses: (semesterId: string) => Promise<Course[]>;
      createCourse: (input: CourseInput) => Promise<Course>;
      updateCourseSeries: (
        id: string,
        input: CourseInput,
        policy: SeriesExceptionPolicy,
      ) => Promise<Course>;
      deleteCourseSeries: (id: string) => Promise<void>;
      saveCourseException: (input: CourseExceptionInput) => Promise<void>;
      deleteCourseException: (
        courseId: string,
        originalDate: string,
      ) => Promise<void>;
    };
  }
}
