import { workspaceResourcesMigration } from '../../../database/migrations/001-workspace-resources.js';
import { resourceActionsMigration } from '../../../database/migrations/002-resource-actions.js';
import { legacyNoteDualWriteMigration } from '../../../database/migrations/003-legacy-note-dual-write.js';
import { resourceAiDescriptionsMigration } from '../../../database/migrations/004-resource-ai-descriptions.js';

const migrations = [
  workspaceResourcesMigration,
  resourceActionsMigration,
  legacyNoteDualWriteMigration,
  resourceAiDescriptionsMigration,
];
const lockName = 'assistant_workspace_schema_migrations';

export async function runVersionedMigrations(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) NOT NULL,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [[lock]] = await db.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  if (Number(lock?.acquired) !== 1) {
    throw new Error('无法获取数据库迁移锁。');
  }

  try {
    for (const migration of migrations) {
      const [[existing]] = await db.query(
        'SELECT version FROM schema_migrations WHERE version = ? LIMIT 1',
        [migration.version],
      );
      if (existing) continue;

      await migration.up(db);
      await db.query(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
        [migration.version, migration.name],
      );
    }
  } finally {
    await db.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
  }
}

export async function getMigrationStatus(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) NOT NULL,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [applied] = await db.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
  const byVersion = new Map(applied.map((item) => [item.version, item]));
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    applied: byVersion.has(migration.version),
    appliedAt: byVersion.get(migration.version)?.applied_at || null,
  }));
}

export async function rollbackLastMigration(db) {
  const [[applied]] = await db.query(
    'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1',
  );
  if (!applied) return null;
  const migration = migrations.find((item) => item.version === applied.version);
  if (!migration?.down) throw new Error(`迁移 ${applied.version} 不支持回滚。`);

  const [[lock]] = await db.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  if (Number(lock?.acquired) !== 1) throw new Error('无法获取数据库迁移锁。');
  try {
    await migration.down(db);
    await db.query('DELETE FROM schema_migrations WHERE version = ?', [migration.version]);
    return { version: migration.version, name: migration.name };
  } finally {
    await db.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
  }
}
