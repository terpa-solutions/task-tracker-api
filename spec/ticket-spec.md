# Task Tracker API — Missing Features Spec

## Gap Analysis

| Área | Estado actual | Requerido por el ticket |
|------|--------------|------------------------|
| `schema.sql` | `id, title, completed, created_at` | + columnas `priority`, `due_date` |
| `src/types.ts` | `TaskRow`, `Task`, `toTask` básicos | Extender los tres + tipo `Priority` |
| `GET /tasks` | Lista todo sin filtros | Soportar `?completed=` y `?priority=` |
| Endpoints | 4 rutas CRUD | + `POST /tasks/bulk-complete` |
| Validación | `typeof` manual en title/completed | Zod en create, update y bulk-complete |
| Tests | Ninguno instalado | ≥ 2 tests (filtrado + bulk-complete) |
| Deps | `express`, `better-sqlite3` | + `zod`, `vitest`, `supertest` |
| `seed.sql` | Sin `priority`/`due_date` | Actualizar las 4 filas seed |

---

## Step 1 — Schema & Types

### schema.sql

Agregar columnas con `ALTER TABLE ADD COLUMN` (idempotente, SQLite ≥ 3.37 incluido en better-sqlite3 v11):

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
  priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS
  due_date TEXT;  -- nullable, formato ISO 8601: "2026-12-31"
```

### src/types.ts

```typescript
export type Priority = 'low' | 'medium' | 'high';

export interface TaskRow {
  id: number;
  title: string;
  completed: 0 | 1;
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    priority: row.priority,
    due_date: row.due_date,
    created_at: row.created_at,
  };
}
```

### seed.sql

```sql
INSERT INTO tasks (title, completed, priority) VALUES
  ('Set up local development environment', 1, 'high'),
  ('Review the interview ticket in the README', 0, 'medium'),
  ('Sketch out the API changes before writing code', 0, 'medium'),
  ('Open a pull request with the completed work', 0, 'low');
