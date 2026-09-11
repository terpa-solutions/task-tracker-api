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
 * Where the database lives. `DATABASE_PATH` lets tests point at a throwaway
 * file or `:memory:` instead of the developer's real database.
 */
export const dbPath =
  process.env.DATABASE_PATH ?? path.join(projectRoot, 'data', 'tasks.db');

// Ensure the parent directory exists before opening the file. `:memory:` is
// not a path, so there is nothing to create.
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

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
 * Add columns introduced after the initial release. `schema.sql` only runs
 * `CREATE TABLE IF NOT EXISTS`, so a database file created before those columns
 * existed would otherwise keep the old shape and every query would fail.
 * Checking `PRAGMA table_info` first keeps this safe to run on every start.
 */
function migrate(): void {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  const existing = new Set(columns.map((column) => column.name));

  if (!existing.has('priority')) {
    db.exec(
      "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'))",
    );
  }

  if (!existing.has('due_date')) {
    db.exec(
      "ALTER TABLE tasks ADD COLUMN due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')",
    );
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
