import Database, { type Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTaskIds, assertTaskSchema } from './database-contract.js';

/**
 * Resolve the project root from this file's location (src/db.ts lives one
 * directory below the root). `__dirname` is not available under ESM, so we
 * derive it from `import.meta.url`.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface DatabaseOptions {
  filename?: string;
  schemaPath?: string;
  seedPath?: string;
}

/** Open and initialize only when called. The caller owns closing the connection. */
export function openDatabase({
  filename = path.join(projectRoot, 'data', 'tasks.db'),
  schemaPath = path.join(projectRoot, 'schema.sql'),
  seedPath = path.join(projectRoot, 'seed.sql'),
}: DatabaseOptions = {}): DatabaseType {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.transaction(() => {
      // Existing empty tables retain their rows and AUTOINCREMENT sequence.
      const tasksTableExisted = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks' COLLATE NOCASE",
      ).get() !== undefined;
      db.exec(fs.readFileSync(schemaPath, 'utf-8'));
      // Validate before seeding, so a legacy or incompatible database stays intact.
      assertTaskSchema(db);
      assertTaskIds(db);
      if (!tasksTableExisted) db.exec(fs.readFileSync(seedPath, 'utf-8'));
      assertTaskIds(db);
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
