/**
 * The priority levels a task can have. Declared as a runtime array so the
 * schema layer can build an enum validator from the same source of truth.
 */
export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

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

/**
 * SQLite's `datetime('now')` writes UTC as "YYYY-MM-DD HH:MM:SS", which is not
 * valid ISO-8601 and does not say it is UTC. Normalising on the way out — and
 * not in the schema — keeps rows written before this change readable, and
 * leaves what is already stored untouched.
 */
function toIsoUtc(timestamp: string): string {
  return timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`;
}

/** Convert a raw database row into the API-facing Task shape. */
export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    created_at: toIsoUtc(row.created_at),
    priority: row.priority,
    due_date: row.due_date,
  };
}
