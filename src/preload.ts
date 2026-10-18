import { contextBridge, ipcRenderer } from 'electron';
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
import {
  assertDateKey,
  assertId,
  parseEventInput,
  parseEventUpdate,
  parseMoveDirection,
  parseTaskInput,
  parseTaskUpdate,
} from './validation';

contextBridge.exposeInMainWorld('dayByDay', {
  getAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:get-always-on-top'),
  toggleAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke('window:toggle-always-on-top'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  getDay: (date: string): Promise<DayData> => {
    assertDateKey(date);
    return ipcRenderer.invoke('planner:get-day', date);
  },
  createTask: (input: TaskInput): Promise<Task> =>
    ipcRenderer.invoke('task:create', parseTaskInput(input)),
  updateTask: (input: TaskUpdate): Promise<Task> =>
    ipcRenderer.invoke('task:update', parseTaskUpdate(input)),
  setTaskCompleted: (id: string, isCompleted: boolean): Promise<Task> => {
    assertId(id);
    if (typeof isCompleted !== 'boolean') throw new Error('待办完成状态无效。');
    return ipcRenderer.invoke('task:set-completed', id, isCompleted);
  },
  deleteTask: (id: string): Promise<void> => {
    assertId(id);
    return ipcRenderer.invoke('task:delete', id);
  },
  moveTask: (id: string, direction: MoveDirection): Promise<void> => {
    assertId(id);
    const safeDirection = parseMoveDirection(direction);
    return ipcRenderer.invoke('task:move', id, safeDirection);
  },
  createEvent: (input: EventInput): Promise<Event> =>
    ipcRenderer.invoke('event:create', parseEventInput(input)),
  updateEvent: (input: EventUpdate): Promise<Event> =>
    ipcRenderer.invoke('event:update', parseEventUpdate(input)),
  deleteEvent: (id: string): Promise<void> => {
    assertId(id);
    return ipcRenderer.invoke('event:delete', id);
  },
});
