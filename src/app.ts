import express, { type Express, type Request, type Response } from 'express';
import './db.js'; // Import for its side effect: open DB, apply schema, seed.
import tasksRouter from './routes/tasks.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

/**
 * Build the Express application without starting a server, so it can be
 * mounted by `index.ts` (which calls `listen`) or used directly in tests.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Simple liveness check.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Task CRUD endpoints.
  app.use('/tasks', tasksRouter);

  // JSON 404 for unknown routes and JSON error responses (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
