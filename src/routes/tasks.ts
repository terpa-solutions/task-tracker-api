import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import {
  bulkCompleteSchema,
  createTaskSchema,
  listQuerySchema,
  toErrorResponse,
  updateTaskSchema,
} from '../schemas.js';
import { toTask, type TaskRow } from '../types.js';

export const tasksRouter = Router();

// Prepared statements (compiled once, reused per request).
const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
const insertStmt = db.prepare(
  'INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)',
);
const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');

/**
 * Parse and validate a route `:id` param, returning null when invalid.
 *
 * The digits-only check is what keeps `Number`'s leniency out: on its own it
 * reads "0x10" as 16, "1e3" as 1000 and " 5 " as 5, so several different URLs
 * would resolve to the same task. The safe-integer check rejects ids too large
 * to round-trip, which would otherwise reach the driver as a silently
 * different number.
 */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * GET /tasks
 * List tasks, oldest first. Supports `?completed=true|false` and
 * `?priority=low|medium|high`, which can be combined.
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(toErrorResponse(parsed.error));
  }

  const { completed, priority } = parsed.data;
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (completed !== undefined) {
    conditions.push('completed = ?');
    values.push(completed === 'true' ? 1 : 0);
  }

  if (priority !== undefined) {
    conditions.push('priority = ?');
    values.push(priority);
  }

  // The WHERE clause varies per request, so the statement is prepared here
  // rather than once at module load. Values stay bound as parameters.
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks${where} ORDER BY id ASC`)
    .all(...values) as TaskRow[];

  res.json(rows.map(toTask));
});

/**
 * GET /tasks/:id
 * Fetch a single task.
 */
tasksRouter.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const row = getStmt.get(id) as TaskRow | undefined;
  if (!row) {
    return res.status(404).json({ error: `Task ${id} not found.` });
  }

  res.json(toTask(row));
});

/**
 * POST /tasks
 * Create a task. `title` is required; `priority` and `due_date` are optional.
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(toErrorResponse(parsed.error));
  }

  const { title, priority, due_date } = parsed.data;
  const info = insertStmt.run(title, priority, due_date);
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
});

/**
 * POST /tasks/bulk-complete
 * Mark every task listed in { "ids": [1, 2, 3] } as completed.
 *
 * Responds with the number of tasks that actually changed: ids that do not
 * exist, and tasks that were already completed, are skipped and not counted.
 */
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const parsed = bulkCompleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(toErrorResponse(parsed.error));
  }

  const { ids } = parsed.data;
  const placeholders = ids.map(() => '?').join(', ');
  const info = db
    .prepare(
      `UPDATE tasks SET completed = 1 WHERE id IN (${placeholders}) AND completed = 0`,
    )
    .run(...ids);

  res.json({ updated: info.changes });
});

/**
 * PATCH /tasks/:id
 * Update any subset of a task's title, completed state, priority or due date.
 */
tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  const existing = getStmt.get(id) as TaskRow | undefined;
  if (!existing) {
    return res.status(404).json({ error: `Task ${id} not found.` });
  }

  const parsed = updateTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(toErrorResponse(parsed.error));
  }

  const { title, completed, priority, due_date } = parsed.data;
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (title !== undefined) {
    updates.push('title = ?');
    values.push(title);
  }

  if (completed !== undefined) {
    updates.push('completed = ?');
    values.push(completed ? 1 : 0);
  }

  if (priority !== undefined) {
    updates.push('priority = ?');
    values.push(priority);
  }

  // `null` is meaningful here: it clears an existing due date.
  if (due_date !== undefined) {
    updates.push('due_date = ?');
    values.push(due_date);
  }

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
