import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import {
  bulkCompleteSchema,
  createTaskSchema,
  listTasksQuerySchema,
  taskIdSchema,
  updateTaskSchema,
} from '../schemas.js';
import { toTask, type TaskRow } from '../types.js';
import { sendValidationError } from '../validation.js';

export const tasksRouter = Router();

// Prepared statements (compiled once, reused per request).
const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
const insertStmt = db.prepare(
  'INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)',
);
const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');
// The id list is passed as one JSON parameter so its length is not bounded by
// SQLite's host-parameter limit.
const bulkCompleteStmt = db.prepare(
  'UPDATE tasks SET completed = 1 WHERE completed = 0 AND id IN (SELECT value FROM json_each(?))',
);
const missingIdsStmt = db.prepare(
  'SELECT value AS id FROM json_each(?) WHERE value NOT IN (SELECT id FROM tasks) ORDER BY key',
);

const bulkComplete = db.transaction((ids: number[]) => {
  const json = JSON.stringify(ids);
  const missing = (missingIdsStmt.all(json) as { id: number }[]).map((row) => row.id);
  const notFound = [...new Set(missing)];
  const { changes } = bulkCompleteStmt.run(json);
  return { updated: changes, not_found: notFound };
});

/**
 * GET /tasks
 * List tasks, oldest first. Optional filters, combinable with AND:
 *   ?completed=true|false
 *   ?priority=low|medium|high
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const query = listTasksQuerySchema.safeParse(req.query);
  if (!query.success) {
    return sendValidationError(res, query.error, 'Invalid query parameters.');
  }

  const { completed, priority } = query.data;
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (completed !== undefined) {
    conditions.push('completed = ?');
    values.push(completed ? 1 : 0);
  }

  if (priority !== undefined) {
    conditions.push('priority = ?');
    values.push(priority);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY id ASC`)
    .all(...values) as TaskRow[];
  res.json(rows.map(toTask));
});

/**
 * POST /tasks
 * Create a task from { "title": "...", "priority"?: "...", "due_date"?: "<ISO 8601>" }.
 * `due_date` is stored normalized to UTC (`toISOString()` form).
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const body = createTaskSchema.safeParse(req.body);
  if (!body.success) {
    return sendValidationError(res, body.error, 'Invalid request body.');
  }

  const { title, priority, due_date } = body.data;
  const info = insertStmt.run(title, priority, due_date);
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
});

/**
 * POST /tasks/bulk-complete
 * Mark every task in { "ids": number[] } as completed and return
 * { "updated": n, "not_found": number[] }. `updated` counts tasks that changed
 * from open to completed; already-completed ids are skipped silently and ids
 * with no task are listed in `not_found` (in request order, once each).
 */
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const body = bulkCompleteSchema.safeParse(req.body);
  if (!body.success) {
    return sendValidationError(res, body.error, 'Invalid request body.');
  }

  res.json(bulkComplete(body.data.ids));
});

/**
 * PATCH /tasks/:id
 * Partially update a task's title, completed, priority and/or due_date.
 * Sending `"due_date": null` clears the due date.
 */
tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const id = taskIdSchema.safeParse(req.params.id);
  if (!id.success) {
    return sendValidationError(res, id.error, 'Invalid task id.');
  }

  const existing = getStmt.get(id.data) as TaskRow | undefined;
  if (!existing) {
    return res.status(404).json({ error: `Task ${id.data} not found.` });
  }

  const body = updateTaskSchema.safeParse(req.body);
  if (!body.success) {
    return sendValidationError(res, body.error, 'Invalid request body.');
  }

  const { title, completed, priority, due_date } = body.data;
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

  if (due_date !== undefined) {
    updates.push('due_date = ?');
    values.push(due_date);
  }

  values.push(id.data);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = getStmt.get(id.data) as TaskRow;
  res.json(toTask(row));
});

/**
 * DELETE /tasks/:id
 * Remove a task.
 */
tasksRouter.delete('/:id', (req: Request, res: Response) => {
  const id = taskIdSchema.safeParse(req.params.id);
  if (!id.success) {
    return sendValidationError(res, id.error, 'Invalid task id.');
  }

  const info = deleteStmt.run(id.data);
  if (info.changes === 0) {
    return res.status(404).json({ error: `Task ${id.data} not found.` });
  }

  res.status(204).send();
});

export default tasksRouter;
