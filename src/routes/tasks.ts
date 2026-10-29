import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import { toTask, type TaskRow } from '../types.js';
import {
  BulkCompleteSchema,
  CreateTaskSchema,
  TaskQuerySchema,
  UpdateTaskSchema,
  zodError,
} from '../validation.js';

export const tasksRouter = Router();

/** Prepared statement to fetch a single task by its primary key. */
const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');

/** Prepared statement to remove a task by its primary key. */
const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');

/**
 * Parse and validate a route `:id` param.
 * Returns null when the value is not a positive integer, triggering a 400 response.
 */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET /tasks
 * List tasks ordered by id ascending.
 * Supports optional query filters: ?completed=true|false and ?priority=low|medium|high.
 * Filters can be combined.
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const parsed = TaskQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(zodError(parsed.error));

  const { completed, priority } = parsed.data;
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (completed !== undefined) {
    conditions.push('completed = ?');
    params.push(completed === 'true' ? 1 : 0);
  }
  if (priority !== undefined) {
    conditions.push('priority = ?');
    params.push(priority);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY id ASC`)
    .all(...params) as TaskRow[];
  res.json(rows.map(toTask));
});

/**
 * POST /tasks/bulk-complete
 * Mark multiple tasks as completed in a single query.
 * Returns { updated: N } where N is the number of rows that actually changed.
 * Tasks already completed or with non-existent ids are not counted.
 * Registered before /:id to prevent Express from treating "bulk-complete" as a numeric id.
 */
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const parsed = BulkCompleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(zodError(parsed.error));

  const { ids } = parsed.data;
  const placeholders = ids.map(() => '?').join(', ');
  const info = db
    .prepare(`UPDATE tasks SET completed = 1 WHERE id IN (${placeholders}) AND completed = 0`)
    .run(...ids);
  res.json({ updated: info.changes });
});

/**
 * POST /tasks
 * Create a new task from { title, priority?, due_date? }.
 * `priority` defaults to 'medium' when not provided.
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(zodError(parsed.error));

  const { title, priority, due_date } = parsed.data;
  const info = db
    .prepare('INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)')
    .run(title, priority, due_date ?? null);
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
});

/**
 * PATCH /tasks/:id
 * Partially update a task. Accepts any combination of title, completed, priority, due_date.
 * At least one field must be present (enforced by UpdateTaskSchema).
 */
tasksRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid task id.' });

  const existing = getStmt.get(id) as TaskRow | undefined;
  if (!existing) return res.status(404).json({ error: `Task ${id} not found.` });

  const parsed = UpdateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(zodError(parsed.error));

  const data = parsed.data;
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.completed !== undefined) {
    updates.push('completed = ?');
    values.push(data.completed ? 1 : 0);
  }
  if (data.priority !== undefined) {
    updates.push('priority = ?');
    values.push(data.priority);
  }
  if (data.due_date !== undefined) {
    updates.push('due_date = ?');
    values.push(data.due_date ?? null);
  }

  values.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = getStmt.get(id) as TaskRow;
  res.json(toTask(row));
});

/**
 * DELETE /tasks/:id
 * Permanently remove a task. Returns 404 if the id does not exist.
 */
tasksRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid task id.' });

  const info = deleteStmt.run(id);
  if (info.changes === 0) return res.status(404).json({ error: `Task ${id} not found.` });

  res.status(204).send();
});

export default tasksRouter;
