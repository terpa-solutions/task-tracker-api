/** Union of the three allowed priority levels. */
export type Priority = 'low' | 'medium' | 'high';

/**
 * How a task row is stored in SQLite.
 * `completed` is an integer (0 or 1) because SQLite has no native boolean.
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
 * `completed` is surfaced as a real boolean for a clean, predictable contract.
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
