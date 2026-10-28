export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

/** An ISO 8601 timestamp in UTC, as produced by `Date.prototype.toISOString()`. */
export type IsoDateString = string;

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
  priority: Priority;
  due_date: IsoDateString | null;
  created_at: string;
}

/**
 * How a task is exposed over the API (JSON).
 *
 * `completed` is surfaced as a real boolean for a clean, predictable contract.
 * `due_date` is a UTC ISO 8601 timestamp or `null` when not set.
 */
export interface Task {
  id: number;
  title: string;
  completed: boolean;
  priority: Priority;
  due_date: IsoDateString | null;
  created_at: string;
}

/** Convert a raw database row into the API-facing Task shape. */
export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    priority: row.priority,
    due_date: row.due_date,
    created_at: row.created_at,
  };
}
