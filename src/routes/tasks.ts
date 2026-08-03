import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import { PRIORITIES, toTask, type TaskRow } from '../types.js';

export const tasksRouter = Router();

// Prepared statements (compiled once, reused per request).
const listStmt = db.prepare('SELECT * FROM tasks ORDER BY id ASC');
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

/** Narrow an unknown value to one of the allowed priorities. */
function isPriority(value: unknown): boolean {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/**
 * GET /tasks
 * List all tasks, oldest first.
 */
tasksRouter.get('/', (_req: Request, res: Response) => {
  const rows = listStmt.all() as TaskRow[];
  res.json(rows.map(toTask));
});

/**
 * POST /tasks
 * Create a task from { "title": "...", "priority"?: ..., "due_date"?: ... }.
 */
tasksRouter.post('/', (req: Request, res: Response) => {
  const { title, priority, due_date } = req.body ?? {};

  if (typeof title !== 'string' || title.trim().length === 0) {
    return res
      .status(400)
      .json({ error: 'Field "title" is required and must be a non-empty string.' });
  }

  if (priority !== undefined && !isPriority(priority)) {
    return res
      .status(400)
      .json({ error: `Field "priority" must be one of: ${PRIORITIES.join(', ')}.` });
  }

  if (due_date !== undefined && due_date !== null && typeof due_date !== 'string') {
    return res
      .status(400)
      .json({ error: 'Field "due_date" must be an ISO date string or null.' });
  }

  const info = insertStmt.run(
    title.trim(),
    (priority as string | undefined) ?? 'medium',
    (due_date as string | null | undefined) ?? null,
  );
  const row = getStmt.get(info.lastInsertRowid) as TaskRow;
  res.status(201).json(toTask(row));
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

  const existing = getStmt.get(id) as TaskRow | undefined;
  if (!existing) {
    return res.status(404).json({ error: `Task ${id} not found.` });
  }

  const { title, completed, priority, due_date } = req.body ?? {};
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      return res
        .status(400)
        .json({ error: 'Field "title" must be a non-empty string.' });
    }
    updates.push('title = ?');
    values.push(title.trim());
  }

  if (completed !== undefined) {
    if (typeof completed !== 'boolean') {
      return res
        .status(400)
        .json({ error: 'Field "completed" must be a boolean.' });
    }
    updates.push('completed = ?');
    values.push(completed ? 1 : 0);
  }

  if (priority !== undefined) {
    if (!isPriority(priority)) {
      return res
        .status(400)
        .json({ error: `Field "priority" must be one of: ${PRIORITIES.join(', ')}.` });
    }
    updates.push('priority = ?');
    values.push(priority as string);
  }

  // An explicit null clears the due date; that is why this branch accepts null
  // but the `undefined` check above still means "field not supplied".
  if (due_date !== undefined) {
    if (due_date !== null && typeof due_date !== 'string') {
      return res
        .status(400)
        .json({ error: 'Field "due_date" must be an ISO date string or null.' });
    }
    updates.push('due_date = ?');
    values.push(due_date as string | null);
  }

  if (updates.length === 0) {
    return res.status(400).json({
      error:
        'Provide at least one of "title", "completed", "priority" or "due_date" to update.',
    });
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
