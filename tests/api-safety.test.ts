import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createTaskModel } from '../src/models/tasks.model.js';
import type { TaskFilters } from '../src/types.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturesRoot = path.join(projectRoot, 'data', 'test-api-safety');
const fixedNow = () => new Date(2030, 0, 2, 15, 0, 0);

function databaseOptions(directory: string) {
  return {
    filename: path.join(directory, 'tasks.db'),
    schemaPath: path.join(projectRoot, 'schema.sql'),
    seedPath: path.join(projectRoot, 'seed.sql'),
  };
}

function fixture(t: TestContext) {
  fs.mkdirSync(fixturesRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(fixturesRoot, 'case-'));
  const options = databaseOptions(directory);
  const db = new Database(options.filename);
  db.defaultSafeIntegers(true);
  db.exec(fs.readFileSync(options.schemaPath, 'utf8'));
  db.exec(fs.readFileSync(options.seedPath, 'utf8'));
  t.after(() => {
    if (db.open) db.close();
    const resolved = fs.realpathSync(directory);
    const root = fs.realpathSync(fixturesRoot);
    assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith('case-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, db };
}

async function serve(db: Database.Database) {
  const server = createApp(createTaskModel(db), { now: fixedNow }).listen(0, '127.0.0.1');
  const stop = async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  };
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    return { url: `http://127.0.0.1:${address.port}`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function initializeProcess(directory: string) {
  const entry = path.join(directory, 'initialize.ts');
  fs.writeFileSync(entry, `
    import { openDatabase } from ${JSON.stringify(new URL('../src/db.ts', import.meta.url).href)};
    const db = openDatabase(${JSON.stringify(databaseOptions(directory))});
    db.close();
  `);
  return execFileSync(process.execPath, ['--import', 'tsx', entry], {
    cwd: directory, encoding: 'utf8', stdio: 'pipe', windowsHide: true,
  });
}

/** Keep real process boundaries only where startup and restart behavior is tested. */
async function serveProcess(directory: string) {
  const entry = path.join(directory, 'serve.ts');
  fs.writeFileSync(entry, `
    import { openDatabase } from ${JSON.stringify(new URL('../src/db.ts', import.meta.url).href)};
    import { createTaskModel } from ${JSON.stringify(new URL('../src/models/tasks.model.ts', import.meta.url).href)};
    import { createApp } from ${JSON.stringify(new URL('../src/app.ts', import.meta.url).href)};
    const db = openDatabase(${JSON.stringify(databaseOptions(directory))});
    const app = createApp(createTaskModel(db), { now: () => new Date(2030, 0, 2, 15, 0, 0) });
    const server = app.listen(0, '127.0.0.1', () => {
      process.stdout.write(JSON.stringify({ port: server.address().port }) + '\\n');
    });
  `);
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += String(data); });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  };
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`API temporal no inició: ${stderr}`)), 10000);
      let stdout = '';
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Salida ${code}: ${stderr}`)); });
      child.stdout.on('data', (data) => {
        stdout += String(data);
        if (stdout.includes('\n')) {
          clearTimeout(timer);
          try { resolve(JSON.parse(stdout.split('\n')[0]).port); } catch (error) { reject(error); }
        }
      });
    });
    return { url: `http://127.0.0.1:${port}`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

test('importar los módulos de la aplicación no abre SQLite ni crea archivos de datos', (t) => {
  const f = fixture(t);
  const isolatedProject = path.join(f.directory, 'import-only');
  // This copy is intentional: an import-time regression must never touch the real database.
  fs.mkdirSync(isolatedProject);
  fs.cpSync(path.join(projectRoot, 'src'), path.join(isolatedProject, 'src'), { recursive: true });
  for (const filename of ['schema.sql', 'seed.sql']) {
    fs.copyFileSync(path.join(projectRoot, filename), path.join(isolatedProject, filename));
  }
  const guardDirectory = path.join(isolatedProject, 'node_modules', 'better-sqlite3');
  fs.mkdirSync(guardDirectory, { recursive: true });
  fs.writeFileSync(path.join(guardDirectory, 'package.json'), JSON.stringify({
    name: 'better-sqlite3', type: 'module', exports: './index.ts',
  }));
  fs.writeFileSync(path.join(guardDirectory, 'index.ts'), `
    export const attempts: unknown[][] = [];
    export default function Database(...args: unknown[]): never {
      attempts.push(args);
      throw new Error('SQLite must not be opened during module import.');
    }
  `);
  const entry = path.join(isolatedProject, 'check-imports.ts');
  fs.writeFileSync(entry, `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    import Database, { attempts } from 'better-sqlite3';
    const project = ${JSON.stringify(isolatedProject)};
    // Verify that ESM imports see the guard before trusting the zero-attempt result.
    assert.throws(() => new Database(':memory:'), /SQLite must not be opened/);
    assert.equal(attempts.length, 1);
    attempts.length = 0;
    const modules = ['db.ts', 'models/tasks.model.ts', 'controllers/tasks.controller.ts', 'routes/tasks.ts', 'app.ts'];
    for (const relative of modules) {
      await import(pathToFileURL(path.join(project, 'src', relative)).href);
    }
    assert.deepEqual(attempts, []);
    assert.equal(fs.existsSync(path.join(project, 'data')), false);
    process.stdout.write(JSON.stringify({ imported: modules.length, databaseOpenAttempts: attempts.length }));
  `);
  const before = fs.readdirSync(isolatedProject).sort();
  const result = execFileSync(process.execPath, ['--import', 'tsx', entry], {
    cwd: isolatedProject, encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 10000,
  });
  assert.deepEqual(JSON.parse(result), { imported: 5, databaseOpenAttempts: 0 });
  assert.deepEqual(fs.readdirSync(isolatedProject).sort(), before);
});

test('dos aplicaciones simultáneas mantienen aisladas sus bases y utilizan el reloj inyectado', async (t) => {
  const firstFixture = fixture(t);
  const secondFixture = fixture(t);
  const secondBefore = taskSnapshot(secondFixture.db);
  const first = await serve(firstFixture.db);
  try {
    const second = await serve(secondFixture.db);
    try {
      const due = `${localDay()} 10:00:00`;
      const created = await submit(`${first.url}/tasks`, 'POST', { title: 'Only in the first database', due_date: due });
      assert.equal(created.status, 201);
      assert.equal(created.body.due_date, due);
      assert.equal(created.body.id, 5);
      assert.deepEqual(storedTasks(firstFixture.db).at(-1), created.body);
      const secondList = await getFiltered(second.url, '');
      assert.deepEqual(secondList, { status: 200, body: { tasks: storedTasks(secondFixture.db), message: null } });
      assert.deepEqual(taskSnapshot(secondFixture.db), secondBefore);
      const rejected = await submit(`${second.url}/tasks`, 'POST', {
        title: 'Yesterday according to the injected clock', due_date: '2030-01-01 23:59:59',
      });
      assertFields(rejected, ['due_date']);
      assert.deepEqual(taskSnapshot(secondFixture.db), secondBefore);
    } finally { await second.stop(); }
  } finally { await first.stop(); }
});

