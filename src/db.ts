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

/**
 * `DB_PATH` overrides the database location; tests set it to `:memory:` so
 * they never touch `data/tasks.db`.
 */
export const dbPath = process.env.DB_PATH ?? path.join(projectRoot, 'data', 'tasks.db');
const schemaPath = path.join(projectRoot, 'schema.sql');
const seedPath = path.join(projectRoot, 'seed.sql');

// Ensure the parent directory exists before opening a database file.
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
 * Bring databases created before a column existed up to date. `CREATE TABLE IF
 * NOT EXISTS` never alters an existing table, so new columns must be added
 * here as well as in `schema.sql`.
 */
const columnMigrations: Record<string, string> = {
  priority:
    "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'))",
  due_date: 'ALTER TABLE tasks ADD COLUMN due_date TEXT',
};

function migrate(): void {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  const existing = new Set(columns.map((column) => column.name));

  for (const [name, sql] of Object.entries(columnMigrations)) {
    if (!existing.has(name)) {
      db.exec(sql);
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
