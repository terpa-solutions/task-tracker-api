import app from './app.js';
import db, { dbPath } from './db.js';

const PORT = 3000;

console.log(`✅ Database initialized at ${dbPath}`);

const server = app.listen(PORT, () => {
  console.log(`🚀 Task Tracker API running at http://localhost:${PORT}`);
});

/**
 * Stop accepting requests, let in-flight ones finish, then close the database.
 * Without the explicit close, WAL mode leaves `-wal` and `-shm` files next to
 * the database on exit.
 *
 * `server.close()` is enough on its own here: since Node 19 it drops idle
 * keep-alive sockets by itself, so only real work keeps the process alive.
 */
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down.`);

  server.close(() => {
    db.close();
    console.log('Database closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
