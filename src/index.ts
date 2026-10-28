import app from './app.js';
import { dbPath } from './db.js';

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`✅ Database initialized at ${dbPath}`);
  console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
});
