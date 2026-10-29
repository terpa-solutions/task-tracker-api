import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  const ins = db.prepare('INSERT INTO tasks (title, completed, priority, due_date) VALUES (?,?,?,?)');
  ins.run('Alpha', 0, 'high', null);
  ins.run('Beta', 1, 'low', '2026-12-31');
  ins.run('Gamma', 0, 'medium', null);
});

describe('GET /tasks filtering', () => {
  it('returns all tasks when no filters are applied', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('filters by completed=false', async () => {
    const res = await request(app).get('/tasks?completed=false');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((t: { completed: boolean }) => !t.completed)).toBe(true);
  });

  it('filters by completed=true', async () => {
    const res = await request(app).get('/tasks?completed=true');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Beta');
  });

  it('filters by priority=high', async () => {
    const res = await request(app).get('/tasks?priority=high');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].priority).toBe('high');
  });

  it('combines completed=false and priority=medium', async () => {
    const res = await request(app).get('/tasks?completed=false&priority=medium');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Gamma');
  });

  it('returns 400 for invalid completed value', async () => {
    const res = await request(app).get('/tasks?completed=maybe');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid priority value', async () => {
    const res = await request(app).get('/tasks?priority=urgent');
    expect(res.status).toBe(400);
  });
});

describe('POST /tasks/bulk-complete', () => {
  it('marks matching incomplete tasks completed and returns updated count', async () => {
    const rows = db.prepare('SELECT id FROM tasks WHERE completed = 0').all() as { id: number }[];
    const res = await request(app)
      .post('/tasks/bulk-complete')
      .send({ ids: rows.map((r) => r.id) });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
  });

  it('returns 0 for already-completed tasks', async () => {
    const row = db.prepare('SELECT id FROM tasks WHERE completed = 1').get() as { id: number };
    const res = await request(app).post('/tasks/bulk-complete').send({ ids: [row.id] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  it('returns 400 for empty ids array', async () => {
    const res = await request(app).post('/tasks/bulk-complete').send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids is missing', async () => {
    const res = await request(app).post('/tasks/bulk-complete').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer ids', async () => {
    const res = await request(app).post('/tasks/bulk-complete').send({ ids: [1.5, 2] });
    expect(res.status).toBe(400);
  });
});

describe('POST /tasks', () => {
  it('creates a task with default priority', async () => {
    const res = await request(app).post('/tasks').send({ title: 'New task' });
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('medium');
    expect(res.body.due_date).toBeNull();
  });

  it('creates a task with priority and due_date', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Urgent', priority: 'high', due_date: '2026-11-01' });
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('high');
    expect(res.body.due_date).toBe('2026-11-01');
  });

  it('returns 400 for empty title', async () => {
    const res = await request(app).post('/tasks').send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid due_date format', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Bad date', due_date: '01-11-2026' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /tasks/:id', () => {
  it('updates priority and due_date', async () => {
    const row = db.prepare('SELECT id FROM tasks').get() as { id: number };
    const res = await request(app)
      .patch(`/tasks/${row.id}`)
      .send({ priority: 'low', due_date: '2026-12-01' });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('low');
    expect(res.body.due_date).toBe('2026-12-01');
  });

  it('returns 400 when no fields are provided', async () => {
    const row = db.prepare('SELECT id FROM tasks').get() as { id: number };
    const res = await request(app).patch(`/tasks/${row.id}`).send({});
    expect(res.status).toBe(400);
  });
});
