/** Allowed task priority levels. */
export type Priority = 'low' | 'medium' | 'high';

/** All valid priorities, for validation and error messages. */
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];

/**
 * How a task row is stored in SQLite.
 *
 * SQLite has no native boolean type, so `completed` is persisted as an
 * integer (0 or 1). Keep this shape honest to the database and convert to a
 * clean API shape at the route boundary (see `toTask`).
 */
export interface TaskRow {
  id: number;
  title: string;
  completed: 0 | 1;
  created_at: string;
  priority: Priority;
  /** Calendar date as `YYYY-MM-DD`, or null when unset. */
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
  /** Calendar date as `YYYY-MM-DD`, or null when unset. */
  due_date: string | null;
}

/** Convert a raw database row into the API-facing Task shape. */
export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    created_at: row.created_at,
    priority: row.priority,
    due_date: row.due_date,
  };
}