test('PATCH y DELETE rechazan IDs ambiguos antes de tocar la tarea 1', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    const before = f.db.prepare('SELECT * FROM tasks ORDER BY id').all();
    for (const id of ['1.0000000000000001', '1.0', '1e0', '+1', '-1', '0', '500001', '9007199254740992', '9007199254740993']) {
      for (const method of ['PATCH', 'DELETE']) {
        const response = await fetch(`${server.url}/tasks/${encodeURIComponent(id)}`, {
          method, headers: { 'Content-Type': 'application/json' },
          ...(method === 'PATCH' ? { body: JSON.stringify({ title: 'No debe aplicarse' }) } : {}),
        });
        assert.equal(response.status, 400, `${method} ${id}`);
        await response.text();
      }
    }
    assert.deepEqual(f.db.prepare('SELECT * FROM tasks ORDER BY id').all(), before);
    const valid = await fetch(`${server.url}/tasks/1`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: false }),
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json() as { id: number }).id, 1);
  } finally { await server.stop(); }
});

test('devuelve 499999 y 500000 distintos y acepta el límite en PATCH y DELETE', async (t) => {
  const f = fixture(t);
  const maximum = 500000n;
  const insert = f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)');
  insert.run(maximum - 1n, 'Penúltimo seguro');
  insert.run(maximum, 'Último seguro');
  const server = await serve(f.db);
  try {
    const response = await fetch(`${server.url}/tasks`);
    assert.equal(response.status, 200);
    const body = await response.json() as { tasks: { id: number; completed: boolean }[]; message: null };
    assert.deepEqual(body, { tasks: storedTasks(f.db), message: null });
    const rows = body.tasks;
    assert.deepEqual(rows.slice(-2).map((row) => row.id), [Number(maximum - 1n), Number(maximum)]);
    assert.ok(rows.every((row) => typeof row.completed === 'boolean'));
    const patch = await fetch(`${server.url}/tasks/500000`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }),
    });
    assert.equal(patch.status, 200);
    assert.deepEqual((await patch.json() as { id: number; completed: boolean }).id, 500000);
    assert.equal((f.db.prepare('SELECT completed FROM tasks WHERE id = 500000').get() as { completed: bigint }).completed, 1n);
    const remove = await fetch(`${server.url}/tasks/500000`, { method: 'DELETE' });
    assert.equal(remove.status, 204);
    assert.equal(f.db.prepare('SELECT id FROM tasks WHERE id = 500000').get(), undefined);
    assert.ok(f.db.prepare('SELECT id FROM tasks WHERE id = 499999').get());
  } finally { await server.stop(); }
});

test('crea hasta 500000 y devuelve 400 sin cambiar filas o secuencia al agotar el rango', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE sqlite_sequence SET seq = 499998 WHERE name = 'tasks'").run();
  const server = await serve(f.db);
  const create = () => fetch(`${server.url}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Límite de IDs' }),
  });
  const snapshot = () => ({
    rows: f.db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    sequence: f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'").get(),
  });
  try {
    for (const expected of [499999, 500000]) {
      const response = await create();
      assert.equal(response.status, 201);
      assert.equal((await response.json() as { id: number }).id, expected);
    }
    for (const deleteLast of [false, true]) {
      if (deleteLast) {
        const remove = await fetch(`${server.url}/tasks/500000`, { method: 'DELETE' });
        assert.equal(remove.status, 204);
      }
      const before = snapshot();
      const rejected = await create();
      assert.equal(rejected.status, 400);
      const body = await rejected.json() as { error: string };
      assert.match(body.error, /ID limit \(500000\)/);
      assert.deepEqual(snapshot(), before);
    }
  } finally { await server.stop(); }
});

test('los IDs externos fuera del rango nunca producen JSON redondeado y la creación conserva la base', async (t) => {
  const f = fixture(t);
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const server = await serve(f.db);
  try {
    const insert = f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)');
    insert.run(500001n, 'Fuera del límite');
    const aboveLimit = await fetch(`${server.url}/tasks`);
    assert.equal(aboveLimit.status, 500);
    assert.deepEqual(await aboveLimit.json(), { error: 'Internal server error.' });
    f.db.prepare('DELETE FROM tasks WHERE id = 500001').run();
    insert.run(9007199254740992n, 'Grande A');
    insert.run(9007199254740993n, 'Grande B');
    const invalid = await fetch(`${server.url}/tasks`);
    assert.equal(invalid.status, 500);
    assert.deepEqual(await invalid.json(), { error: 'Internal server error.' });
    // Even an exhausted SQLite 64-bit sequence must produce the agreed 400.
    f.db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'tasks'").run(9223372036854775807n);
    const beforeRows = f.db.prepare('SELECT * FROM tasks ORDER BY id').all();
    const beforeSequence = f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'").get();
    const create = await fetch(`${server.url}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Desbordamiento' }),
    });
    assert.equal(create.status, 400);
    assert.match((await create.json() as { error: string }).error, /500000/);
    assert.deepEqual(f.db.prepare('SELECT * FROM tasks ORDER BY id').all(), beforeRows);
    assert.deepEqual(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'").get(), beforeSequence);
    assert.equal(logged.length, 2);
    assert.ok(logged.every(entry => JSON.stringify(entry).includes('TaskIdRangeError')));
  } finally { await server.stop(); }
});

test('el arranque rechaza IDs existentes fuera de 1..500000 sin modificarlos', async (t) => {
  for (const id of [500001n, 9007199254740993n]) {
    await t.test(String(id), (subtest) => {
      const f = fixture(subtest);
      f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run(id, 'Fuera de rango');
      const before = f.db.prepare('SELECT * FROM tasks ORDER BY id').all();
      assert.throws(() => initializeProcess(f.directory), (error) => {
        assert.match(String((error as { stderr?: string }).stderr), /fuera del rango permitido.*1\.\.500000/);
        return true;
      });
      assert.deepEqual(f.db.prepare('SELECT * FROM tasks ORDER BY id').all(), before);
    });
  }
});

