import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Point the app at a throwaway database *before* importing it.
 *
 * db.ts opens its connection at import time, so this has to happen first —
 * hence the dynamic imports below rather than top-level static ones. Without
 * this the suite would run against data/tasks.db and wipe local dev data.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tracker-test-'));
process.env.TASKS_DB_PATH = path.join(tmpDir, 'tasks.test.db');

const { default: app } = await import('../src/app.js');
const { default: db } = await import('../src/db.js');

interface TaskResponse {
  id: number;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  created_at: string;
}

interface ErrorResponse {
  error: string;
  details?: { field: string; message: string }[];
}

interface BulkCompleteResponse {
  updated: number;
  alreadyCompleted: number[];
  notFound: number[];
}

let baseUrl = '';
let server: ReturnType<typeof app.listen>;

before(async () => {
  // Port 0 asks the OS for a free port, so the suite never collides with a dev
  // server already holding 3000.
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Close before deleting: Windows refuses to remove a file that is still open.
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Fixture {
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  due_date?: string | null;
}

/**
 * Replace the table contents and return the generated ids, in order.
 *
 * Rows are inserted directly rather than through POST /tasks: the arrange step
 * should not depend on the endpoint under test, and returning real ids keeps
 * assertions exact even though AUTOINCREMENT keeps climbing between tests.
 */
function seedTasks(rows: Fixture[]): number[] {
  db.exec('DELETE FROM tasks');
  const insert = db.prepare(
    'INSERT INTO tasks (title, completed, priority, due_date) VALUES (?, ?, ?, ?)',
  );
  return rows.map((row) =>
    Number(
      insert.run(row.title, row.completed ? 1 : 0, row.priority, row.due_date ?? null)
        .lastInsertRowid,
    ),
  );
}

/** Read `completed` straight from SQLite, to confirm what was actually persisted. */
function completedInDb(id: number): boolean {
  const row = db.prepare('SELECT completed FROM tasks WHERE id = ?').get(id) as
    | { completed: number }
    | undefined;
  return row?.completed === 1;
}

async function get<T>(pathname: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, body: (await response.json()) as T };
}

async function postJson<T>(
  pathname: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as T };
}

const idsOf = (tasks: TaskResponse[]): number[] => tasks.map((task) => task.id);

