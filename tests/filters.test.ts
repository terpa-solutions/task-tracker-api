import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, resetDb } from './helpers.js';
import { COMPLETED_QUERY_ERROR, PRIORITY_ERROR } from '../src/validation.js';

beforeEach(() => {
  resetDb();
});

const ids = (body: { id: number }[]) => body.map((t) => t.id);

describe('GET /tasks', () => {
  it('lists all tasks with the API shape', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([1, 2, 3, 4, 5]);
    for (const t of res.body) {
      expect(typeof t.completed).toBe('boolean');
      expect(t).toHaveProperty('priority');
      expect(t).toHaveProperty('due_date');
      expect(t.due_date).toBe(t.id === 5 ? '2026-12-31' : null);
    }
    expect(res.body[1].completed).toBe(true);
    expect(res.body[0].completed).toBe(false);
  });

  it.each([
    ['completed=true', [2, 4]],
    ['completed=false', [1, 3, 5]],
    ['priority=high', [3, 4]],
    ['completed=false&priority=high', [3]],
    ['completed=true&priority=low', []],
    ['foo=bar', [1, 2, 3, 4, 5]],
  ])('?%s', async (query, expected) => {
    const res = await request(app).get(`/tasks?${query}`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(expected);
  });

  it('rejects an invalid completed value', async () => {
    const res = await request(app).get('/tasks?completed=yes');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(COMPLETED_QUERY_ERROR);
    expect(res.body.details[0].field).toBe('completed');
  });

  it('rejects a priority with the wrong case', async () => {
    const res = await request(app).get('/tasks?priority=HIGH');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PRIORITY_ERROR);
  });

  it('rejects a repeated completed param', async () => {
    const res = await request(app).get('/tasks?completed=true&completed=false');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(COMPLETED_QUERY_ERROR);
  });
});
