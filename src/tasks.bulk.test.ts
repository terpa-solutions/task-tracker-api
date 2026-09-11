import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Task } from './types.js';

// Must be set before ./app.js pulls in ./db.js, which reads it at import time.
process.env.DATABASE_PATH = ':memory:';

const { default: app } = await import('./app.js');

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

async function bulkComplete(payload: unknown) {
  const response = await fetch(`${base}/tasks/bulk-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

/** The set of task ids currently marked completed, read back from the API. */
async function completedIds() {
  const response = await fetch(`${base}/tasks?completed=true`);
  return ((await response.json()) as Task[]).map((task) => task.id);
}

/**
 * These run in order against the seeded database (see seed.sql):
 *   1 completed   2, 3, 4 pending
 */
describe('POST /tasks/bulk-complete', () => {
  it('completes the given tasks and reports how many changed', async () => {
    const { status, body } = await bulkComplete({ ids: [2, 3] });

    assert.equal(status, 200);
    assert.deepEqual(body, { updated: 2 });
    assert.deepEqual(await completedIds(), [1, 2, 3]);
  });

  it('does not re-count tasks that were already completed', async () => {
    const { status, body } = await bulkComplete({ ids: [2, 3] });

    assert.equal(status, 200);
    assert.deepEqual(body, { updated: 0 });
    assert.deepEqual(await completedIds(), [1, 2, 3]);
  });

  it('ignores ids that do not exist and counts only real changes', async () => {
    const { status, body } = await bulkComplete({ ids: [4, 999] });

    assert.equal(status, 200);
    assert.deepEqual(body, { updated: 1 });
    assert.deepEqual(await completedIds(), [1, 2, 3, 4]);
  });

  it('counts a duplicated id once', async () => {
    const created = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Duplicated in the payload' }),
    });
    const { id } = (await created.json()) as Task;

    const { body } = await bulkComplete({ ids: [id, id, id] });

    assert.deepEqual(body, { updated: 1 });
  });

  it('rejects an empty id list with 400', async () => {
    assert.equal((await bulkComplete({ ids: [] })).status, 400);
  });

  it('rejects ids that are not positive integers with 400', async () => {
    assert.equal((await bulkComplete({ ids: ['1'] })).status, 400);
    assert.equal((await bulkComplete({ ids: [1.5] })).status, 400);
    assert.equal((await bulkComplete({ ids: [-1] })).status, 400);
  });

  it('rejects a missing ids field with 400', async () => {
    assert.equal((await bulkComplete({})).status, 400);
  });
});