test('el arranque rechaza columnas incompatibles aunque la tabla esté vacía', (t) => {
  const f = fixture(t);
  f.db.exec("DELETE FROM tasks; ALTER TABLE tasks DROP COLUMN priority; ALTER TABLE tasks ADD COLUMN priority TEXT");
  const before = f.db.prepare('PRAGMA table_xinfo(tasks)').all();
  assert.throws(() => initializeProcess(f.directory), (error) => {
    assert.match(String((error as { stderr?: string }).stderr), /incompatible: priority/);
    return true;
  });
  assert.deepEqual(f.db.prepare('PRAGMA table_xinfo(tasks)').all(), before);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: bigint }).total, 0n);
});

test('los reinicios conservan tasks existente, vacía o poblada, sin reinsertar ejemplos', async (t) => {
  const cases = [
    { name: 'Tabla creada manualmente, sin inserciones ni secuencia', sequence: null, empty: true },
    { name: 'Tabla vaciada, secuencia 4', sequence: 4n, empty: true },
    { name: 'Tabla vaciada, secuencia 499996', sequence: 499996n, empty: true },
    { name: 'Tabla vaciada, secuencia 499997', sequence: 499997n, empty: true },
    { name: 'Tabla vaciada, secuencia 500000', sequence: 500000n, empty: true },
    { name: 'Tabla poblada, secuencia mayor que los IDs presentes', sequence: 200n, empty: false },
  ];
  for (const item of cases) {
    await t.test(item.name, async (subtest) => {
      const f = fixture(subtest);
      if (item.sequence === null) {
        f.db.exec('DROP TABLE tasks');
        f.db.exec(fs.readFileSync(path.join(projectRoot, 'schema.sql'), 'utf8'));
      } else if (item.empty) {
        if (item.sequence > 4n) {
          f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run(item.sequence, 'Deleted task');
        }
        f.db.exec('DELETE FROM tasks');
      } else {
        f.db.prepare('UPDATE tasks SET title = ?, completed = ?, priority = ?, due_date = ? WHERE id = 1')
          .run('Existing user data', 0, 'high', '2020-02-29 23:59:59');
        f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run(item.sequence, 'Deleted task');
        f.db.prepare('DELETE FROM tasks WHERE id = ?').run(item.sequence);
      }
      const snapshot = () => ({ ...taskSnapshot(f.db), columns: f.db.pragma('table_xinfo(tasks)') });
      const before = snapshot();
      assert.equal((before.sequence as { seq: bigint } | undefined)?.seq ?? null, item.sequence);
      const expected = item.empty
        ? { tasks: [], message: 'No matching tasks found.' }
        : { tasks: storedTasks(f.db), message: null };
      for (let restart = 0; restart < 2; restart += 1) {
        const server = await serveProcess(f.directory);
        try {
          const result = await getFiltered(server.url, '');
          assert.equal(result.status, 200);
          assert.deepEqual(result.body, expected);
          assert.deepEqual(snapshot(), before);
          assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
        } finally { await server.stop(); }
        assert.deepEqual(snapshot(), before);
      }
    });
  }
});

test('POST después de reiniciar una tabla vaciada respeta la secuencia y su límite', async (t) => {
  for (const sequence of [499997n, 500000n]) {
    await t.test(`Secuencia ${sequence}`, async (subtest) => {
      const f = fixture(subtest);
      f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run(sequence, 'Deleted task');
      f.db.exec('DELETE FROM tasks');
      const before = taskSnapshot(f.db);
      const server = await serveProcess(f.directory);
      try {
        const empty = await getFiltered(server.url, '');
        assert.equal(empty.status, 200);
        assert.deepEqual(empty.body, { tasks: [], message: 'No matching tasks found.' });
        assert.deepEqual(taskSnapshot(f.db), before);
        const created = await submit(`${server.url}/tasks`, 'POST', { title: 'Created after restart' });
        if (sequence === 499997n) {
          assert.equal(created.status, 201);
          assert.equal(created.body.id, 499998);
          assert.deepEqual(storedTasks(f.db), [created.body]);
          assert.deepEqual(taskSnapshot(f.db).sequence, { seq: 499998n });
        } else {
          assert.equal(created.status, 400);
          assert.deepEqual(created.body, {
            error: 'Cannot create a task because the ID limit (500000) has been reached.',
          });
          assert.deepEqual(taskSnapshot(f.db), before);
        }
      } finally { await server.stop(); }
      const afterRequest = taskSnapshot(f.db);
      const restarted = await serveProcess(f.directory);
      try {
        const result = await getFiltered(restarted.url, '');
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, {
          tasks: storedTasks(f.db),
          message: sequence === 500000n ? 'No matching tasks found.' : null,
        });
        assert.deepEqual(taskSnapshot(f.db), afterRequest);
      } finally { await restarted.stop(); }
      assert.deepEqual(taskSnapshot(f.db), afterRequest);
    });
  }
});

test('bulk-complete cuenta transiciones reales, acepta el ID máximo y conserva los demás datos', async (t) => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO tasks (id, title, priority, due_date) VALUES (?, ?, ?, ?)')
    .run(500000n, 'Last supported ID', 'low', '2000-01-01 12:00:00');
  f.db.prepare('UPDATE tasks SET priority = ?, due_date = ? WHERE id = 2')
    .run('high', '2001-02-03 04:05:06');
  f.db.exec(`
    CREATE TABLE bulk_writes (task_id INTEGER);
    CREATE TRIGGER record_bulk_updates AFTER UPDATE ON tasks
      BEGIN INSERT INTO bulk_writes VALUES (NEW.id); END;
  `);
  const before = taskSnapshot(f.db);
  const expectedRows = (before.rows as Record<string, unknown>[]).map(row =>
    row.id === 2n || row.id === 500000n ? { ...row, completed: 1n } : row);
  const server = await serve(f.db);
  try {
    const first = await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids: [500000, 1, 2] });
    assert.deepEqual(first, { status: 200, body: { updated: 2 } });
    assert.deepEqual(taskSnapshot(f.db), { ...before, rows: expectedRows });
    assert.deepEqual(f.db.prepare('SELECT task_id FROM bulk_writes ORDER BY task_id').all(), [
      { task_id: 2n }, { task_id: 500000n },
    ]);
    for (const ids of [[500000, 1, 2], [1]]) {
      assert.deepEqual(await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids }), {
        status: 200, body: { updated: 0 },
      });
      assert.deepEqual(taskSnapshot(f.db), { ...before, rows: expectedRows });
      assert.equal((f.db.prepare('SELECT COUNT(*) AS count FROM bulk_writes').get() as { count: bigint }).count, 2n);
    }
  } finally { await server.stop(); }
});

