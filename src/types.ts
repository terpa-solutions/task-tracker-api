import { taskIdNumber } from './task-id.js';

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = typeof PRIORITIES[number];

/**
 * How a task row is stored in SQLite.
 *
 * SQLite has no native boolean type, so `completed` is persisted as an
 * integer (0 or 1). Keep this shape honest to the database and convert to a
 * clean API shape at the model boundary (see `toTask`).
 */
export interface TaskRow {
  id: number | bigint;
  title: string;
  completed: 0 | 1 | 0n | 1n;
  created_at: string;
  priority: Priority;
  due_date: string | null;
}

/**
 * How a task is exposed over the API (JSON).
 *
 * `completed` is surfaced as a real boolean for a clean, predictable contract.
 */
export interface Task {
  id: number;
  title: string;
  completed: boolean;
  created_at: string;
  priority: Priority;
  due_date: string | null;
}

/** Stable response for every successful task listing, including empty results. */
export interface TaskListResponse {
  tasks: Task[];
  message: string | null;
}

/** Validated values passed from the controller to the model. */
export type CreateTaskData = Pick<Task, 'title' | 'priority' | 'due_date'>;
export type UpdateTaskData = Partial<Pick<Task, 'title' | 'completed' | 'priority' | 'due_date'>>;

/** Validated selections used by the listing model. HTTP parsing is separate. */
export interface TaskFilters {
  completed?: readonly boolean[];
  priority?: readonly Priority[];
}

/** Convert a raw database row into the API-facing Task shape. */
export function toTask(row: TaskRow): Task {
  return {
    id: taskIdNumber(row.id),
    title: row.title,
    completed: row.completed === 1 || row.completed === 1n,
    created_at: row.created_at,
    priority: row.priority,
    due_date: row.due_date,
  };
}
