import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import type { Task } from '../src/types.js';
import { resetTasks } from './helpers.js';

async function listIds(query: string): Promise<number[]> {
  const res = await request(app).get(`/tasks${query}`).expect(200);
  return (res.body as Task[]).map((task) => task.id);
}

describe('GET /tasks filtering', () => {
  beforeEach(() => {
    resetTasks();
  });

  it('returns every task, oldest first, without filters', async () => {
    expect(await listIds('')).toEqual([1, 2, 3, 4, 5]);
  });

  it('filters by completed=true and completed=false', async () => {
    expect(await listIds('?completed=true')).toEqual([2, 4]);
    expect(await listIds('?completed=false')).toEqual([1, 3, 5]);
  });

  it('filters by priority', async () => {
    expect(await listIds('?priority=high')).toEqual([1, 2]);
    expect(await listIds('?priority=medium')).toEqual([3]);
    expect(await listIds('?priority=low')).toEqual([4, 5]);
  });

  it('combines filters with AND', async () => {
    expect(await listIds('?completed=false&priority=low')).toEqual([5]);
    expect(await listIds('?priority=high&completed=true')).toEqual([2]);
    expect(await listIds('?completed=true&priority=medium')).toEqual([]);
  });

  it('returns tasks in the API shape, with completed as a boolean', async () => {
    const res = await request(app).get('/tasks?completed=true&priority=low').expect(200);
    expect(res.body).toEqual([
      {
        id: 4,
        title: 'done low',
        completed: true,
        priority: 'low',
        due_date: null,
        created_at: expect.any(String),
      },
    ]);
  });

  it.each([
    ['?completed=yes', 'completed'],
    ['?completed=1', 'completed'],
    ['?completed=', 'completed'],
    ['?priority=urgent', 'priority'],
    ['?priority=high&priority=low', 'priority'],
    ['?priorty=high', ''],
    ['?completed=true&foo=bar', ''],
  ])('rejects %s with a 400', async (query, param) => {
    const res = await request(app).get(`/tasks${query}`).expect(400);
    expect(res.body.error).toBe('Invalid query parameters.');
    expect(res.body.details).toEqual([{ path: param, message: expect.any(String) }]);
  });
});
