import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Set before each test file is imported, so src/db.ts opens an in-memory
    // database and never touches data/tasks.db.
    env: { DB_PATH: ':memory:' },
    // Aborts the run before src/db.ts loads if DB_PATH is not :memory:.
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
