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
 * Database location: `DB_PATH` if set and non-empty (relative paths resolve
 * against the cwd; `:memory:` opens an in-memory database), else
 * `data/tasks.db` (also when `DB_PATH` is the empty string).
 */
export const dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'tasks.db');
const schemaPath = path.join(projectRoot, 'schema.sql');
const seedPath = path.join(projectRoot, 'seed.sql');

// Ensure the parent directory exists before opening the database file.
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// Open (or create) the SQLite database (file or in-memory).
export const db: DatabaseType = new Database(dbPath);

// Recommended pragmas for a local, single-file app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Apply the schema on every start. `schema.sql` uses `CREATE TABLE IF NOT
 * EXISTS`, so this is safe to run repeatedly. Note that it does NOT alter an
 * already existing table: adding columns to older databases is done by
 * `migrate()`.
 */
function applySchema(): void {
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
}

/**
 * Columns added after the original schema, as [name, column definition].
 * Keep in sync with `schema.sql`: every column here must also be declared in
 * the CREATE TABLE there (with the same definition) for fresh databases.
 */
const addedColumns: [string, string][] = [
  [
    'priority',
    "priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'))",
  ],
  ['due_date', 'due_date TEXT'],
];

/**
 * Bring an existing `tasks` table up to date by adding any missing columns.
 * Idempotent: columns already present are skipped, so it is safe on every
 * start and a no-op for databases freshly created from `schema.sql`.
 */
function migrate(): void {
  const run = db.transaction(() => {
    const columns = db.pragma('table_info(tasks)') as { name: string }[];
    const existing = new Set(columns.map((c) => c.name));

    for (const [name, ddl] of addedColumns) {
      if (!existing.has(name)) {
        db.exec(`ALTER TABLE tasks ADD COLUMN ${ddl}`);
      }
    }
  });
  run();
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
