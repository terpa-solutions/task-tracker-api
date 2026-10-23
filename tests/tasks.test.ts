import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, getRow, resetDb } from './helpers.js';
import {
  COMPLETED_BOOL_ERROR,
  DUE_DATE_ERROR,
  PATCH_EMPTY_ERROR,
  PRIORITY_ERROR,
  TITLE_REQUIRED_ERROR,
} from '../src/validation.js';

beforeEach(() => {
  resetDb();
});

describe('POST /tasks', () => {
  it('creates a task with defaults', async () => {
    const res = await request(app).post('/tasks').send({ title: 'X' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'X',
      priority: 'medium',
      due_date: null,
      completed: false,
    });
    expect(res.body.id).toBe(6);
  });

  it('creates a task with priority and due_date and stores them', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'X', priority: 'high', due_date: '2026-11-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'X',
      priority: 'high',
      due_date: '2026-11-01',
      completed: false,
    });
    expect(getRow(res.body.id)).toMatchObject({
      title: 'X',
      priority: 'high',
      due_date: '2026-11-01',
      completed: 0,
    });
  });

  it.each([[{}], [{ title: '   ' }]])('rejects missing/blank title %j', async (body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(TITLE_REQUIRED_ERROR);
    expect(res.body.details[0].field).toBe('title');
  });

  it('rejects an unknown priority', async () => {
    const res = await request(app).post('/tasks').send({ title: 'X', priority: 'urgent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PRIORITY_ERROR);
  });

  it.each(['2026-02-30', '2026-11-01T10:00:00Z'])('rejects due_date %s', async (due) => {
    const res = await request(app).post('/tasks').send({ title: 'X', due_date: due });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(DUE_DATE_ERROR);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed JSON body.' });
  });
});

describe('PATCH /tasks/:id', () => {
  it('rejects an empty body', async () => {
    const res = await request(app).patch('/tasks/1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(PATCH_EMPTY_ERROR);
    expect(res.body.details[0].field).toBeNull();
  });

  it('rejects a non-boolean completed', async () => {
    const res = await request(app).patch('/tasks/1').send({ completed: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(COMPLETED_BOOL_ERROR);
  });

  it('clears due_date with null', async () => {
    const res = await request(app).patch('/tasks/5').send({ due_date: null });
    expect(res.status).toBe(200);
    expect(res.body.due_date).toBeNull();
    expect(getRow(5)?.due_date).toBeNull();
  });

  it('returns 404 for an unknown task', async () => {
    const res = await request(app).patch('/tasks/999').send({ completed: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Task 999 not found.' });
  });
});

describe('invalid task ids', () => {
  it.each(['abc', '1e2', '0x10', '1.0'])('PATCH /tasks/%s -> 400', async (id) => {
    const res = await request(app).patch(`/tasks/${id}`).send({ completed: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid task id.' });
  });

  it.each(['abc', '1e2', '0x10', '1.0'])('DELETE /tasks/%s -> 400', async (id) => {
    const res = await request(app).delete(`/tasks/${id}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid task id.' });
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes once, then 404', async () => {
    const first = await request(app).delete('/tasks/1');
    expect(first.status).toBe(204);
    expect(getRow(1)).toBeUndefined();

    const second = await request(app).delete('/tasks/1');
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ error: 'Task 1 not found.' });
  });
});

describe('unknown routes', () => {
  it('returns JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route GET /nope not found.' });
  });
});
