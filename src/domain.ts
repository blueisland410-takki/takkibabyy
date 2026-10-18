export type Task = {
  id: string;
  title: string;
  notes: string;
  scheduledDate: string;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Event = {
  id: string;
  title: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskInput = {
  title: string;
  notes: string;
  scheduledDate: string;
};

export type EventInput = {
  title: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string;
  notes: string;
};

export type DayData = {
  tasks: Task[];
  events: Event[];
};

export type TaskUpdate = TaskInput & { id: string };
export type EventUpdate = EventInput & { id: string };
export type MoveDirection = 'up' | 'down';
