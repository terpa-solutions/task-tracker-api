/** The three task priorities, ordered from least to most urgent. */
export const PRIORITIES = ['low', 'medium', 'high'] as const;

/**
 * A task's priority.
 *
 * Derived from `PRIORITIES` so the runtime list (used for validation and query
 * parsing) and the compile-time type can never drift apart.
 */
export type Priority = (typeof PRIORITIES)[number];

/**
 * How a task row is stored in SQLite.
 *
 * SQLite has no native boolean type, so `completed` is persisted as an
 * integer (0 or 1). Keep this shape honest to the database and convert to a
 * clean API shape at the route boundary (see `toTask`).
 *
 * `due_date` is nullable in the database, which surfaces here as `null` rather
 * than `undefined` — that is what better-sqlite3 hands back for a NULL column.
 */
export interface TaskRow {
  id: number;
  title: string;
  completed: 0 | 1;
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

/**
 * How a task is exposed over the API (JSON).
 *
 * `completed` is surfaced as a real boolean for a clean, predictable contract.
 * `due_date` stays `string | null` so the field is always present in the
 * response — a client can rely on the key existing rather than testing for it.
 */
export interface Task {
  id: number;
  title: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
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
