import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import db from '../db.js';
import {
  bulkCompleteSchema,
  createTaskSchema,
  listTasksQuerySchema,
  toValidationError,
  updateTaskSchema,
} from '../schemas.js';
import { toTask, type TaskRow } from '../types.js';

export const tasksRouter = Router();

// Prepared statements (compiled once, reused per request). The list query is
// built per request instead, because its WHERE clause depends on the filters.
const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
const insertStmt = db.prepare(
  'INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)',
);
const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');

/** Parse and validate a route `:id` param, returning null when invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Validate `data` against `schema`.
 *
 * On success returns the parsed value (defaults applied, strings trimmed). On
 * failure it sends the 400 itself and returns null, so callers just need
 * `if (x === null) return;` and can treat everything after that as valid.
 */
function parseOr400<S extends z.ZodType>(
  schema: S,
  data: unknown,
  res: Response,
): z.output<S> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(400).json(toValidationError(result.error));
    return null;
  }
  return result.data;
}

/**
 * GET /tasks
 * List tasks, oldest first, optionally filtered.
 *
 * Supported query params, which combine with AND:
 *   ?completed=true|false
 *   ?priority=low|medium|high
 *
 * Filter values are bound as SQL parameters — only the shape of the WHERE
 * clause is interpolated, never user input.
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const query = parseOr400(listTasksQuerySchema, req.query, res);
  if (query === null) return;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (query.completed !== undefined) {
    conditions.push('completed = ?');
    values.push(query.completed === 'true' ? 1 : 0);
  }

  if (query.priority !== undefined) {
    conditions.push('priority = ?');
    values.push(query.priority);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks${where} ORDER BY id ASC`)
    .all(...values) as TaskRow[];

  res.json(rows.map(toTask));
});

/**
 * POST /tasks
 * Create a task from { "title": "...", "priority"?: ..., "due_date"?: ... }.
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const body = parseOr400(createTaskSchema, req.body ?? {}, res);
  if (body === null) return;

  const info = insertStmt.run(body.title, body.priority, body.due_date ?? null);
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
});

/**
 * POST /tasks/bulk-complete
 * Mark every task in { "ids": [1, 2, 3] } as completed.
 *
 * `updated` counts rows that actually changed state. The UPDATE is filtered on
 * `completed = 0`, because without it SQLite reports every matched row as
 * changed and an already-completed task would inflate the count.
 *
 * Ids that matched nothing, and ids that were already completed, are reported
 * separately so a caller can tell a genuine no-op from a wrong id — a bare
 * count of 0 is ambiguous between the two.
 */
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const body = parseOr400(bulkCompleteSchema, req.body ?? {}, res);
  if (body === null) return;

  // Duplicates would not corrupt the count (SQLite updates a matched row once),
  // but de-duplicating keeps the reported id lists clean.
  const uniqueIds = [...new Set(body.ids)];
  const placeholders = uniqueIds.map(() => '?').join(', ');

  // Read-then-write in one transaction so the reported lists cannot disagree
  // with what was actually written.
  const bulkComplete = db.transaction((targets: number[]) => {
    const found = db
      .prepare(`SELECT id, completed FROM tasks WHERE id IN (${placeholders})`)
      .all(...targets) as Pick<TaskRow, 'id' | 'completed'>[];

    const foundIds = new Set(found.map((row) => row.id));
    const info = db
      .prepare(
        `UPDATE tasks SET completed = 1 WHERE id IN (${placeholders}) AND completed = 0`,
      )
      .run(...targets);

    return {
      updated: info.changes,
      alreadyCompleted: found.filter((row) => row.completed === 1).map((row) => row.id),
      notFound: targets.filter((id) => !foundIds.has(id)),
    };
  });

  res.json(bulkComplete(uniqueIds));
});

/**
 * PATCH /tasks/:id
 * Update any of title, completed, priority or due_date.
 */
tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const body = parseOr400(updateTaskSchema, req.body ?? {}, res);
  if (body === null) return;

  const existing = getStmt.get(id) as TaskRow | undefined;
  if (!existing) {
    return res.status(404).json({ error: `Task ${id} not found.` });
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null): void => {
    updates.push(`${column} = ?`);
    values.push(value);
  };

  if (body.title !== undefined) set('title', body.title);
  if (body.completed !== undefined) set('completed', body.completed ? 1 : 0);
  if (body.priority !== undefined) set('priority', body.priority);
  // `in` rather than an undefined check: an explicit null clears the due date,
  // while an absent key means "leave unchanged".
  if ('due_date' in body) set('due_date', body.due_date ?? null);

  values.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = getStmt.get(id) as TaskRow;
  res.json(toTask(row));
});

/**
 * DELETE /tasks/:id
 * Remove a task.
 */
tasksRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const info = deleteStmt.run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: `Task ${id} not found.` });
  }

  res.status(204).send();
});

export default tasksRouter;
