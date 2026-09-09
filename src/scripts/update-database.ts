import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupAndUpdateDatabase, DatabaseUpdateError } from '../database-update.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const stringify = (value: unknown) => JSON.stringify(
  value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item, 2,
);

try {
  const report = await backupAndUpdateDatabase(
    path.join(projectRoot, 'data', 'tasks.db'),
    path.join(projectRoot, 'data', 'backups'),
  );
  console.log(stringify(report));
} catch (error) {
  console.error(stringify({
    status: 'error',
    stage: error instanceof DatabaseUpdateError ? error.stage : 'comando',
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof DatabaseUpdateError ? error.details : {}),
  }));
  process.exitCode = 1;
}
