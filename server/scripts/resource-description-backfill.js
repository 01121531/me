import { closePool, ensureDatabase, getPool } from '../db.js';
import { processResourceVersion } from '../../apps/worker/src/resource-processing.js';

const force = process.argv.includes('--all');
let completed = 0;
let failed = 0;

try {
  await ensureDatabase();
  const [versions] = await getPool().query(
    `
      SELECT latest.id
      FROM resources resource
      JOIN resource_versions latest
        ON latest.resource_id = resource.id
       AND latest.version_no = (
         SELECT MAX(candidate.version_no)
         FROM resource_versions candidate
         WHERE candidate.resource_id = resource.id
       )
      LEFT JOIN resource_contents content ON content.version_id = latest.id
      WHERE resource.deleted_at IS NULL
        AND (? = 1 OR content.auto_description IS NULL OR content.description_status IN ('pending', 'failed'))
      ORDER BY resource.id
    `,
    [force ? 1 : 0],
  );

  console.log(`Found ${versions.length} resource version(s) to describe.`);
  for (const version of versions) {
    try {
      await processResourceVersion(Number(version.id));
      completed += 1;
      console.log(`[${completed + failed}/${versions.length}] completed`);
    } catch (error) {
      failed += 1;
      console.error(`[${completed + failed}/${versions.length}] failed: ${error.message}`);
    }
  }
  console.log(JSON.stringify({ total: versions.length, completed, failed }, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  await closePool();
}
