import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import './db.js'; // Import for its side effect: open DB, apply schema, migrate, seed.
import tasksRouter from './routes/tasks.js';

/**
 * The Express app, with no server attached.
 *
 * Kept separate from `index.ts` so tests can bind it to an ephemeral port
 * instead of racing the real server for port 3000.
 */
export const app = express();

app.use(express.json());

// Simple liveness check.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Task CRUD endpoints.
app.use('/tasks', tasksRouter);

// Anything unmatched is a JSON 404 — without this Express replies with an HTML
// error page, which is jarring for a client that asked for JSON.
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}.` });
});

/**
 * Final error handler.
 *
 * Express only treats a middleware as an error handler if it declares four
 * parameters, hence the unused `_next`.
 *
 * A malformed JSON body otherwise surfaces as an HTML page containing a stack
 * trace with absolute filesystem paths, so it is caught here and turned into a
 * plain 400. Everything else becomes a generic 500: the real error goes to the
 * server log rather than to the client.
 */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser marks its JSON parse failures by attaching the raw body.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

export default app;
