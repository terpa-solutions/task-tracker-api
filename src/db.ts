import Database, { type Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the project root from this file's location (src/db.ts lives one
 * directory below the root). `__dirname` is not available under ESM, so we
 * derive it from `import.meta.url`.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const schemaPath = path.join(projectRoot, 'schema.sql');
const seedPath = path.join(projectRoot, 'seed.sql');

/**
 * Where the database file lives.
 *
 * Defaults to `data/tasks.db` at the project root. `TASKS_DB_PATH` overrides it
 * so the test suite can point at a throwaway file per run instead of mutating
 * the database you have been poking at by hand — a test that wipes your dev
 * data is a test you stop running.
 */
const dbPath = process.env.TASKS_DB_PATH ?? path.join(projectRoot, 'data', 'tasks.db');

// Ensure the parent directory exists before opening the database file.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Open (or create) the SQLite database file.
export const db: DatabaseType = new Database(dbPath);

// Recommended pragmas for a local, single-file app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Apply the schema on every start. `schema.sql` uses `CREATE TABLE IF NOT
 * EXISTS`, so this is safe to run repeatedly.
 */
function applySchema(): void {
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
}

/**
 * Bring an already-existing `tasks` table up to date with `schema.sql`.
 *
 * `schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so on a database created by
 * an older version of this app the statement is a no-op and newly declared
 * columns would never appear. Databases predate code changes, so we add any
 * missing column explicitly.
 *
 * Adding a column is driven by `PRAGMA table_info`, which makes this safe to
 * run on every start: existing rows pick up the column default (`'medium'` for
 * priority, `NULL` for due_date) and a second run finds nothing to do.
 */
function migrate(): void {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  const existing = new Set(columns.map((column) => column.name));

  const additions: Record<string, string> = {
    priority: "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'))",
    due_date: 'ALTER TABLE tasks ADD COLUMN due_date TEXT',
  };

  for (const [column, statement] of Object.entries(additions)) {
    if (!existing.has(column)) {
      db.exec(statement);
      console.log(`🛠️  Migrated: added column "${column}" to tasks`);
    }
  }
}

/**
 * Seed sample data, but only when the tasks table is empty. This gives a fresh
 * clone immediate data to play with without duplicating rows on restart.
 */
function seedIfEmpty(): void {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as {
    count: number;
  };

  if (count === 0) {
    const seed = fs.readFileSync(seedPath, 'utf-8');
    db.exec(seed);
  }
}

applySchema();
migrate();
seedIfEmpty();

export default db;
