import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, getRow, resetDb } from './helpers.js';
import {
  BULK_IDS_ERROR,
  BULK_IDS_ITEM_ERROR,
  BULK_IDS_TOO_MANY_ERROR,
} from '../src/validation.js';

beforeEach(() => {
  resetDb();
});

const bulk = (body: unknown) =>
  request(app)
    .post('/tasks/bulk-complete')
    .send(body as object);

describe('POST /tasks/bulk-complete', () => {
  it('completes pending tasks and counts them', async () => {
    const res = await bulk({ ids: [1, 3] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(getRow(1)?.completed).toBe(1);
    expect(getRow(3)?.completed).toBe(1);
    expect(getRow(5)?.completed).toBe(0);
  });

  it('does not count already completed or unknown ids', async () => {
    const res = await bulk({ ids: [1, 2, 999] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    expect(getRow(1)?.completed).toBe(1);
    expect(getRow(2)?.completed).toBe(1);
  });

  it('dedupes repeated ids', async () => {
    const res = await bulk({ ids: [3, 3, 3] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
  });

  it('returns 0 when repeating the same request', async () => {
    await bulk({ ids: [1, 3] });
    const res = await bulk({ ids: [1, 3] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it('returns 0 when all ids are unknown', async () => {
    const res = await bulk({ ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it.each([[{}], [{ ids: [] }], [{ ids: '1' }]])('rejects %j', async (body) => {
    const res = await bulk(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(BULK_IDS_ERROR);
    expect(res.body.details[0].field).toBe('ids');
  });

  it('rejects a non-number id and writes nothing', async () => {
    const res = await bulk({ ids: [1, '2'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(BULK_IDS_ITEM_ERROR);
    expect(res.body.details[0].field).toBe('ids.1');
    expect(getRow(1)?.completed).toBe(0);
  });

  it.each([[0], [-1], [1.5]])('rejects id %s', async (id) => {
    const res = await bulk({ ids: [id] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(BULK_IDS_ITEM_ERROR);
  });

  it('rejects more than 500 ids', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await bulk({ ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(BULK_IDS_TOO_MANY_ERROR);
  });

  it('accepts exactly 500 ids', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const res = await bulk({ ids });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 3 });
  });
});