test('bulk-complete rechaza atómicamente los IDs inexistentes y los informa en orden numérico', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    for (const ids of [[9, 2, 8], [8, 9], [1, 9, 8]]) {
      assert.deepEqual(await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids }), {
        status: 404, body: { error: 'Tasks not found: 8, 9.' },
      });
      assert.deepEqual(taskSnapshot(f.db), before);
    }
    assert.deepEqual(await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids: [2, 3] }), {
      status: 200, body: { updated: 2 },
    });
  } finally { await server.stop(); }
});

test('bulk-complete valida cuerpo, tipos, rango, duplicados y propiedades antes de escribir', async (t) => {
  const f = fixture(t);
  f.db.exec(`
    CREATE TABLE bulk_writes (task_id INTEGER);
    CREATE TRIGGER record_bulk_updates AFTER UPDATE ON tasks
      BEGIN INSERT INTO bulk_writes VALUES (NEW.id); END;
  `);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    for (const body of [null, [], [2], true, false, 2, 'ids']) {
      const errors = assertFields(await submit(`${server.url}/tasks/bulk-complete`, 'POST', body), ['body']);
      assert.equal(errors[0].message, 'The request body must be a JSON object.');
    }
    for (const body of [
      {}, { ids: null }, { ids: 2 }, { ids: '2,3' }, { ids: {} }, { ids: [] },
      { ids: ['2'] }, { ids: [true] }, { ids: [null] }, { ids: [{}] }, { ids: [[2]] },
      { ids: [0] }, { ids: [-1] }, { ids: [1.5] }, { ids: [500001] },
      { ids: [9007199254740992] }, { ids: [2, 2] }, { ids: [2, '3'] },
      { ids: [9, '2'] },
    ]) {
      const errors = assertFields(await submit(`${server.url}/tasks/bulk-complete`, 'POST', body), ['ids']);
      assert.match(errors[0].message, /ids/i);
      assert.match(errors[0].message, /must|use|provide|send|include/i);
      assert.deepEqual(taskSnapshot(f.db), before);
    }
    const mixed = await submit(`${server.url}/tasks/bulk-complete`, 'POST', { zzz: 1, ids: [], aaa: 2 });
    const mixedErrors = assertFields(mixed, ['ids', 'aaa', 'zzz']);
    assert.ok(mixedErrors.slice(1).every(error => /not allowed/.test(error.message)));
    assertFields(await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids: [2], completed: true }), ['completed']);
    assert.deepEqual(taskSnapshot(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM bulk_writes').all(), []);
  } finally { await server.stop(); }
});

test('bulk-complete rechaza numerales ambiguos usando su escritura JSON original', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const sources = [
      '{"ids":[1.0]}', '{"ids":[1e0]}', '{"ids":[1E+0]}',
      '{"ids":[1.0000000000000001]}', '{"ids":[-0]}', '{"ids":[2,3.0]}',
      '{"ids":[2,9e0]}', '{"\\u0069ds":[1e0]}',
      ' { "ids" : [ 2.0000000000000001 ] } ',
    ];
    for (const source of sources) {
      const response = await fetch(`${server.url}/tasks/bulk-complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: source,
      });
      const errors = assertFields({ status: response.status, body: await response.json() as Record<string, unknown> }, ['ids']);
      assert.match(errors[0].message, /digits|decimal|exponent|integer/i);
      assert.match(errors[0].message, /must|use|provide|send|include/i);
      assert.deepEqual(taskSnapshot(f.db), before);
    }
    for (const source of [
      '{"ids":[2],"ids":[3]}', '{"ids":[],"\\u0069ds":[2]}',
      '{"ids":[2],"ids":[]}', '{"ids":[2],"ids":["3"]}', '{"ids":[2],"ids":null}',
    ]) {
      const response = await fetch(`${server.url}/tasks/bulk-complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: source,
      });
      const errors = assertFields({ status: response.status, body: await response.json() as Record<string, unknown> }, ['ids']);
      assert.match(errors[0].message, /exactly once/);
    }
    for (const [source, fields] of [
      ['{"zzz":3,"ids":[2.0],"aaa":1}', ['ids', 'aaa', 'zzz']],
      ['{"ids":[2],"aaa":1e0}', ['aaa']],
    ] as const) {
      const response = await fetch(`${server.url}/tasks/bulk-complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: source,
      });
      assertFields({ status: response.status, body: await response.json() as Record<string, unknown> }, [...fields]);
    }
    // Source validation follows Express route matching and decoded request bytes.
    for (const encoded of [
      { type: 'application/json', body: Buffer.from('\uFEFF{"ids":[2.0]}'), encoding: 'identity' },
      { type: 'application/json; charset=utf-16le', body: Buffer.from('{"ids":[2.0]}', 'utf16le'), encoding: 'identity' },
      { type: 'application/json', body: gzipSync('{"ids":[2.0]}'), encoding: 'gzip' },
    ]) {
      const response = await fetch(`${server.url}/TASKS/BULK-COMPLETE/`, {
        method: 'POST', headers: { 'Content-Type': encoded.type, 'Content-Encoding': encoded.encoding }, body: encoded.body,
      });
      const errors = assertFields({ status: response.status, body: await response.json() as Record<string, unknown> }, ['ids']);
      assert.match(errors[0].message, /decimal digits/);
    }
    assert.deepEqual(taskSnapshot(f.db), before);
    const escapedKey = await fetch(`${server.url}/tasks/bulk-complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"\\u0069ds": [2, 3]}',
    });
    assert.equal(escapedKey.status, 200);
    assert.deepEqual(await escapedKey.json(), { updated: 2 });
    assert.deepEqual(taskSnapshot(f.db), {
      ...before,
      rows: (before.rows as Record<string, unknown>[]).map(row =>
        row.id === 2n || row.id === 3n ? { ...row, completed: 1n } : row),
    });
  } finally { await server.stop(); }
});

