import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetTasks } from './helpers.js';

describe('POST /tasks', () => {
  beforeEach(() => {
    resetTasks();
  });

  it('defaults priority to medium and due_date to null', async () => {
    const res = await request(app).post('/tasks').send({ title: '  trimmed  ' }).expect(201);

    expect(res.body).toMatchObject({
      title: 'trimmed',
      completed: false,
      priority: 'medium',
      due_date: null,
    });
  });

  it('normalizes due_date to a UTC ISO string', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 't', priority: 'high', due_date: '2026-12-31T10:30:00-06:00' })
      .expect(201);

    expect(res.body).toMatchObject({ priority: 'high', due_date: '2026-12-31T16:30:00.000Z' });
  });

  it.each([
    ['missing title', {}, 'title'],
    ['blank title', { title: '   ' }, 'title'],
    ['unknown priority', { title: 't', priority: 'urgent' }, 'priority'],
    ['impossible date', { title: 't', due_date: '2026-02-30' }, 'due_date'],
    ['datetime without offset', { title: 't', due_date: '2026-12-31T17:00:00' }, 'due_date'],
    ['unknown field', { title: 't', prio: 'high' }, ''],
  ])('rejects %s with a 400', async (_label, body, path) => {
    const res = await request(app).post('/tasks').send(body).expect(400);

    expect(res.body.details).toContainEqual({ path, message: expect.any(String) });
  });
});

describe('PATCH /tasks/:id', () => {
  beforeEach(() => {
    resetTasks();
  });

  it('updates priority and due_date, and clears due_date with null', async () => {
    await request(app)
      .patch('/tasks/1')
      .send({ priority: 'low', due_date: '2027-01-15' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ priority: 'low', due_date: '2027-01-15T00:00:00.000Z' });
      });

    const res = await request(app).patch('/tasks/1').send({ due_date: null }).expect(200);
    expect(res.body).toMatchObject({ priority: 'low', due_date: null });
  });

  it('rejects an empty body', async () => {
    await request(app).patch('/tasks/1').send({}).expect(400);
  });

  it.each(['abc', '0', '0x10', '1e2'])('rejects id %s with a 400', async (id) => {
    await request(app).patch(`/tasks/${id}`).send({ title: 't' }).expect(400);
  });

  it('returns 404 for a task that does not exist', async () => {
    await request(app).patch('/tasks/999').send({ title: 't' }).expect(404);
  });
});
