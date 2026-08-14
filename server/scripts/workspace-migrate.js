import { closePool, ensureDatabase, getPool } from '../db.js';
import {
  getMigrationStatus,
  rollbackLastMigration,
  runVersionedMigrations,
} from '../../packages/database/src/migrations.js';

const command = process.argv[2] || 'status';

try {
  await ensureDatabase();
  const db = getPool();
  if (command === 'up') {
    await runVersionedMigrations(db);
    console.log('Workspace migrations are up to date.');
  } else if (command === 'down') {
    if (process.env.ALLOW_MIGRATION_ROLLBACK !== 'true') {
      throw new Error('Set ALLOW_MIGRATION_ROLLBACK=true before running a rollback.');
    }
    const migration = await rollbackLastMigration(db);
    console.log(migration ? `Rolled back ${migration.version}: ${migration.name}` : 'No migration to roll back.');
  } else if (command === 'status') {
    const status = await getMigrationStatus(db);
    console.table(status);
  } else {
    throw new Error('Usage: node server/scripts/workspace-migrate.js [status|up|down]');
  }
} finally {
  await closePool();
}
