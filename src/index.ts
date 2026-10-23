import path from 'node:path';
import { createApp } from './app.js';
import { dbPath } from './db.js';

const PORT = Number(process.env.PORT) || 3000;

createApp().listen(PORT, () => {
  const shownDbPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
  console.log(`✅ Database initialized at ${shownDbPath}`);
  console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
});