```

---

## Step 2 — GET /tasks con filtros

| Param | Valores válidos | Efecto |
|-------|----------------|--------|
| `completed` | `"true"` \| `"false"` | Filtra por estado de completado |
| `priority` | `"low"` \| `"medium"` \| `"high"` | Filtra por prioridad |
| (ninguno) | — | Devuelve todas las tareas |

Implementación en `src/routes/tasks.ts`:

```typescript
tasksRouter.get('/', (req: Request, res: Response) => {
  const { completed, priority } = req.query;
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (completed !== undefined) {
    if (completed !== 'true' && completed !== 'false')
      return res.status(400).json({ error: 'completed must be "true" or "false".' });
    conditions.push('completed = ?');
    params.push(completed === 'true' ? 1 : 0);
  }

  if (priority !== undefined) {
    if (!['low', 'medium', 'high'].includes(priority as string))
      return res.status(400).json({ error: 'priority must be "low", "medium", or "high".' });
    conditions.push('priority = ?');
    params.push(priority as string);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM tasks ${where} ORDER BY id ASC`).all(...params) as TaskRow[];
  res.json(rows.map(toTask));
});
```

Ejemplo curl:
```bash
curl "http://localhost:3000/tasks?completed=false"
curl "http://localhost:3000/tasks?priority=high"
curl "http://localhost:3000/tasks?completed=false&priority=medium"
```

---

## Step 3 — POST /tasks/bulk-complete

**Contrato:**
```
POST /tasks/bulk-complete
{ "ids": [1, 2, 3] }

→ 200  { "updated": 2 }
→ 400  { "error": "..." }
```

**Reglas:**
- `ids` debe ser array no vacío de enteros positivos.
- Solo cuenta las filas que realmente cambiaron (completed 0 → 1).
- Registrar ANTES de `/:id` para evitar conflicto de rutas.

```typescript
tasksRouter.post('/bulk-complete', (req: Request, res: Response) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 ||
      !ids.every((x) => Number.isInteger(x) && x > 0)) {
    return res.status(400).json({ error: '"ids" must be a non-empty array of positive integers.' });
  }
  const placeholders = ids.map(() => '?').join(', ');
  const info = db.prepare(
    `UPDATE tasks SET completed = 1 WHERE id IN (${placeholders}) AND completed = 0`
  ).run(...ids);
  res.json({ updated: info.changes });
});
```

Ejemplo curl:
```bash
curl -X POST http://localhost:3000/tasks/bulk-complete \
  -H "Content-Type: application/json" \
  -d '{"ids":[2,3,4]}'
# → {"updated":2}
```

---

## Step 4 — Validación con Zod

```bash
npm install zod
```

**src/validation.ts** (archivo nuevo):

```typescript
import { z } from 'zod';

const Priority = z.enum(['low', 'medium', 'high']);

export const CreateTaskSchema = z.object({
  title: z.string().min(1, '"title" must be a non-empty string'),
  priority: Priority.default('medium'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '"due_date" must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    completed: z.boolean().optional(),
    priority: Priority.optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const BulkCompleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, '"ids" must be a non-empty array'),
});

export const TaskQuerySchema = z.object({
  completed: z.enum(['true', 'false']).optional(),
  priority: Priority.optional(),
});

export function zodError(e: import('zod').ZodError) {
  return { error: e.errors.map((i) => i.message).join('; ') };
}
```

Patrón de uso en routes:
```typescript
const parsed = CreateTaskSchema.safeParse(req.body);
if (!parsed.success) return res.status(400).json(zodError(parsed.error));
const { title, priority, due_date } = parsed.data;
```

---

## Step 5 — Tests

```bash
npm install -D vitest supertest @types/supertest
```

Agregar a `package.json`:
```json
"test": "vitest run"
```

**Requisito previo:** exportar `app` en `src/index.ts` sin llamar `.listen()`:
```typescript
export default app; // antes del listen()
```

**src/routes/tasks.test.ts:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  const ins = db.prepare('INSERT INTO tasks (title, completed, priority) VALUES (?,?,?)');
  ins.run('Alpha', 0, 'high');
  ins.run('Beta', 1, 'low');
  ins.run('Gamma', 0, 'medium');
});

describe('GET /tasks filtering', () => {
  it('filters by completed=false', async () => {
    const res = await request(app).get('/tasks?completed=false');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((t: any) => !t.completed)).toBe(true);
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
});

describe('POST /tasks/bulk-complete', () => {
  it('marks matching tasks completed and returns count', async () => {
    const rows = db.prepare('SELECT id FROM tasks WHERE completed = 0').all() as { id: number }[];
    const res = await request(app)
      .post('/tasks/bulk-complete')
      .send({ ids: rows.map((r) => r.id) });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
  });

  it('returns 400 for empty ids array', async () => {
    const res = await request(app).post('/tasks/bulk-complete').send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('returns 0 for already-completed tasks', async () => {
    const row = db.prepare('SELECT id FROM tasks WHERE completed = 1').get() as { id: number };
    const res = await request(app).post('/tasks/bulk-complete').send({ ids: [row.id] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });
});
```

---

## Step 6 — README updates

Tabla de endpoints actualizada:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/tasks` | Lista tareas. Opcional: `?completed=true\|false`, `?priority=low\|medium\|high` |
| `POST` | `/tasks` | Crea tarea: `{ "title", "priority"?, "due_date"? }` |
| `PATCH` | `/tasks/:id` | Actualiza `title`, `completed`, `priority`, `due_date` |
| `DELETE` | `/tasks/:id` | Elimina tarea |
| `POST` | `/tasks/bulk-complete` | Marca múltiples tareas: `{ "ids": number[] }` → `{ "updated": N }` |

---

## Orden de implementación recomendado

1. `schema.sql` → `seed.sql` → `src/types.ts`
2. `src/validation.ts` (schemas Zod)
3. `src/routes/tasks.ts` (actualizar insertStmt, PATCH, bulk-complete, filtros GET)
4. `src/index.ts` (exportar `app`)
5. `src/routes/tasks.test.ts` (tests)
6. `README.md` (tabla y curls)

## Oblicacion
- cada item que resuelvas realizaras el check del spec.
- Realiza commit y cuando vayas a realizar un pr debes de avisar.
- Si realisas otras tareas que no estan especificas en el archivo spec debes de avisar.