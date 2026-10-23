// Runs before each test file is imported (vitest `setupFiles`), so this guard
// fires before src/db.ts opens any database: never run the suite against a
// real database file.
if (process.env.DB_PATH !== ':memory:') {
  throw new Error('Tests must run with DB_PATH=:memory:');
}
