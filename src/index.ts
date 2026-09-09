import { openDatabase } from './db.js';
import { createTaskModel } from './models/tasks.model.js';
import { createApp } from './app.js';

const PORT = 3000;
const db = openDatabase();
const app = createApp(createTaskModel(db));

const server = app.listen(PORT, () => {
  console.log('✅ Database initialized at data/tasks.db');
  console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
});

server.once('error', (error) => {
  db.close();
  console.error(error);
  process.exitCode = 1;
});

function shutdown() {
  server.close(() => db.close());
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
