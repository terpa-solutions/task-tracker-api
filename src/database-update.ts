import Database, { type Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertTaskSchema, DatabaseContractError, taskColumns, type Column } from './database-contract.js';

type Row = Record<string, unknown>;

export interface TaskSnapshot {
  columns: Column[];
  rows: Row[];
  sequence: unknown;
}

export class DatabaseUpdateError extends Error {
  constructor(
    public readonly stage: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DatabaseUpdateError';
  }
}

function atStage<T>(stage: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DatabaseUpdateError) throw error;
    throw new DatabaseUpdateError(
      stage,
      error instanceof Error ? error.message : String(error),
      error instanceof DatabaseContractError ? error.details : {},
      { cause: error },
    );
  }
}

function originalTaskColumns(db: DatabaseType): Column[] {
  const columns = taskColumns(db);
  for (const required of ['id', 'title', 'completed', 'created_at']) {
    if (!columns.some((column) => column.name === required)) {
      throw new DatabaseUpdateError('lectura.esquema', 'Falta una columna original requerida.', {
        table: 'tasks', field: required, expected: 'columna original existente', actual: null,
      });
    }
  }
  return columns;
}

/** Capture all columns and exact integers independently of the connection defaults. */
export function captureTasks(db: DatabaseType): TaskSnapshot {
  const columns = originalTaskColumns(db);
  const hasSequence = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
  ).get();
  const sequence = hasSequence
    ? (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'").safeIntegers(true).get() as Row | undefined)?.seq
    : undefined;
  return {
    columns,
    rows: db.prepare(`SELECT ${columns.map((column) => `"${column.name.replaceAll('"', '""')}"`).join(', ')} FROM tasks ORDER BY id`).safeIntegers(true).all() as Row[],
    sequence: sequence ?? null,
  };
}

export function assertTasksPreserved(
  reference: TaskSnapshot,
  db: DatabaseType,
  stage: string,
): TaskSnapshot {
  const actual = atStage(stage, () => captureTasks(db));
  for (const column of reference.columns) {
    const found = actual.columns.find((candidate) => candidate.name === column.name);
    if (!isDeepStrictEqual(found, column)) {
      throw new DatabaseUpdateError(stage, 'Se modificó una columna existente.', {
        table: 'tasks', field: column.name, expected: column, actual: found ?? null,
      });
    }
  }
  if (actual.rows.length !== reference.rows.length) {
    throw new DatabaseUpdateError(stage, 'Cambió el número de tareas.', {
      table: 'tasks', field: 'count', expected: reference.rows.length, actual: actual.rows.length,
    });
  }
  const rowsById = new Map(actual.rows.map((row) => [String(row.id), row]));
  for (const original of reference.rows) {
    const row = rowsById.get(String(original.id));
    if (!row) {
      throw new DatabaseUpdateError(stage, 'Falta una tarea del respaldo.', {
        table: 'tasks', field: 'id', taskId: original.id, expected: original.id, actual: null,
      });
    }
    for (const column of reference.columns) {
      if (!isDeepStrictEqual(row[column.name], original[column.name])) {
        throw new DatabaseUpdateError(stage, 'Cambió un valor existente.', {
          table: 'tasks', taskId: original.id, field: column.name,
          expected: original[column.name], actual: row[column.name],
        });
      }
    }
  }
  if (!isDeepStrictEqual(actual.sequence, reference.sequence)) {
    throw new DatabaseUpdateError(stage, 'Cambió la secuencia de identificadores.', {
      table: 'sqlite_sequence', field: 'seq', expected: reference.sequence, actual: actual.sequence,
    });
  }
  return actual;
}

function assertIntegrity(db: DatabaseType, stage: string): void {
  atStage(stage, () => {
    const integrity = db.pragma('integrity_check') as Row[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new DatabaseUpdateError(stage, 'SQLite reportó un problema de integridad.', { integrity });
    }
    const foreignKeys = db.pragma('foreign_key_check') as Row[];
    if (foreignKeys.length !== 0) {
      throw new DatabaseUpdateError(stage, 'SQLite reportó referencias inválidas.', { foreignKeys });
    }
  });
}

/** All schema changes and checks run in one write transaction; any error rolls it back. */
export function applyVerifiedTaskUpdate(db: DatabaseType, reference: TaskSnapshot): string[] {
  return atStage('transaccion', () => db.transaction(() => {
    // Detect changes to the captured tasks and sequence after the backup.
    assertTasksPreserved(reference, db, 'comparacion.previa');
    atStage('verificacion.esquema_previo', () => assertTaskSchema(db, true));
    const addedColumns: string[] = [];
    const additions = [
      {
        name: 'priority',
        sql: "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'))",
        value: 'medium',
      },
      { name: 'due_date', sql: 'ALTER TABLE tasks ADD COLUMN due_date TEXT DEFAULT NULL', value: null },
    ];
    for (const addition of additions) {
      const existing = reference.columns.find(
        (column) => column.name.toLowerCase() === addition.name,
      );
      if (existing && existing.name !== addition.name) {
        throw new DatabaseUpdateError(`esquema.${addition.name}`, 'El nombre existente usa otra capitalización.', {
          table: 'tasks', field: existing.name, expected: addition.name, actual: existing.name,
        });
      }
      if (!existing) {
        atStage(`esquema.${addition.name}`, () => db.exec(addition.sql));
        addedColumns.push(addition.name);
      }
    }
    atStage('verificacion.esquema_final', () => assertTaskSchema(db));
    const updated = assertTasksPreserved(reference, db, 'comparacion.posterior');
    for (const addition of additions.filter((item) => addedColumns.includes(item.name))) {
      for (const row of updated.rows) {
        if (row[addition.name] !== addition.value) {
          throw new DatabaseUpdateError('comparacion.valores_nuevos', 'Un campo nuevo no tiene el valor esperado.', {
            table: 'tasks', taskId: row.id, field: addition.name,
            expected: addition.value, actual: row[addition.name],
          });
        }
      }
    }
    assertIntegrity(db, 'verificacion.integridad_final');
    return addedColumns;
  }).immediate());
}

function backupFilename(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  return `tasks-${date}_${time}-${randomUUID()}.db`;
}

export async function backupAndUpdateDatabase(databasePath: string, backupDirectory: string) {
  let stage = 'apertura';
  let db: DatabaseType | undefined;
  let backup: DatabaseType | undefined;
  let backupPath: string | undefined;
  try {
    const source = new Database(databasePath, { fileMustExist: true });
    db = source;
    db.defaultSafeIntegers(true);
    assertIntegrity(db, 'verificacion.integridad_original');
    // Check required columns here; the preserved row snapshot comes from the backup.
    atStage('lectura.original', () => originalTaskColumns(source));

    stage = 'respaldo';
    fs.mkdirSync(backupDirectory, { recursive: true });
    backupPath = path.join(backupDirectory, backupFilename());
    // Reserve the name exclusively; never overwrite an earlier backup.
    fs.closeSync(fs.openSync(backupPath, 'wx'));
    // SQLite's backup API includes committed WAL data; copying tasks.db alone does not.
    await db.backup(backupPath);
    backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    backup.defaultSafeIntegers(true);
    assertIntegrity(backup, 'verificacion.integridad_respaldo');
    const reference = atStage('lectura.respaldo', () => captureTasks(backup!));

    const addedColumns = applyVerifiedTaskUpdate(db, reference);
    return {
      status: 'ok',
      databasePath,
      backupPath,
      addedColumns,
      preservedTasks: reference.rows.length,
      preservedColumns: reference.columns.map((column) => column.name),
      preservedIdSequence: true,
      integrity: 'ok',
    };
  } catch (error) {
    const failure = error instanceof DatabaseUpdateError
      ? error
      : new DatabaseUpdateError(stage, error instanceof Error ? error.message : String(error), {}, { cause: error });
    failure.details.databasePath = databasePath;
    if (backupPath) failure.details.backupPath = backupPath;
    throw failure;
  } finally {
    backup?.close();
    db?.close();
  }
}
