import { db } from '../src/db.js';
import { createApp } from '../src/app.js';
import type { TaskRow } from '../src/types.js';

// The DB_PATH=:memory: guard lives in tests/setup.ts (runs before src/db.ts is loaded).

export const app = createApp();

type Fixture = Pick<TaskRow, 'id' | 'title' | 'priority' | 'completed' | 'due_date'>;

const fixtures: Fixture[] = [
  { id: 1, title: 'A', priority: 'low', completed: 0, due_date: null },
  { id: 2, title: 'B', priority: 'medium', completed: 1, due_date: null },
  { id: 3, title: 'C', priority: 'high', completed: 0, due_date: null },
  { id: 4, title: 'D', priority: 'high', completed: 1, due_date: null },
  { id: 5, title: 'E', priority: 'medium', completed: 0, due_date: '2026-12-31' },
];

const insertFixture = db.prepare(
  'INSERT INTO tasks (id, title, priority, completed, due_date) VALUES (?, ?, ?, ?, ?)',
);

/** Wipe the tasks table (and its AUTOINCREMENT counter) and load the fixtures. */
export function resetDb(): void {
  db.exec("DELETE FROM tasks; DELETE FROM sqlite_sequence WHERE name='tasks';");
  for (const f of fixtures) {
    insertFixture.run(f.id, f.title, f.priority, f.completed, f.due_date);
  }
}

/** Read a task row straight from the database (undefined if missing). */
export function getRow(id: number): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
}