describe('GET /tasks filtering', () => {
  let ids: number[] = [];

  beforeEach(() => {
    // Deliberately spans every combination the filters need to tell apart:
    // both completed states against each priority.
    ids = seedTasks([
      { title: 'done high', completed: true, priority: 'high' },
      { title: 'open high', completed: false, priority: 'high' },
      { title: 'open medium', completed: false, priority: 'medium' },
      { title: 'open low', completed: false, priority: 'low' },
      { title: 'done low', completed: true, priority: 'low' },
    ]);
  });

  it('returns every task when no filter is given', async () => {
    const { status, body } = await get<TaskResponse[]>('/tasks');
    assert.equal(status, 200);
    assert.deepEqual(idsOf(body), ids);
  });

  it('filters by completed=true', async () => {
    const { status, body } = await get<TaskResponse[]>('/tasks?completed=true');
    assert.equal(status, 200);
    assert.deepEqual(idsOf(body), [ids[0], ids[4]]);
    assert.ok(
      body.every((task) => task.completed === true),
      'every returned task should be completed',
    );
  });

  it('filters by completed=false', async () => {
    const { body } = await get<TaskResponse[]>('/tasks?completed=false');
    assert.deepEqual(idsOf(body), [ids[1], ids[2], ids[3]]);
  });

  it('filters by priority', async () => {
    const { body } = await get<TaskResponse[]>('/tasks?priority=high');
    assert.deepEqual(idsOf(body), [ids[0], ids[1]]);
  });

  it('combines completed and priority with AND', async () => {
    const { status, body } = await get<TaskResponse[]>(
      '/tasks?completed=false&priority=high',
    );
    assert.equal(status, 200);
    // Only "open high" satisfies both — this is the assertion that would fail if
    // the filters were OR'd together or if one were silently dropped.
    assert.equal(body.length, 1);
    assert.equal(body[0].id, ids[1]);
    assert.equal(body[0].title, 'open high');
  });

  it('returns an empty array when a combination matches nothing', async () => {
    const { status, body } = await get<TaskResponse[]>(
      '/tasks?completed=true&priority=medium',
    );
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('rejects an invalid completed value instead of ignoring it', async () => {
    // ?completed=1 is a plausible typo; returning the unfiltered list here
    // would silently give the caller the wrong answer.
    const { status, body } = await get<ErrorResponse>('/tasks?completed=1');
    assert.equal(status, 400);
    assert.match(body.error, /completed/);
  });

  it('rejects an unknown priority value', async () => {
    const { status, body } = await get<ErrorResponse>('/tasks?priority=urgent');
    assert.equal(status, 400);
    assert.match(body.error, /low, medium, high/);
  });

  it('ignores unknown query params', async () => {
    const { status, body } = await get<TaskResponse[]>('/tasks?foo=bar');
    assert.equal(status, 200);
    assert.equal(body.length, ids.length);
  });
});

describe('POST /tasks/bulk-complete', () => {
  let ids: number[] = [];

  beforeEach(() => {
    ids = seedTasks([
      { title: 'already done', completed: true, priority: 'high' },
      { title: 'open one', completed: false, priority: 'medium' },
      { title: 'open two', completed: false, priority: 'low' },
    ]);
  });

  it('completes the given tasks and reports how many changed', async () => {
    const { status, body } = await postJson<BulkCompleteResponse>(
      '/tasks/bulk-complete',
      { ids: [ids[1], ids[2]] },
    );

    assert.equal(status, 200);
    assert.equal(body.updated, 2);
    assert.deepEqual(body.alreadyCompleted, []);
    assert.deepEqual(body.notFound, []);
  });

  it('persists the change to the database, not just the response', async () => {
    assert.equal(completedInDb(ids[1]), false, 'precondition: task starts open');

    await postJson<BulkCompleteResponse>('/tasks/bulk-complete', { ids: [ids[1]] });

    // Reading SQLite directly: a route could return a plausible count without
    // having written anything.
    assert.equal(completedInDb(ids[1]), true);
    // And the task must now show up under the completed filter.
    const { body } = await get<TaskResponse[]>('/tasks?completed=true');
    assert.ok(idsOf(body).includes(ids[1]));
  });

  it('does not count tasks that were already completed', async () => {
    const { body } = await postJson<BulkCompleteResponse>('/tasks/bulk-complete', {
      ids: [ids[0], ids[1]],
    });

    // ids[0] was already completed, so only one row actually changed. SQLite
    // would report 2 here if the UPDATE were not filtered on completed = 0.
    assert.equal(body.updated, 1);
    assert.deepEqual(body.alreadyCompleted, [ids[0]]);
  });

  it('reports ids that do not exist without failing the request', async () => {
    const missingId = 999_999;
    const { status, body } = await postJson<BulkCompleteResponse>(
      '/tasks/bulk-complete',
      { ids: [ids[1], missingId] },
    );

    assert.equal(status, 200);
    assert.equal(body.updated, 1);
    assert.deepEqual(body.notFound, [missingId]);
    assert.equal(completedInDb(ids[1]), true, 'the valid id is still applied');
  });

  it('counts a duplicated id only once', async () => {
    const { body } = await postJson<BulkCompleteResponse>('/tasks/bulk-complete', {
      ids: [ids[1], ids[1], ids[1]],
    });
    assert.equal(body.updated, 1);
  });

  it('leaves other tasks untouched', async () => {
    await postJson<BulkCompleteResponse>('/tasks/bulk-complete', { ids: [ids[1]] });
    assert.equal(completedInDb(ids[2]), false);
  });

  it('rejects a missing or empty ids array', async () => {
    for (const payload of [{}, { ids: [] }, { ids: 'nope' }]) {
      const { status, body } = await postJson<ErrorResponse>(
        '/tasks/bulk-complete',
        payload,
      );
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(payload)}`);
      assert.match(body.error, /ids/);
    }
  });

  it('rejects non-positive-integer ids and writes nothing', async () => {
    const { status } = await postJson<ErrorResponse>('/tasks/bulk-complete', {
      ids: [ids[1], 2.5],
    });
    assert.equal(status, 400);
    // The whole request is rejected, so the valid id in the same payload must
    // not have been applied.
    assert.equal(completedInDb(ids[1]), false);
  });
});

describe('task fields', () => {
  beforeEach(() => {
    seedTasks([]);
  });

  it('defaults priority to medium and due_date to null on create', async () => {
    const { status, body } = await postJson<TaskResponse>('/tasks', {
      title: 'no fields given',
    });
    assert.equal(status, 201);
    assert.equal(body.priority, 'medium');
    assert.equal(body.due_date, null);
    assert.equal(body.completed, false);
  });

  it('round-trips priority and due_date', async () => {
    const { status, body } = await postJson<TaskResponse>('/tasks', {
      title: 'with fields',
      priority: 'high',
      due_date: '2026-08-10',
    });
    assert.equal(status, 201);
    assert.equal(body.priority, 'high');
    assert.equal(body.due_date, '2026-08-10');

    const { body: listed } = await get<TaskResponse[]>('/tasks?priority=high');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].due_date, '2026-08-10');
  });

  it('rejects an impossible calendar date', async () => {
    const { status } = await postJson<ErrorResponse>('/tasks', {
      title: 'bad date',
      due_date: '2026-02-30',
    });
    assert.equal(status, 400);
  });
});