test('bulk-complete admite 500 IDs y rechaza 501 sin aplicar cambios', async (t) => {
  const f = fixture(t);
  const insert = f.db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)');
  f.db.transaction(() => {
    for (let id = 5; id <= 501; id += 1) insert.run(id, `Boundary task ${id}`);
  })();
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const rejected = await submit(`${server.url}/tasks/bulk-complete`, 'POST', {
      ids: Array.from({ length: 501 }, (_, index) => index + 1),
    });
    assert.match(assertFields(rejected, ['ids'])[0].message, /500/);
    assert.deepEqual(taskSnapshot(f.db), before);
    assert.deepEqual(await submit(`${server.url}/tasks/bulk-complete`, 'POST', {
      ids: Array.from({ length: 500 }, (_, index) => index + 1),
    }), { status: 200, body: { updated: 499 } });
    assert.deepEqual(taskSnapshot(f.db), {
      ...before,
      rows: (before.rows as Record<string, unknown>[]).map(row =>
        (row.id as bigint) <= 500n ? { ...row, completed: 1n } : row),
    });
  } finally { await server.stop(); }
});

test('bulk-complete revierte escrituras parciales ante un fallo SQLite y oculta los detalles internos', async (t) => {
  const f = fixture(t);
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  f.db.exec(`
    CREATE TABLE bulk_writes (task_id INTEGER);
    CREATE TRIGGER record_bulk_updates AFTER UPDATE ON tasks
      BEGIN INSERT INTO bulk_writes VALUES (NEW.id); END;
    CREATE TRIGGER fail_second_bulk_update BEFORE UPDATE ON tasks WHEN NEW.id = 3
      BEGIN SELECT RAISE(FAIL, 'internal-secret: private SQL failure'); END;
  `);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const response = await fetch(`${server.url}/tasks/bulk-complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ids":[2,3]}',
    });
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { error: 'Internal server error.' });
    assert.equal(logged.length, 1);
    assert.ok(JSON.stringify(logged[0]).includes('internal-secret: private SQL failure'));
    assert.deepEqual(taskSnapshot(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM bulk_writes').all(), []);
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    f.db.exec('DROP TRIGGER fail_second_bulk_update');
    assert.deepEqual(await submit(`${server.url}/tasks/bulk-complete`, 'POST', { ids: [2, 3] }), {
      status: 200, body: { updated: 2 },
    });
    assert.deepEqual(f.db.prepare('SELECT task_id FROM bulk_writes ORDER BY task_id').all(), [
      { task_id: 2n }, { task_id: 3n },
    ]);
  } finally { await server.stop(); }
});

test('JSON mal formado devuelve el contrato 400 antes de cualquier escritura', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    for (const [method, route] of [['POST', '/tasks'], ['PATCH', '/tasks/2'], ['POST', '/tasks/bulk-complete']]) {
      for (const body of ["{'ids':[2]}", '{"ids":[2,]}', '{"ids":[2]', '{"ids":[NaN]}', '{"ids":[01]}']) {
        const response = await fetch(server.url + route, {
          method, headers: { 'Content-Type': 'application/json' }, body,
        });
        assert.equal(response.status, 400);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        assert.deepEqual(await response.json(), {
          errors: [{ field: 'body', message: 'Invalid JSON. Use double quotes and remove trailing commas.' }],
        });
        assert.deepEqual(taskSnapshot(f.db), before);
      }
    }
    const existingValidation = await submit(`${server.url}/tasks/2`, 'PATCH', { priority: 'HIGH' });
    assertFields(existingValidation, ['priority']);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('el parser mantiene el límite de 100 KB y responde 413 sin alterar SQLite', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const atLimit = ' '.repeat(102400 - 4) + 'null';
    assert.equal(Buffer.byteLength(atLimit), 102400);
    const acceptedByParser = await fetch(`${server.url}/tasks/bulk-complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: atLimit,
    });
    const errors = assertFields({
      status: acceptedByParser.status, body: await acceptedByParser.json() as Record<string, unknown>,
    }, ['body']);
    assert.equal(errors[0].message, 'The request body must be a JSON object.');
    const unicodeBody = JSON.stringify({ title: 'é'.repeat(60000) });
    assert.ok(unicodeBody.length < 102400 && Buffer.byteLength(unicodeBody) > 102400);
    for (const body of [atLimit + ' ', unicodeBody]) {
      const response = await fetch(`${server.url}/tasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), {
        errors: [{ field: 'body', message: 'Request body is too large. Maximum size is 100 KB.' }],
      });
      assert.deepEqual(taskSnapshot(f.db), before);
    }
  } finally { await server.stop(); }
});

test('el parser responde 415 para charset o content encoding no soportados', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const headers: Record<string, string>[] = [
      { 'Content-Type': 'application/json; charset=ISO-8859-1' },
      { 'Content-Type': 'application/json', 'Content-Encoding': 'unsupported-encoding' },
    ];
    for (const requestHeaders of headers) {
      const response = await fetch(`${server.url}/tasks/bulk-complete`, {
        method: 'POST', headers: requestHeaders, body: '{"ids":[2]}',
      });
      assert.equal(response.status, 415);
      assert.deepEqual(await response.json(), {
        errors: [{ field: 'body', message: 'Unsupported request encoding. Use UTF-8 JSON with a supported content encoding.' }],
      });
      assert.deepEqual(taskSnapshot(f.db), before);
    }
  } finally { await server.stop(); }
});

function localDay(date = fixedNow()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('el modelo aplica las seis selecciones acordadas y conserva filas y secuencia', (t) => {
  const f = fixture(t);
  const update = f.db.prepare('UPDATE tasks SET completed = ?, priority = ? WHERE id = ?');
  update.run(1, 'low', 1);
  update.run(0, 'low', 2);
  update.run(1, 'medium', 3);
  update.run(0, 'medium', 4);
  const insert = f.db.prepare('INSERT INTO tasks (title, completed, priority) VALUES (?, ?, ?)');
  insert.run('Completed high', 1, 'high');
  insert.run('Pending high', 0, 'high');
  const before = taskSnapshot(f.db);
  const cases: { name: string; filters: TaskFilters; expected: number[] }[] = [
    { name: 'No filters', filters: {}, expected: [1, 2, 3, 4, 5, 6] },
    { name: 'low,medium', filters: { priority: ['low', 'medium'] }, expected: [1, 2, 3, 4] },
    { name: 'low,high', filters: { priority: ['low', 'high'] }, expected: [1, 2, 5, 6] },
    { name: 'medium,high', filters: { priority: ['medium', 'high'] }, expected: [3, 4, 5, 6] },
    { name: 'false and low,high', filters: { completed: [false], priority: ['low', 'high'] }, expected: [2, 6] },
    { name: 'All values', filters: { completed: [true, false], priority: ['low', 'medium', 'high'] }, expected: [1, 2, 3, 4, 5, 6] },
    { name: 'Completed only', filters: { completed: [true] }, expected: [1, 3, 5] },
    { name: 'Pending only', filters: { completed: [false] }, expected: [2, 4, 6] },
    { name: 'One priority', filters: { priority: ['medium'] }, expected: [3, 4] },
    { name: 'Completed and medium', filters: { completed: [true], priority: ['medium'] }, expected: [3] },
  ];
  const model = createTaskModel(f.db);
  const results = cases.map(({ name, filters }) => ({ name, tasks: model.listTasks(filters) }));
  assert.equal(results.length, cases.length);
  for (const [index, result] of results.entries()) {
    assert.equal(result.name, cases[index].name);
    assert.deepEqual(result.tasks.map(row => row.id), cases[index].expected, result.name);
    assert.ok(result.tasks.every(row => typeof row.completed === 'boolean' && row.due_date === null));
  }
  assert.deepEqual(results[5].tasks, results[0].tasks);
  assert.deepEqual(taskSnapshot(f.db), before);
});

function taskSnapshot(db: Database.Database) {
  return {
    rows: db.prepare('SELECT * FROM tasks ORDER BY id').all(),
    sequence: db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'").get(),
  };
}

function storedTasks(db: Database.Database) {
  return (db.prepare('SELECT * FROM tasks ORDER BY id').all() as Record<string, unknown>[])
    .map(row => ({ ...row, id: Number(row.id), completed: row.completed === 1n }));
}

async function submit(url: string, method: 'POST' | 'PATCH', body: unknown) {
  const response = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function assertFields(result: Awaited<ReturnType<typeof submit>>, fields: string[]) {
  assert.equal(result.status, 400);
  assert.deepEqual(Object.keys(result.body), ['errors']);
  const errors = result.body.errors as { field: string; message: string }[];
  assert.deepEqual(errors.map(error => error.field), fields);
  assert.ok(errors.every(error => typeof error.message === 'string' && error.message.length > 0));
  return errors;
}

async function getFiltered(url: string, query: string) {
  const response = await fetch(`${url}/tasks${query ? '?' + query : ''}`);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test('GET aplica las seis consultas de filtros y sus resultados coinciden con SQLite', async (t) => {
  const f = fixture(t);
  const update = f.db.prepare('UPDATE tasks SET completed = ?, priority = ? WHERE id = ?');
  update.run(1, 'low', 1);
  update.run(0, 'low', 2);
  update.run(1, 'medium', 3);
  update.run(0, 'medium', 4);
  const insert = f.db.prepare('INSERT INTO tasks (title, completed, priority) VALUES (?, ?, ?)');
  insert.run('Completed high', 1, 'high');
  insert.run('Pending high', 0, 'high');
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  const cases: [string, number[]][] = [
    ['', [1, 2, 3, 4, 5, 6]],
    ['priority=low,medium', [1, 2, 3, 4]],
    ['priority=low,high', [1, 2, 5, 6]],
    ['priority=medium,high', [3, 4, 5, 6]],
    ['completed=false&priority=low,high', [2, 6]],
    ['completed=true,false&priority=low,medium,high', [1, 2, 3, 4, 5, 6]],
    ['completed=true', [1, 3, 5]],
    ['completed=false', [2, 4, 6]],
    ['priority=low', [1, 2]],
    ['priority=medium', [3, 4]],
    ['priority=high', [5, 6]],
    ['priority=high,low&completed=false', [2, 6]],
    ['priority=low%2Chigh', [1, 2, 5, 6]],
  ];
  const evidence: unknown[] = [];
  try {
    for (const [query, ids] of cases) {
      const result = await getFiltered(server.url, query);
      assert.equal(result.status, 200, query);
      const expected = ids.map(id => {
        const row = f.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>;
        return { ...row, id: Number(row.id), completed: row.completed === 1n };
      });
      assert.deepEqual(result.body, { tasks: expected, message: null }, query);
      evidence.push({ query, status: result.status, ids, persistedValuesMatch: true });
    }
    assert.deepEqual(taskSnapshot(f.db), before);
    fs.writeFileSync(path.join(projectRoot, 'data', 'filters-http-evidence.json'), JSON.stringify({
      node: process.version, database: 'temporary fixture', cases: evidence,
      rowsAndSequencePreserved: true,
    }, null, 2) + '\n');
  } finally { await server.stop(); }
});

test('GET rechaza valores inválidos y listas mal formadas con instrucciones en inglés', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  const invalid: Record<string, string[]> = {
    priority: ['', 'urgent', 'low,urgent', 'HIGH', 'low,HIGH', ' high', 'high ', 'low, high', 'low,,high', ',low', 'low,', 'null', 'false', '0', '["low"]', '{}', 'low\n', 'low\t', 'low\u00a0', "low') OR 1=1 --"],
    completed: ['', '1', '0', 'TRUE', 'False', 'true,1', 'true, false', ',true', 'false,', 'true,,false', 'null', 'yes', '[]', '{}', 'true\n', 'false\t'],
  };
  try {
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        const result = await getFiltered(server.url, `${field}=${encodeURIComponent(value)}`);
        const [error] = assertFields(result, [field]);
        assert.match(error.message, /contains an invalid value/);
        assert.match(error.message, /Example:/);
        assert.match(error.message, field === 'priority' ? /"low", "medium", or "high"/ : /"true", "false", or "true,false"/);
      }
      assertFields(await getFiltered(server.url, field), [field]);
    }
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('GET distingue valores duplicados de parámetros repetidos aunque sean iguales', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    for (const [query, field] of [
      ['priority=low,low', 'priority'], ['priority=low,high,low', 'priority'],
      ['completed=true,true', 'completed'], ['completed=false,true,false', 'completed'],
    ]) {
      const [error] = assertFields(await getFiltered(server.url, query), [field]);
      assert.match(error.message, /must not repeat values/);
      assert.match(error.message, /Example:/);
    }
    for (const [query, field] of [
      ['priority=low&priority=high', 'priority'], ['priority=low&priority=low', 'priority'],
      ['completed=false&completed=false', 'completed'], ['completed=true&completed=false', 'completed'],
      ['priority=low&%70riority=high', 'priority'],
    ]) {
      const [error] = assertFields(await getFiltered(server.url, query), [field]);
      assert.match(error.message, /must appear only once/);
      assert.match(error.message, /comma-separated list/);
    }
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('GET rechaza parámetros desconocidos, arreglos y objetos sin descartarlos silenciosamente', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    for (const field of ['unknown', 'Priority', 'title', 'due_date', 'priority[]', 'priority[0]', 'priority[value]', 'completed[]', 'completed[value]', '__proto__', '__proto__[priority]', 'constructor', 'toString', '']) {
      const [error] = assertFields(await getFiltered(server.url, `${encodeURIComponent(field)}=low`), [field]);
      assert.match(error.message, /is not allowed/);
      assert.match(error.message, /Use only "completed" and "priority"/);
    }
    // The native query reader must not truncate repeated occurrences or late keys.
    const oversized = Array.from({ length: 1001 }, () => 'priority=low').join('&') + '&zzz=bad';
    assertFields(await getFiltered(server.url, oversized), ['priority', 'zzz']);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('GET informa todos los campos inválidos en el orden acordado antes de consultar el modelo', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    // If validation incorrectly queries the model, conversion of this row would fail.
    f.db.prepare('INSERT INTO tasks (id, title, completed, priority) VALUES (?, ?, ?, ?)').run(500001n, 'External invalid ID', 0, 'low');
    const before = taskSnapshot(f.db);
    const result = await getFiltered(server.url, 'zzz=1&priority=urgent,HIGH&completed=TRUE,0&aaa=2');
    assertFields(result, ['completed', 'priority', 'aaa', 'zzz']);
    assertFields(await getFiltered(server.url, 'completed=false&priority=low,urgent'), ['priority']);
    assertFields(await getFiltered(server.url, 'priority=low&zzz=1'), ['zzz']);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('una consulta válida sin coincidencias devuelve lista vacía y mensaje en inglés con HTTP 200', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  try {
    const result = await getFiltered(server.url, 'priority=high');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { tasks: [], message: 'No matching tasks found.' });
    assert.deepEqual(f.db.prepare("SELECT * FROM tasks WHERE priority = 'high'").all(), []);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('GET sin filtros conserva el mismo contrato cuando la tabla está vacía', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    // Cover a table that becomes empty while the API is already running.
    f.db.prepare('DELETE FROM tasks').run();
    const before = taskSnapshot(f.db);
    assert.deepEqual(before.rows, []);
    const result = await getFiltered(server.url, '');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { tasks: [], message: 'No matching tasks found.' });
    assert.deepEqual(storedTasks(f.db), result.body.tasks);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('recorrido HTTP completo con prioridad y fecha coincide con SQLite', async (t) => {
  const f = fixture(t);
  const before = taskSnapshot(f.db);
  const server = await serve(f.db);
  const steps: unknown[] = [];
  try {
    const due = `${localDay()} 00:00:00`;
    const created = await submit(`${server.url}/tasks`, 'POST', { title: '  Integration task  ', priority: 'high', due_date: due });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(typeof id, 'number');
    assert.deepEqual({ title: created.body.title, priority: created.body.priority, due_date: created.body.due_date, completed: created.body.completed },
      { title: 'Integration task', priority: 'high', due_date: due, completed: false });
    const assertStored = (task: Record<string, unknown>) => {
      const row = f.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>;
      assert.deepEqual({ ...row, id: Number(row.id), completed: row.completed === 1n }, task);
      steps.push({ response: task, persisted: true });
    };
    assertStored(created.body);
    const listed = await fetch(`${server.url}/tasks`);
    assert.equal(listed.status, 200);
    const listBody = await listed.json() as { tasks: Record<string, unknown>[]; message: null };
    assert.deepEqual(listBody, { tasks: storedTasks(f.db), message: null });
    assert.deepEqual(listBody.tasks.at(-1), created.body);
    const changed = await submit(`${server.url}/tasks/${id}`, 'PATCH', { title: 'Updated integration task', completed: true, priority: 'low', due_date: '2400-02-29 23:59:59' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.created_at, created.body.created_at);
    assert.equal(changed.body.priority, 'low');
    assert.equal(changed.body.due_date, '2400-02-29 23:59:59');
    assert.equal(changed.body.completed, true);
    assertStored(changed.body);
    const cleared = await submit(`${server.url}/tasks/${id}`, 'PATCH', { due_date: '' });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body, { ...changed.body, due_date: null });
    assertStored(cleared.body);
    const removed = await fetch(`${server.url}/tasks/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    assert.equal(f.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id), undefined);
    assert.deepEqual(taskSnapshot(f.db).rows, before.rows);
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    fs.writeFileSync(path.join(projectRoot, 'data', 'fields-http-evidence.json'), JSON.stringify({
      runtime: process.version, database: 'isolated temporary fixture', steps,
      list: 200, deleted: 204, health: 200, originalRowsPreserved: true,
    }, null, 2) + '\n');
  } finally { await server.stop(); }
});

