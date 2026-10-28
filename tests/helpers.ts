import db from '../src/db.js';
import type { Priority } from '../src/types.js';

interface Fixture {
  title: string;
  completed: boolean;
  priority: Priority;
}

/**
 * Known starting state shared by the tests, with every completed/priority
 * combination that the filters need to tell apart.
 */
export const FIXTURES: Fixture[] = [
  { title: 'open high', completed: false, priority: 'high' },
  { title: 'done high', completed: true, priority: 'high' },
  { title: 'open medium', completed: false, priority: 'medium' },
  { title: 'done low', completed: true, priority: 'low' },
  { title: 'open low', completed: false, priority: 'low' },
];

const insertStmt = db.prepare(
  'INSERT INTO tasks (title, completed, priority) VALUES (?, ?, ?)',
);

/** Replace all rows with FIXTURES, ids restarting at 1 in fixture order. */
export const resetTasks = db.transaction(() => {
  db.exec("DELETE FROM tasks; DELETE FROM sqlite_sequence WHERE name = 'tasks';");
  for (const { title, completed, priority } of FIXTURES) {
    insertStmt.run(title, completed ? 1 : 0, priority);
  }
});

/** Read completion straight from the database, bypassing the API. */
export function completedIdsInDb(): number[] {
  const rows = db
    .prepare('SELECT id FROM tasks WHERE completed = 1 ORDER BY id')
    .all() as { id: number }[];
  return rows.map((row) => row.id);
}
