import { closePool, ensureDatabase, getPool } from '../db.js';
import {
  claimIndexJob,
  completeIndexJob,
  enqueueIndexJob,
} from '../indexing.js';

const entityId = `__queue_smoke_${Date.now()}__`;

try {
  await ensureDatabase();
  await enqueueIndexJob({
    targetType: 'tasks',
    targetId: entityId,
    operation: 'upsert',
    reason: 'queue smoke test',
  });

  const job = await claimIndexJob('queue-smoke-test', { entityType: 'task', entityId });
  if (!job || job.entity_type !== 'task' || job.entity_id !== entityId || job.operation !== 'upsert') {
    throw new Error('Index queue did not return the expected job.');
  }
  await completeIndexJob(job.id);

  const [rows] = await getPool().query('SELECT status FROM ai_index_jobs WHERE id = ?', [job.id]);
  if (rows[0]?.status !== 'completed') {
    throw new Error('Index queue did not complete the claimed job.');
  }
  await getPool().query('DELETE FROM ai_index_jobs WHERE id = ?', [job.id]);
  console.log('Index queue smoke test passed: enqueue, claim, and completion work.');
} finally {
  await getPool().query(
    "DELETE FROM ai_index_jobs WHERE entity_type = 'task' AND entity_id = ?",
    [entityId],
  );
  await closePool();
}
