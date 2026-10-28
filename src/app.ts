import express, { type NextFunction, type Request, type Response } from 'express';
import './db.js'; // Import for its side effect: open DB, apply schema, seed.
import tasksRouter from './routes/tasks.js';

export const app = express();

app.use(express.json());

// Simple liveness check.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Task CRUD endpoints.
app.use('/tasks', tasksRouter);

// Express's default handler answers with an HTML page and a stack trace; keep
// errors in the API's JSON shape instead. The 4-argument signature is what
// marks this as an error handler.
type HttpError = Error & { type?: string; status?: number; expose?: boolean };

app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  // body-parser marks client errors (e.g. 413 payload too large) as safe to expose.
  if (err.expose && err.status !== undefined && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

export default app;
