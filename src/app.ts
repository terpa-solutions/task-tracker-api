import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import './db.js'; // Import for its side effect: open DB, apply schema, seed.
import tasksRouter from './routes/tasks.js';

/**
 * The configured Express app, with no server attached. `src/index.ts` starts
 * it for real; tests import it and listen on an ephemeral port instead.
 */
export const app = express();

app.use(express.json());

// Simple liveness check.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Task CRUD endpoints.
app.use('/tasks', tasksRouter);

/**
 * Nothing matched. Express would answer with an HTML page here too, so the
 * miss is reported in the same shape as every other error.
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}.` });
});

/**
 * Last resort error handler. Without it Express answers with an HTML page
 * carrying a stack trace, which an API client cannot parse and which leaks
 * internals.
 *
 * `express.json()` tags its own failures with an HTTP status — a malformed
 * body is a 400, an oversized one a 413 — so those are reported as-is.
 * Anything untagged is a bug on our side: log it, and tell the client nothing
 * beyond the status.
 */
app.use(
  (
    error: Error & { status?: number },
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (res.headersSent) {
      return next(error);
    }

    const status = error.status ?? 500;

    if (status >= 500) {
      console.error(error);
      return res.status(500).json({ error: 'Internal server error.' });
    }

    res.status(status).json({ error: error.message });
  },
);

export default app;