test('POST aplica medium y NULL únicamente según las entradas de ausencia aprobadas', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    for (const extra of [{}, { due_date: null }, { due_date: '' }, { due_date: '   ' }]) {
      const result = await submit(`${server.url}/tasks`, 'POST', { title: 'Defaults', ...extra });
      assert.equal(result.status, 201);
      assert.equal(result.body.priority, 'medium');
      assert.equal(result.body.due_date, null);
      assert.deepEqual(f.db.prepare('SELECT priority, due_date FROM tasks WHERE id = ?').get(result.body.id), { priority: 'medium', due_date: null });
    }
    for (const priority of ['low', 'medium', 'high']) {
      const result = await submit(`${server.url}/tasks`, 'POST', { title: 'Explicit', priority });
      assert.equal(result.status, 201);
      assert.equal(result.body.priority, priority);
    }
  } finally { await server.stop(); }
});

test('POST y PATCH rechazan todas las variantes inválidas de priority sin escrituras', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    const before = taskSnapshot(f.db);
    for (const priority of [null, '', ' ', 'LOW', 'Medium', 'HIGH', ' high ', 'high ', 'high\n', 'low\t', 0, false, [], {}]) {
      for (const method of ['POST', 'PATCH'] as const) {
        const result = await submit(`${server.url}/tasks${method === 'PATCH' ? '/1' : ''}`, method, { title: 'Must not persist', priority });
        const errors = assertFields(result, ['priority']);
        assert.match(errors[0].message, /"low", "medium", or "high"/);
        assert.match(errors[0].message, method === 'POST' ? /use "medium"/ : /keep its current value/);
      }
    }
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('POST y PATCH rechazan formatos, tipos, calendarios y días inválidos sin alterar SQLite', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    const before = taskSnapshot(f.db);
    const today = localDay();
    const yesterday = fixedNow();
    yesterday.setDate(yesterday.getDate() - 1);
    const invalid = [
      0, 123, true, false, [], {}, '\t', '\n', '\r', ' \t ', ' \n',
      ` ${today} 12:00:00`, `${today} 12:00:00 `, `${today} 12:00:00\n`,
      `${today}\t12:00:00`, `${today}T12:00:00`, `${today} 12:00:00Z`,
      `${today} 12:00:00-06:00`, `${today} 12:00:00.123`, `${today} 12:00`,
      `${today} 24:00:00`, `${today} 12:60:00`, `${today} 12:00:60`,
      '2400-00-01 12:00:00', '2400-13-01 12:00:00', '2400-01-00 12:00:00',
      '2400-04-31 12:00:00', '2100-02-29 12:00:00', `${localDay(yesterday)} 23:59:59`,
    ];
    for (const due_date of invalid) {
      for (const method of ['POST', 'PATCH'] as const) {
        const result = await submit(`${server.url}/tasks${method === 'PATCH' ? '/1' : ''}`, method, { title: 'Must not persist', due_date });
        const errors = assertFields(result, ['due_date']);
        assert.match(errors[0].message, /YYYY-MM-DD HH:mm:ss/);
      }
    }
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('lista todos los errores en orden fijo y rechaza campos fuera de cada operación', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    const before = taskSnapshot(f.db);
    const result = await submit(`${server.url}/tasks/1`, 'PATCH', {
      zzz: 1, due_date: 'bad', priority: 'HIGH', completed: 'false', title: '', aaa: 2,
    });
    assertFields(result, ['title', 'completed', 'priority', 'due_date', 'aaa', 'zzz']);
    const create = await submit(`${server.url}/tasks`, 'POST', {
      completed: false, priority: 'HIGH', title: '', due_date: 'bad', id: 1, created_at: 'bad',
    });
    assertFields(create, ['title', 'priority', 'due_date', 'completed', 'created_at', 'id']);
    for (const method of ['POST', 'PATCH'] as const) {
      const extra = JSON.parse('{"title":"Must not persist","__proto__":{},"constructor":1,"created_at":"bad","id":7,"prioritty":"high"}');
      assertFields(await submit(`${server.url}/tasks${method === 'PATCH' ? '/1' : ''}`, method, extra), ['__proto__', 'constructor', 'created_at', 'id', 'prioritty']);
    }
    assertFields(await submit(`${server.url}/tasks/1`, 'PATCH', { surprise: 1 }), ['surprise']);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('los cuerpos JSON no objeto y PATCH vacío devuelven el contrato de error body', async (t) => {
  const f = fixture(t);
  const server = await serve(f.db);
  try {
    const before = taskSnapshot(f.db);
    for (const body of [null, [], ['task'], false, true, 1, 'task', '']) {
      for (const method of ['POST', 'PATCH'] as const) {
        const result = await submit(`${server.url}/tasks${method === 'PATCH' ? '/1' : ''}`, method, body);
        assert.equal(assertFields(result, ['body'])[0].message, 'The request body must be a JSON object.');
      }
    }
    assertFields(await submit(`${server.url}/tasks`, 'POST', {}), ['title']);
    const errors = assertFields(await submit(`${server.url}/tasks/1`, 'PATCH', {}), ['body']);
    assert.match(errors[0].message, /"title", "completed", "priority", or "due_date"/);
    assert.deepEqual(taskSnapshot(f.db), before);
  } finally { await server.stop(); }
});

test('PATCH conserva campos omitidos y fechas históricas, y null o cadena vacía eliminan la fecha', async (t) => {
  const f = fixture(t);
  f.db.prepare("UPDATE tasks SET priority = 'high', due_date = '2000-01-01 12:00:00', completed = 1 WHERE id = 1").run();
  const server = await serve(f.db);
  try {
    const renamed = await submit(`${server.url}/tasks/1`, 'PATCH', { title: 'Renamed' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.priority, 'high');
    assert.equal(renamed.body.due_date, '2000-01-01 12:00:00');
    assert.equal(renamed.body.completed, true);
    const due = `${localDay()} 00:00:00`;
    for (const empty of [null, '']) {
      assert.equal((await submit(`${server.url}/tasks/1`, 'PATCH', { due_date: due })).status, 200);
      const before = taskSnapshot(f.db);
      const rejected = await submit(`${server.url}/tasks/1`, 'PATCH', { due_date: '   ' });
      const message = assertFields(rejected, ['due_date'])[0].message;
      assert.match(message, /remove the date/);
      assert.match(message, /keep it/);
      assert.deepEqual(taskSnapshot(f.db), before);
      const cleared = await submit(`${server.url}/tasks/1`, 'PATCH', { due_date: empty });
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.body, { ...renamed.body, due_date: null });
      assert.equal((f.db.prepare('SELECT due_date FROM tasks WHERE id = 1').get() as { due_date: null }).due_date, null);
    }
    const completed = await submit(`${server.url}/tasks/1`, 'PATCH', { completed: false });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.completed, false);
    assert.equal(completed.body.priority, 'high');
    const priority = await submit(`${server.url}/tasks/1`, 'PATCH', { priority: 'medium' });
    assert.equal(priority.status, 200);
    assert.equal(priority.body.title, 'Renamed');
    assert.equal(priority.body.priority, 'medium');
    assert.equal(priority.body.completed, false);
  } finally { await server.stop(); }
});

test('PATCH mixto inválido no aplica ninguno de los cambios ni activa escrituras', async (t) => {
  const f = fixture(t);
  f.db.exec('CREATE TABLE task_writes (task_id INTEGER); CREATE TRIGGER track_updates AFTER UPDATE ON tasks BEGIN INSERT INTO task_writes VALUES (NEW.id); END;');
  const server = await serve(f.db);
  try {
    const before = taskSnapshot(f.db);
    for (const body of [
      { title: 'Must not persist', priority: 'HIGH' },
      { completed: false, due_date: '   ' },
      { priority: 'low', completed: null },
      { title: 'Must not persist', id: 5 },
      { priority: 'high', due_date: '2000-01-01 12:00:00' },
    ]) {
      assert.equal((await submit(`${server.url}/tasks/1`, 'PATCH', body)).status, 400);
    }
    assert.deepEqual(taskSnapshot(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM task_writes').all(), []);
  } finally { await server.stop(); }
});
