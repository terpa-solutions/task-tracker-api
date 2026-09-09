import express from 'express';
import { createTasksRouter } from './routes/tasks.js';
import type { TaskModel } from './models/tasks.model.js';
import { captureJsonSource } from './middleware/json-body.js';
import { errorHandler } from './middleware/error-handler.js';

/** Build an app without opening SQLite or listening on a port. */
export function createApp(model: TaskModel, { now }: { now?: () => Date } = {}) {
  const app = express();
  // Parse valid JSON values so Zod can report non-object bodies in our error format.
  app.use(express.json({ strict: false, limit: '100kb', verify: captureJsonSource }));
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/tasks', createTasksRouter(model, now));
  app.use(errorHandler);
  return app;
}
