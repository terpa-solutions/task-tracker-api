import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import {
  applyVerifiedTaskUpdate,
  assertTasksPreserved,
  backupAndUpdateDatabase,
  captureTasks,
  DatabaseUpdateError,
} from '../src/database-update.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturesRoot = path.join(projectRoot, 'data', 'test-database-update');
const legacySchema = `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function fixture(t: TestContext) {
  fs.mkdirSync(fixturesRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(fixturesRoot, 'case-'));
  const databasePath = path.join(directory, 'tasks.db');
  const backupDirectory = path.join(directory, 'backups');
  const connections: DatabaseType[] = [];
  const open = (filename = databasePath, readonly = false) => {
    const db = new Database(filename, { readonly });
    db.defaultSafeIntegers(true);
    connections.push(db);
    return db;
  };
  t.after(() => {
    for (const db of connections) if (db.open) db.close();
    // Only remove the temporary case directory created by this test.
    const resolved = fs.realpathSync(directory);
    const root = fs.realpathSync(fixturesRoot);
    assert.ok(resolved.startsWith(root + path.sep));
    assert.ok(path.basename(resolved).startsWith('case-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, databasePath, backupDirectory, open };
}

function seedLegacy(db: DatabaseType) {
  db.exec(legacySchema);
  const insert = db.prepare('INSERT INTO tasks (id, title, completed, created_at) VALUES (?, ?, ?, ?)');
  insert.run(7, 'Informe: revisión de México', 1, '2020-02-29 23:59:59');
  insert.run(42, 'Conservar "comillas" y espacios  ', 0, '2021-01-01 00:00:00');
  // The next id must not reset to MAX(id) after a migration.
  insert.run(200, 'Tarea eliminada previamente', 0, '2021-01-02 00:00:00');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(200);
}

function initializeApp(appRoot: string) {
  const entrypoint = path.join(appRoot, 'initialize.ts');
  fs.writeFileSync(entrypoint, "import { openDatabase } from './src/db.js';\nopenDatabase().close();\n");
  return execFileSync(process.execPath, ['--import', 'tsx', entrypoint], {
    cwd: appRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true,
  });
}

test('captura enteros exactos y metadatos iguales sin depender de defaultSafeIntegers', async (t) => {
  const f = fixture(t);
  const db = f.open();
  db.defaultSafeIntegers(false);
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN external_number INTEGER');
  db.prepare('UPDATE tasks SET external_number = ? WHERE id = ?').run(9007199254740992n, 7);
  db.prepare('UPDATE tasks SET external_number = ? WHERE id = ?').run(9007199254740993n, 42);
  db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'tasks'").run(9007199254740993n);

  const original = captureTasks(db);
  assert.deepEqual(original.rows.map(row => row.external_number), [9007199254740992n, 9007199254740993n]);
  assert.equal(original.sequence, 9007199254740993n);
  assert.ok(original.columns.every(column => typeof column.cid === 'bigint' && typeof column.notnull === 'bigint' && typeof column.hidden === 'bigint'));
  const exactConnection = f.open();
  assert.deepEqual(captureTasks(exactConnection), original);
  assert.deepEqual(assertTasksPreserved(original, exactConnection, 'prueba.defaults'), original);
  assert.equal(typeof (db.prepare('SELECT id FROM tasks ORDER BY id LIMIT 1').get() as { id: unknown }).id, 'number');

  const report = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.deepEqual(captureTasks(f.open(report.backupPath, true)), original);
  const migrated = assertTasksPreserved(original, db, 'prueba.migracion_exacta');
  assert.deepEqual(migrated.rows.map(row => row.external_number), [9007199254740992n, 9007199254740993n]);
  assert.equal(migrated.sequence, 9007199254740993n);
});

test('detecta diferencias de enteros grandes aunque Number las redondearía al mismo valor', async (t) => {
  for (const field of ['external_number', 'seq']) {
    await t.test(field, (subtest) => {
      const f = fixture(subtest);
      const db = f.open();
      db.defaultSafeIntegers(false);
      seedLegacy(db);
      db.exec('ALTER TABLE tasks ADD COLUMN external_number INTEGER');
      db.prepare('UPDATE tasks SET external_number = ? WHERE id = ?').run(9007199254740992n, 7);
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'tasks'").run(9007199254740992n);
      const original = captureTasks(db);
      if (field === 'external_number') {
        db.prepare('UPDATE tasks SET external_number = ? WHERE id = ?').run(9007199254740993n, 7);
      } else {
        db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'tasks'").run(9007199254740993n);
      }
      assert.throws(() => assertTasksPreserved(original, db, 'comparacion.previa'), (error) => {
        assert.ok(error instanceof DatabaseUpdateError);
        assert.equal(error.stage, 'comparacion.previa');
        assert.equal(error.details.table, field === 'seq' ? 'sqlite_sequence' : 'tasks');
        assert.equal(error.details.field, field);
        assert.equal(error.details.expected, 9007199254740992n);
        assert.equal(error.details.actual, 9007199254740993n);
        if (field === 'external_number') assert.equal(error.details.taskId, 7n);
        return true;
      });
    });
  }
});

test('el esquema original incompleto falla antes de crear el respaldo', async (t) => {
  const f = fixture(t);
  const db = f.open();
  db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  await assert.rejects(backupAndUpdateDatabase(f.databasePath, f.backupDirectory), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'lectura.esquema');
    assert.equal(error.details.field, 'completed');
    assert.equal(error.details.expected, 'columna original existente');
    assert.equal(error.details.actual, null);
    return true;
  });
  assert.equal(fs.existsSync(f.backupDirectory), false);
});

test('respalda datos confirmados en WAL y conserva columnas, filas y secuencia', async (t) => {
  const f = fixture(t);
  const db = f.open();
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN notes BLOB');
  db.prepare('UPDATE tasks SET notes = ? WHERE id = 7').run(Buffer.from([0, 1, 255]));
  const original = captureTasks(db);
  assert.ok(fs.statSync(f.databasePath + '-wal').size > 0);

  const report = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.deepEqual(report.addedColumns, ['priority', 'due_date']);
  assert.equal(report.preservedTasks, 2);
  assert.equal(report.integrity, 'ok');
  const backup = f.open(report.backupPath, true);
  assert.deepEqual(captureTasks(backup), original);
  const actual = assertTasksPreserved(original, db, 'prueba.comparacion');
  for (const row of actual.rows) {
    assert.equal(row.priority, 'medium');
    assert.equal(row.due_date, null);
  }
  assert.equal(actual.sequence, 200n);
  assert.throws(() => db.prepare("INSERT INTO tasks (title, priority) VALUES ('inválida', 'urgent')").run());
});

test('cada ejecución crea otro respaldo y conserva valores nuevos ya existentes', async (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const first = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  const firstBytes = fs.readFileSync(first.backupPath);
  db.prepare('UPDATE tasks SET priority = ?, due_date = ? WHERE id = ?')
    .run('high', '2026-09-20 12:34:56', 7);
  const beforeSecondRun = captureTasks(db);

  const second = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.notEqual(second.backupPath, first.backupPath);
  assert.deepEqual(fs.readFileSync(first.backupPath), firstBytes);
  assert.deepEqual(second.addedColumns, []);
  assert.deepEqual(captureTasks(db), beforeSecondRun);
  assert.deepEqual(captureTasks(f.open(second.backupPath, true)), beforeSecondRun);
  assert.equal(fs.readdirSync(f.backupDirectory).filter((name) => name.endsWith('.db')).length, 2);
});

test('el comando real de actualización respalda, conserva datos exactos y es idempotente en otro proceso', (t) => {
  const f = fixture(t);
  const appRoot = path.join(f.directory, 'cli-project');
  fs.mkdirSync(path.join(appRoot, 'src', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'data'));
  // Keep the real entrypoint and its dependencies to exercise its default project paths.
  for (const filename of ['database-update.ts', 'database-contract.ts', 'task-id.ts']) {
    fs.copyFileSync(path.join(projectRoot, 'src', filename), path.join(appRoot, 'src', filename));
  }
  const entrypoint = path.join(appRoot, 'src', 'scripts', 'update-database.ts');
  fs.copyFileSync(path.join(projectRoot, 'src', 'scripts', 'update-database.ts'), entrypoint);
  const databasePath = path.join(appRoot, 'data', 'tasks.db');
  const backupDirectory = path.join(appRoot, 'data', 'backups');
  const db = f.open(databasePath);
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN external_number INTEGER');
  db.prepare('UPDATE tasks SET external_number = ? WHERE id = ?').run(9007199254740993n, 7);
  const original = captureTasks(db);
  const runCommand = () => JSON.parse(execFileSync(process.execPath,
    ['--import', 'tsx', entrypoint], {
      // The command must resolve data from its own location, not the working directory.
      cwd: f.directory, encoding: 'utf8', stdio: 'pipe', windowsHide: true,
    }));

  // execFileSync rejects any nonzero exit, and JSON.parse rejects extra stdout text.
  const first = runCommand();
  assert.equal(path.dirname(first.backupPath), backupDirectory);
  assert.deepEqual(first, {
    status: 'ok', databasePath, backupPath: first.backupPath,
    addedColumns: ['priority', 'due_date'], preservedTasks: 2,
    preservedColumns: original.columns.map(column => column.name),
    preservedIdSequence: true, integrity: 'ok',
  });
  assert.deepEqual(captureTasks(f.open(first.backupPath, true)), original);
  const migrated = assertTasksPreserved(original, db, 'prueba.comando');
  assert.equal(migrated.rows[0].external_number, 9007199254740993n);
  assert.equal(migrated.sequence, 200n);
  for (const row of migrated.rows) {
    assert.equal(row.priority, 'medium');
    assert.equal(row.due_date, null);
  }
  const firstBackupBytes = fs.readFileSync(first.backupPath);
  db.prepare('UPDATE tasks SET priority = ?, due_date = ? WHERE id = ?')
    .run('high', '2022-01-01 00:00:00', 7);
  const beforeRepeat = captureTasks(db);
  const second = runCommand();
  assert.equal(path.dirname(second.backupPath), backupDirectory);
  assert.notEqual(second.backupPath, first.backupPath);
  assert.deepEqual(second, {
    status: 'ok', databasePath, backupPath: second.backupPath,
    addedColumns: [], preservedTasks: 2,
    preservedColumns: beforeRepeat.columns.map(column => column.name),
    preservedIdSequence: true, integrity: 'ok',
  });
  assert.deepEqual(captureTasks(db), beforeRepeat);
  assert.deepEqual(captureTasks(f.open(second.backupPath, true)), beforeRepeat);
  assert.deepEqual(fs.readFileSync(first.backupPath), firstBackupBytes);
  assert.equal(fs.readdirSync(backupDirectory).filter(filename => filename.endsWith('.db')).length, 2);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('completa un esquema parcial sin sobrescribir la fecha que ya existía', async (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
  db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run('2022-01-01 00:00:00', 7);
  const original = captureTasks(db);

  const report = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.deepEqual(report.addedColumns, ['priority']);
  const actual = assertTasksPreserved(original, db, 'prueba.comparacion');
  assert.equal(actual.rows[0].due_date, '2022-01-01 00:00:00');
  assert.equal(actual.rows[0].priority, 'medium');
});

test('una diferencia identifica etapa, tabla, tarea y campo exactos', (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const original = captureTasks(db);
  db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('Alterado', 7);
  assert.throws(() => assertTasksPreserved(original, db, 'comparacion.posterior'), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'comparacion.posterior');
    assert.equal(error.details.table, 'tasks');
    assert.equal(error.details.taskId, 7n);
    assert.equal(error.details.field, 'title');
    assert.equal(error.details.expected, 'Informe: revisión de México');
    assert.equal(error.details.actual, 'Alterado');
    return true;
  });
});

test('un fallo de integridad posterior revierte también las columnas agregadas', (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const original = captureTasks(db);
  const pragma = db.pragma.bind(db);
  let inspectedNewColumns = false;
  const mock = t.mock.method(db, 'pragma', (source: string, options?: object) => {
    if (source === 'integrity_check') {
      inspectedNewColumns = captureTasks(db).columns.some((column) => column.name === 'due_date');
      return [{ integrity_check: 'fallo de integridad simulado' }];
    }
    return pragma(source, options);
  });
  assert.throws(() => applyVerifiedTaskUpdate(db, original), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'verificacion.integridad_final');
    return true;
  });
  mock.mock.restore();
  assert.ok(inspectedNewColumns, 'el fallo debe ocurrir después de agregar las columnas');
  assert.deepEqual(captureTasks(db), original);
  assert.equal(db.inTransaction, false);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('rechaza un respaldo desactualizado antes de cambiar el esquema', (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const original = captureTasks(db);
  db.prepare('INSERT INTO tasks (title) VALUES (?)').run('Cambio posterior al respaldo');
  const afterExternalWrite = captureTasks(db);
  assert.throws(() => applyVerifiedTaskUpdate(db, original), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'comparacion.previa');
    assert.equal(error.details.field, 'count');
    return true;
  });
  assert.deepEqual(captureTasks(db), afterExternalWrite);
});

test('si no se puede crear el respaldo, la base original permanece intacta', async (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const original = captureTasks(db);
  const blockedDirectory = path.join(f.directory, 'not-a-directory');
  fs.writeFileSync(blockedDirectory, 'archivo que impide crear el directorio');
  await assert.rejects(backupAndUpdateDatabase(f.databasePath, blockedDirectory), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'respaldo');
    return true;
  });
  assert.deepEqual(captureTasks(db), original);
});

test('una ruta inexistente no crea una base vacía ni modifica el directorio', async (t) => {
  const f = fixture(t);
  await assert.rejects(backupAndUpdateDatabase(f.databasePath, f.backupDirectory), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.stage, 'apertura');
    return true;
  });
  assert.equal(fs.existsSync(f.databasePath), false);
  assert.equal(fs.existsSync(f.backupDirectory), false);
});

test('la inicialización real crea el esquema nuevo y al reiniciar no duplica tareas ni crea respaldos', (t) => {
  const f = fixture(t);
  const appRoot = path.join(f.directory, 'app');
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'src', 'db.ts'), path.join(appRoot, 'src', 'db.ts'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'database-contract.ts'), path.join(appRoot, 'src', 'database-contract.ts'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'task-id.ts'), path.join(appRoot, 'src', 'task-id.ts'));
  fs.copyFileSync(path.join(projectRoot, 'schema.sql'), path.join(appRoot, 'schema.sql'));
  fs.copyFileSync(path.join(projectRoot, 'seed.sql'), path.join(appRoot, 'seed.sql'));
  const initialize = () => initializeApp(appRoot);
  initialize();
  const created = f.open(path.join(appRoot, 'data', 'tasks.db'), true);
  const original = captureTasks(created);
  created.close();
  assert.equal(original.rows.length, 4);
  for (const row of original.rows) {
    assert.equal(row.priority, 'medium');
    assert.equal(row.due_date, null);
  }
  initialize();
  const restarted = f.open(path.join(appRoot, 'data', 'tasks.db'), true);
  assert.deepEqual(captureTasks(restarted), original);
  assert.equal(fs.existsSync(path.join(appRoot, 'data', 'backups')), false);
});

test('un archivo SQLite existente sin tasks recibe ejemplos y conserva las otras tablas', (t) => {
  const f = fixture(t);
  const appRoot = path.join(f.directory, 'app');
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'data'));
  for (const filename of ['db.ts', 'database-contract.ts', 'task-id.ts']) {
    fs.copyFileSync(path.join(projectRoot, 'src', filename), path.join(appRoot, 'src', filename));
  }
  for (const filename of ['schema.sql', 'seed.sql']) {
    fs.copyFileSync(path.join(projectRoot, filename), path.join(appRoot, filename));
  }
  const dbPath = path.join(appRoot, 'data', 'tasks.db');
  const db = f.open(dbPath);
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)');
  db.prepare('INSERT INTO notes (id, body) VALUES (?, ?)').run(7, 'Existing unrelated data');
  db.prepare('INSERT INTO notes (id, body) VALUES (?, ?)').run(40, 'Previously deleted note');
  db.prepare('DELETE FROM notes WHERE id = ?').run(40);
  const captureNotes = () => ({
    schema: db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'notes'").get(),
    rows: db.prepare('SELECT * FROM notes ORDER BY id').all(),
    sequence: db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notes'").get(),
  });
  const originalNotes = captureNotes();
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'tasks'").get(), undefined);
  const initialize = () => initializeApp(appRoot);
  initialize();
  const originalTasks = captureTasks(db);
  assert.deepEqual(originalTasks.rows.map(row => row.id), [1n, 2n, 3n, 4n]);
  assert.equal(originalTasks.sequence, 4n);
  for (const row of originalTasks.rows) {
    assert.equal(row.priority, 'medium');
    assert.equal(row.due_date, null);
  }
  assert.deepEqual(captureNotes(), originalNotes);
  for (let restart = 0; restart < 2; restart += 1) {
    initialize();
    assert.deepEqual(captureTasks(db), originalTasks);
    assert.deepEqual(captureNotes(), originalNotes);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  }
  assert.equal(fs.existsSync(path.join(appRoot, 'data', 'backups')), false);
});

test('rechaza priority existente sin el contrato de prioridad y conserva la base', async (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN priority TEXT');
  const original = captureTasks(db);
  await assert.rejects(backupAndUpdateDatabase(f.databasePath, f.backupDirectory), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.details.table, 'tasks');
    assert.equal(error.details.field, 'priority');
    return true;
  });
  assert.deepEqual(captureTasks(db), original);
});

test('rechaza due_date numérico aunque sus valores actuales sean null', async (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  db.exec('ALTER TABLE tasks ADD COLUMN due_date INTEGER');
  const original = captureTasks(db);
  await assert.rejects(backupAndUpdateDatabase(f.databasePath, f.backupDirectory), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.details.table, 'tasks');
    assert.equal(error.details.field, 'due_date');
    return true;
  });
  assert.deepEqual(captureTasks(db), original);
});

test('valida default, NOT NULL, CHECK real y collation de priority, incluso sin filas', async (t) => {
  const definitions = [
    "TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high'))",
    "TEXT NOT NULL DEFAULT 'low' CHECK(priority IN ('low','medium','high'))",
    "TEXT NOT NULL DEFAULT 'medium'",
    "TEXT NOT NULL DEFAULT 'medium' /* CHECK(priority IN ('low','medium','high')) */",
    "TEXT NOT NULL DEFAULT 'medium' CHECK('CHECK(priority IN (''low'',''medium'',''high''))' <> '')",
    "TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high') OR priority = 'urgent')",
    "TEXT NOT NULL DEFAULT 'medium' CHECK(priority = 'low' OR priority = 'medium' OR priority = 'high')",
    "TEXT COLLATE NOCASE NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high'))",
    "TEXT COLLATE RTRIM NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high'))",
  ];
  for (const definition of definitions) {
    await t.test(definition, async (subtest) => {
      const f = fixture(subtest);
      const db = f.open();
      db.exec(legacySchema);
      db.exec(`ALTER TABLE tasks ADD COLUMN priority ${definition}`);
      const original = captureTasks(db);
      await assert.rejects(backupAndUpdateDatabase(f.databasePath, f.backupDirectory), (error) => {
        assert.ok(error instanceof DatabaseUpdateError);
        assert.equal(error.stage, 'verificacion.esquema_previo');
        assert.equal(error.details.field, 'priority');
        return true;
      });
      assert.deepEqual(captureTasks(db), original);
    });
  }
});

test('acepta la forma CHECK soportada con identificador citado, orden distinto y default entre paréntesis', async (t) => {
  const f = fixture(t);
  const db = f.open();
  db.exec(legacySchema.replace('title TEXT NOT NULL', 'title TEXT COLLATE NOCASE NOT NULL'));
  db.exec(`ALTER TABLE tasks ADD COLUMN priority TEXT COLLATE BINARY NOT NULL DEFAULT (('medium')) CHECK (("priority" IN ('high', 'low', 'medium')))`);
  const report = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.deepEqual(report.addedColumns, ['due_date']);
  db.prepare('INSERT INTO tasks (title) VALUES (?)').run('Nueva');
  assert.equal((db.prepare('SELECT priority FROM tasks').get() as { priority: string }).priority, 'medium');
  assert.throws(() => db.prepare('INSERT INTO tasks (title, priority) VALUES (?, ?)').run('Inválida', 'HIGH'));
});

test('conserva y compara una columna calculada almacenada durante el respaldo real', async (t) => {
  const f = fixture(t);
  const db = f.open();
  db.exec(legacySchema.replace('  );', ", calculated TEXT GENERATED ALWAYS AS (upper(title)) STORED\n  );"));
  db.prepare('INSERT INTO tasks (title) VALUES (?)').run('Informe');
  const original = captureTasks(db);
  assert.ok(original.columns.some((column) => column.name === 'calculated'));
  const report = await backupAndUpdateDatabase(f.databasePath, f.backupDirectory);
  assert.ok(report.preservedColumns.includes('calculated'));
  assert.equal(assertTasksPreserved(original, db, 'prueba').rows[0].calculated, 'INFORME');
});

test('la comparación de conservación está limitada a tasks y su secuencia', (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  db.exec("CREATE TABLE other_data (value TEXT); INSERT INTO other_data VALUES ('antes')");
  const original = captureTasks(db);
  db.exec("UPDATE other_data SET value = 'después'");
  assert.deepEqual(applyVerifiedTaskUpdate(db, original), ['priority', 'due_date']);
  assert.equal((db.prepare('SELECT value FROM other_data').get() as { value: string }).value, 'después');
});

test('compara el valor de columnas calculadas aunque sus metadatos coincidan', (t) => {
  const f = fixture(t);
  const referenceDb = f.open();
  const changedDb = f.open(path.join(f.directory, 'changed.db'));
  seedLegacy(referenceDb);
  seedLegacy(changedDb);
  referenceDb.exec("ALTER TABLE tasks ADD COLUMN calculated TEXT GENERATED ALWAYS AS ('antes') VIRTUAL");
  changedDb.exec("ALTER TABLE tasks ADD COLUMN calculated TEXT GENERATED ALWAYS AS ('después') VIRTUAL");
  const original = captureTasks(referenceDb);
  assert.throws(() => assertTasksPreserved(original, changedDb, 'comparacion.previa'), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.details.field, 'calculated');
    assert.equal(error.details.expected, 'antes');
    assert.equal(error.details.actual, 'después');
    return true;
  });
});

test('una tarea faltante con igual conteo informa valores esperado y actual', (t) => {
  const f = fixture(t);
  const db = f.open();
  seedLegacy(db);
  const original = captureTasks(db);
  db.prepare('UPDATE tasks SET id = ? WHERE id = ?').run(8, 7);
  assert.throws(() => assertTasksPreserved(original, db, 'comparacion.previa'), (error) => {
    assert.ok(error instanceof DatabaseUpdateError);
    assert.equal(error.details.taskId, 7n);
    assert.equal(error.details.field, 'id');
    assert.equal(error.details.expected, 7n);
    assert.equal(error.details.actual, null);
    return true;
  });
});

test('la inicialización rechaza una base antigua antes de insertar datos de ejemplo', (t) => {
  const f = fixture(t);
  const appRoot = path.join(f.directory, 'legacy-app');
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'data'));
  for (const filename of fs.readdirSync(path.join(projectRoot, 'src'))) {
    if (filename.endsWith('.ts')) fs.copyFileSync(path.join(projectRoot, 'src', filename), path.join(appRoot, 'src', filename));
  }
  for (const filename of ['schema.sql', 'seed.sql']) fs.copyFileSync(path.join(projectRoot, filename), path.join(appRoot, filename));
  const db = f.open(path.join(appRoot, 'data', 'tasks.db'));
  db.exec(legacySchema);
  const original = captureTasks(db);
  assert.throws(() => initializeApp(appRoot), (error) => {
    assert.match(String((error as { stderr?: string }).stderr), /npm run db:update/);
    return true;
  });
  assert.deepEqual(captureTasks(db), original);
  assert.equal(fs.existsSync(path.join(appRoot, 'data', 'backups')), false);
});
