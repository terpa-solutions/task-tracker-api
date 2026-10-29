import express, { type Request, type Response } from 'express';
import './db.js';
import tasksRouter from './routes/tasks.js';

const PORT = 3000;

const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/tasks', tasksRouter);

export default app;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log('✅ Database initialized at data/tasks.db');
    console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
  });
}
