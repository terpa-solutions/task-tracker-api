import app from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  console.log('✅ Database initialized at data/tasks.db');
  console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
});
