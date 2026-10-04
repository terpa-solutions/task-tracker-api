import type { Database } from 'better-sqlite3';
import { toTask, type Task, type TaskRow, type CreateTaskData, type UpdateTaskData, type TaskFilters } from '../types.js';
import { MAX_TASK_ID, TaskIdRangeError } from '../task-id.js';

export class TasksNotFoundError extends Error {
  constructor(public readonly ids: number[]) {
    super(`Tasks not found: ${ids.join(', ')}.`);
    this.name = 'TasksNotFoundError';
  }
}

/** Prepare queries for one explicitly owned connection. */
export function createTaskModel(db: Database) {
  // Compile once and preserve exact SQLite integers until conversion to Task.
  const listStmt = db.prepare('SELECT * FROM tasks ORDER BY id ASC').safeIntegers(true);
  const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?').safeIntegers(true);
  const insertStmt = db.prepare('INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)').safeIntegers(true);
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');
  const capacityStmt = db.prepare(`
    SELECT COALESCE((SELECT MAX(id) FROM tasks), 0) >= ?
      OR COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tasks'), 0) >= ? AS exhausted
  `);

  function listTasks(filters: TaskFilters = {}): Task[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    if (filters.completed !== undefined) {
      conditions.push(`completed IN (${filters.completed.map(() => '?').join(', ')})`);
      values.push(...filters.completed.map(value => Number(value)));
    }
    if (filters.priority !== undefined) {
      conditions.push(`priority IN (${filters.priority.map(() => '?').join(', ')})`);
      values.push(...filters.priority);
    }
    // IN selects alternatives within a filter; AND combines different filters.
    // Only placeholders and fixed column names enter SQL; selections are parameters.
    const statement = conditions.length === 0 ? listStmt : db.prepare(
      `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY id ASC`,
    ).safeIntegers(true);
    return (statement.all(...values) as TaskRow[]).map(toTask);
  }

  function taskExists(id: number): boolean {
    return getStmt.get(id) !== undefined;
  }

  function createTask(input: CreateTaskData): Task {
    return db.transaction(() => {
      // Check both AUTOINCREMENT sources, including a deleted highest ID.
      const capacity = capacityStmt.get(MAX_TASK_ID, MAX_TASK_ID) as { exhausted: number | bigint };
      if (capacity.exhausted) throw new TaskIdRangeError();
      const info = insertStmt.run(input.title, input.priority, input.due_date);
      // Conversion stays in the transaction so failure rolls back rows and sequence.
      return toTask(getStmt.get(info.lastInsertRowid) as TaskRow);
    }).immediate();
  }

  function updateTask(id: number, input: UpdateTaskData): Task {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    // Column names are fixed; values always use SQL parameters.
    for (const field of ['title', 'completed', 'priority', 'due_date'] as const) {
      const value = input[field];
      if (value !== undefined) {
        updates.push(`${field} = ?`);
        values.push(typeof value === 'boolean' ? Number(value) : value);
      }
    }
    values.push(id);
    return db.transaction(() => {
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return toTask(getStmt.get(id) as TaskRow);
    }).immediate();
  }

  function deleteTask(id: number): boolean {
    return deleteStmt.run(id).changes > 0;
  }

  /** Validate existence and update the whole selection under the same write lock. */
  function bulkCompleteTasks(ids: readonly number[]): number {
    return db.transaction(() => {
      const placeholders = ids.map(() => '?').join(', ');
      const existing = db.prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`)
        .safeIntegers(true).all(...ids) as Pick<TaskRow, 'id'>[];
      const existingIds = new Set(existing.map(row => String(row.id)));
      const missing = ids.filter(id => !existingIds.has(String(id))).sort((a, b) => a - b);
      if (missing.length !== 0) throw new TasksNotFoundError(missing);
      // Exclude already completed tasks so changes counts actual state transitions.
      return db.prepare(`UPDATE tasks SET completed = 1 WHERE id IN (${placeholders}) AND completed = 0`)
        .run(...ids).changes;
    }).immediate();
  }

  return { listTasks, taskExists, createTask, updateTask, deleteTask, bulkCompleteTasks };
}

export type TaskModel = ReturnType<typeof createTaskModel>;
