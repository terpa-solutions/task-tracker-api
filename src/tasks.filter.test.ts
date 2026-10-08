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

async function list(query: string) {
  const response = await fetch(`${base}/tasks${query}`);
  return { status: response.status, body: await response.json() };
}

/** Ids of the matching tasks, so assertions read as "which tasks came back". */
async function idsFor(query: string) {
  const { status, body } = await list(query);
  assert.equal(status, 200);
  return (body as Task[]).map((task) => task.id);
}

/**
 * These run against the seeded database (see seed.sql):
 *   1 high/completed   2 high/pending   3 medium/pending   4 low/pending
 */
describe('GET /tasks filtering', () => {
  it('returns every task when no filter is given', async () => {
    assert.deepEqual(await idsFor(''), [1, 2, 3, 4]);
  });

  it('filters by completed=true', async () => {
    assert.deepEqual(await idsFor('?completed=true'), [1]);
  });

  it('filters by completed=false', async () => {
    assert.deepEqual(await idsFor('?completed=false'), [2, 3, 4]);
  });

  it('filters by priority', async () => {
    assert.deepEqual(await idsFor('?priority=high'), [1, 2]);
    assert.deepEqual(await idsFor('?priority=medium'), [3]);
    assert.deepEqual(await idsFor('?priority=low'), [4]);
  });

  it('combines both filters', async () => {
    assert.deepEqual(await idsFor('?completed=false&priority=high'), [2]);
    assert.deepEqual(await idsFor('?completed=true&priority=high'), [1]);
  });

  it('returns an empty list when the combination matches nothing', async () => {
    assert.deepEqual(await idsFor('?completed=true&priority=low'), []);
  });

  it('exposes priority and due_date on each task', async () => {
    const { body } = await list('?priority=medium');
    assert.deepEqual((body as Task[])[0]?.priority, 'medium');
    assert.deepEqual((body as Task[])[0]?.due_date, '2026-09-20');
  });

  it('rejects an unknown priority with 400', async () => {
    const { status, body } = await list('?priority=urgent');
    assert.equal(status, 400);
    assert.match(JSON.stringify(body), /priority/);
  });

  it('rejects a non-boolean completed value with 400', async () => {
    assert.equal((await list('?completed=1')).status, 400);
    assert.equal((await list('?completed=yes')).status, 400);
  });
});
