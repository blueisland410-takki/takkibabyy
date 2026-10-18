import type {
  DayData,
  Event,
  EventInput,
  EventUpdate,
  MoveDirection,
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
    };
  }
}
