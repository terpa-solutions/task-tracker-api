import { Router, type Request, type Response } from 'express';
import db from '../db.js';
import { PRIORITIES, toTask, type TaskRow } from '../types.js';

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

/** Narrow an unknown value to one of the allowed priorities. */
function isPriority(value: unknown): boolean {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/**
 * GET /tasks
 * List tasks, oldest first, optionally filtered.
 *
 * Supported query params, which combine with AND:
 *   ?completed=true|false
 *   ?priority=low|medium|high
 *
 * Unknown query params are ignored rather than rejected, so clients can pass
 * along things like cache-busting params without breaking. Filter values are
 * bound as SQL parameters — only the shape of the WHERE clause is interpolated,
 * never user input.
 */
tasksRouter.get('/', (req: Request, res: Response) => {
  const { completed, priority } = req.query;
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (completed !== undefined) {
    if (completed !== 'true' && completed !== 'false') {
      return res
        .status(400)
        .json({ error: 'Query param "completed" must be either "true" or "false".' });
    }
    conditions.push('completed = ?');
    values.push(completed === 'true' ? 1 : 0);
  }

  if (priority !== undefined) {
    if (!isPriority(priority)) {
      return res.status(400).json({
        error: `Query param "priority" must be one of: ${PRIORITIES.join(', ')}.`,
      });
    }
    conditions.push('priority = ?');
    values.push(priority as string);
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
 * Upper bound on how many ids one bulk-complete call may carry.
 *
 * SQLite refuses a statement with more than 32766 bound parameters, so an
 * unbounded list would surface as a 500. 1000 stays well clear of that while
 * being far more than this endpoint realistically needs, and callers get a
 * clear 400 instead of a crash.
 */
const BULK_COMPLETE_MAX_IDS = 1000;

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
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res
      .status(400)
      .json({ error: 'Field "ids" is required and must be a non-empty array of task ids.' });
  }

  if (ids.length > BULK_COMPLETE_MAX_IDS) {
    return res.status(400).json({
      error: `Field "ids" must contain at most ${BULK_COMPLETE_MAX_IDS} ids (received ${ids.length}).`,
    });
  }

  if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
    return res
      .status(400)
      .json({ error: 'Field "ids" must contain only positive integers.' });
  }

  // Duplicates would not corrupt the count (SQLite updates a matched row once),
  // but de-duplicating keeps the reported id lists clean.
  const uniqueIds = [...new Set(ids as number[])];
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
