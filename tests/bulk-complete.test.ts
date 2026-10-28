import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { BULK_COMPLETE_MAX_IDS } from '../src/schemas.js';
import { completedIdsInDb, resetTasks } from './helpers.js';

function bulkComplete(body: unknown) {
  return request(app).post('/tasks/bulk-complete').send(body as object);
}

describe('POST /tasks/bulk-complete', () => {
  beforeEach(() => {
    resetTasks();
  });

  it('completes the given tasks and returns how many were updated', async () => {
    const res = await bulkComplete({ ids: [1, 3] }).expect(200);

    expect(res.body).toEqual({ updated: 2, not_found: [] });
    expect(completedIdsInDb()).toEqual([1, 2, 3, 4]);
  });

  it('only counts tasks that were still open', async () => {
    const res = await bulkComplete({ ids: [1, 2, 4] }).expect(200);

    expect(res.body).toEqual({ updated: 1, not_found: [] });
    expect(completedIdsInDb()).toEqual([1, 2, 4]);
  });

  it('completes the ids that exist and reports the rest in not_found', async () => {
    const res = await bulkComplete({ ids: [999, 5, 42] }).expect(200);

    expect(res.body).toEqual({ updated: 1, not_found: [999, 42] });
    expect(completedIdsInDb()).toEqual([2, 4, 5]);
  });

  it('reports every id as not_found when none exist', async () => {
    const res = await bulkComplete({ ids: [100, 200] }).expect(200);

    expect(res.body).toEqual({ updated: 0, not_found: [100, 200] });
    expect(completedIdsInDb()).toEqual([2, 4]);
  });

  it('counts a repeated id once, in updated and in not_found', async () => {
    const res = await bulkComplete({ ids: [3, 3, 999, 3, 999] }).expect(200);

    expect(res.body).toEqual({ updated: 1, not_found: [999] });
  });

  it('is reflected by the completed filter', async () => {
    await bulkComplete({ ids: [1, 3, 5] }).expect(200);

    const res = await request(app).get('/tasks?completed=false').expect(200);
    expect(res.body).toEqual([]);
  });

  it(`accepts up to ${BULK_COMPLETE_MAX_IDS} ids`, async () => {
    const ids = Array.from({ length: BULK_COMPLETE_MAX_IDS }, (_, i) => i + 1);

    const res = await bulkComplete({ ids }).expect(200);
    expect(res.body.updated).toBe(3);
    expect(res.body.not_found).toHaveLength(BULK_COMPLETE_MAX_IDS - 5);
  });

  it.each([
    ['missing ids', {}, 'ids'],
    ['empty array', { ids: [] }, 'ids'],
    ['not an array', { ids: 1 }, 'ids'],
    ['string id', { ids: [1, '2'] }, 'ids.1'],
    ['zero', { ids: [0] }, 'ids.0'],
    ['negative id', { ids: [-1] }, 'ids.0'],
    ['fractional id', { ids: [1.5] }, 'ids.0'],
    ['unknown field', { ids: [1], all: true }, ''],
    [
      'too many ids',
      { ids: Array.from({ length: BULK_COMPLETE_MAX_IDS + 1 }, (_, i) => i + 1) },
      'ids',
    ],
  ])('rejects %s with a 400 and changes nothing', async (_label, body, path) => {
    const res = await bulkComplete(body).expect(400);

    expect(res.body.error).toBe('Invalid request body.');
    expect(res.body.details).toContainEqual({ path, message: expect.any(String) });
    expect(completedIdsInDb()).toEqual([2, 4]);
  });

  it('rejects malformed JSON with a JSON 400', async () => {
    const res = await request(app)
      .post('/tasks/bulk-complete')
      .set('Content-Type', 'application/json')
      .send('{"ids": [1,')
      .expect(400)
      .expect('Content-Type', /json/);

    expect(res.body).toEqual({ error: 'Request body is not valid JSON.' });
  });
});
