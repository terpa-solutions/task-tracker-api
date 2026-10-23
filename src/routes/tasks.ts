import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import { toTask, type TaskRow } from '../types.js';
import {
  bulkCompleteSchema,
  createTaskSchema,
  formatZodError,
  listQuerySchema,
  updateTaskSchema,
} from '../validation.js';

export const tasksRouter = Router();

// Prepared statements (compiled once, reused per request).
const listStmt = db.prepare('SELECT * FROM tasks ORDER BY id ASC');
const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
const insertStmt = db.prepare(
  'INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)',
);
const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');

/**
 * Parse and validate a route `:id` param, returning null when invalid. Only
 * plain positive decimal integers are accepted ("1.0", "1e2", " 1", "0x10" and
 * leading zeros are rejected).
 */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * GET /tasks
 * List tasks, oldest first. Optional query params (combined with AND):
 *   - completed: "true" | "false" (exact, lowercase)
 *   - priority: "low" | "medium" | "high" (case-sensitive)
 * Invalid, empty or repeated values return 400. Unknown params are ignored.
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error));
  }
  const { completed, priority } = parsed.data;

  if (completed === undefined && priority === undefined) {
    const rows = listStmt.all() as TaskRow[];
    return res.json(rows.map(toTask));
  }

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

  const sql = `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY id ASC`;
  const rows = db.prepare(sql).all(...values) as TaskRow[];
  res.json(rows.map(toTask));
});

/**
 * POST /tasks
 * Create a task from { "title": "...", "priority"?: "low"|"medium"|"high",
 * "due_date"?: "YYYY-MM-DD" | null }.
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error));
  }
  const data = parsed.data;

  const info = insertStmt.run(data.title, data.priority ?? 'medium', data.due_date ?? null);
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
});

// Registered before the "/:id" routes so the literal path "/bulk-complete"
// is matched explicitly and never treated as a task id.
/**
 * POST /tasks/bulk-complete
 * Mark several tasks as completed from { "ids": number[] }. Other body fields
 * are ignored. Responds 200 { "updated": n } where n is the number of tasks
 * that actually changed from pending to completed. Tasks that were already
 * completed and unknown ids are ignored and not counted, so repeating the same
 * request returns { "updated": 0 } (all unknown -> { "updated": 0 }, no 404).
 * Duplicate ids are silently deduped.
 * Validation (400, first error wins): "ids" must be a non-empty array, with at
 * most 500 elements (counted before dedupe), each a positive safe integer of
 * type number (no coercion: "3" is rejected). Any invalid id rejects the whole
 * request and nothing is updated.
 */
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const parsed = bulkCompleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error));
  }

  const uniqueIds = [...new Set(parsed.data.ids)];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const info = db
    .prepare(`UPDATE tasks SET completed = 1 WHERE completed = 0 AND id IN (${placeholders})`)
    .run(...uniqueIds);

  res.json({ updated: info.changes });
});

/**
 * PATCH /tasks/:id
 * Update any of title, completed, priority and due_date of a task.
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
    return res.status(400).json(formatZodError(parsed.error));
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
