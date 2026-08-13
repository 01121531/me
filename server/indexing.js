import { getPool } from './db.js';

const entityTypeByTarget = {
  tasks: 'task',
  logs: 'log',
  notes: 'note',
  'log-attachments': 'log_attachment',
  'note-attachments': 'note_attachment',
  'task-attachments': 'task_attachment',
};

function normalizeTarget(targetType, targetId) {
  const entityType = entityTypeByTarget[targetType];
  const entityId = targetId === undefined || targetId === null ? '' : String(targetId);
  if (!entityType || !entityId) return null;
  return { entityType, entityId };
}

export async function enqueueIndexJob({ targetType, targetId, operation, reason }) {
  const target = normalizeTarget(targetType, targetId);
  if (!target) return null;

  const db = getPool();
  const [updated] = await db.query(
    `
      UPDATE ai_index_jobs
      SET operation = ?, reason = ?, available_at = CURRENT_TIMESTAMP,
          locked_at = NULL, locked_by = NULL, last_error = NULL
      WHERE entity_type = ? AND entity_id = ? AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `,
    [operation, reason, target.entityType, target.entityId],
  );
  if (updated.affectedRows) return null;

  const [result] = await db.query(
    `
      INSERT INTO ai_index_jobs (entity_type, entity_id, operation, reason)
      VALUES (?, ?, ?, ?)
    `,
    [target.entityType, target.entityId, operation, reason],
  );
  return result.insertId;
}

export function scheduleIndexJob(input) {
  enqueueIndexJob(input).catch((error) => {
    console.error('Failed to enqueue AI index job:', error.message);
  });
}

export async function getIndexStatus() {
  const [counts] = await getPool().query(
    `
      SELECT status, COUNT(*) AS count
      FROM ai_index_jobs
      GROUP BY status
    `,
  );
  const [recentFailures] = await getPool().query(
    `
      SELECT id, entity_type, entity_id, operation, attempts, last_error, updated_at
      FROM ai_index_jobs
      WHERE status = 'failed'
      ORDER BY updated_at DESC, id DESC
      LIMIT 10
    `,
  );
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
    recentFailures,
  };
}

export async function claimIndexJob(workerId, target = null) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const targetClause = target ? ' AND entity_type = ? AND entity_id = ?' : '';
    const params = target ? [target.entityType, String(target.entityId)] : [];
    const [rows] = await connection.query(
      `
        SELECT *
        FROM ai_index_jobs
        WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP${targetClause}
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
      `,
      params,
    );
    const job = rows[0];
    if (!job) {
      await connection.commit();
      return null;
    }
    await connection.query(
      `
        UPDATE ai_index_jobs
        SET status = 'processing', attempts = attempts + 1,
            locked_at = CURRENT_TIMESTAMP, locked_by = ?
        WHERE id = ?
      `,
      [workerId, job.id],
    );
    await connection.commit();
    return { ...job, attempts: Number(job.attempts) + 1 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function completeIndexJob(jobId) {
  await getPool().query(
    `
      UPDATE ai_index_jobs
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          locked_at = NULL, locked_by = NULL, last_error = NULL
      WHERE id = ?
    `,
    [jobId],
  );
}

export async function failIndexJob(job, error, maxAttempts) {
  const message = String(error?.message || error || 'Unknown indexing failure').slice(0, 4000);
  if (Number(job.attempts) >= maxAttempts) {
    await getPool().query(
      `
        UPDATE ai_index_jobs
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
            locked_at = NULL, locked_by = NULL, last_error = ?
        WHERE id = ?
      `,
      [message, job.id],
    );
    return;
  }

  const retrySeconds = Math.min(300, 5 * (2 ** Math.max(0, Number(job.attempts) - 1)));
  await getPool().query(
    `
      UPDATE ai_index_jobs
      SET status = 'pending', available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
          locked_at = NULL, locked_by = NULL, last_error = ?
      WHERE id = ?
    `,
    [retrySeconds, message, job.id],
  );
}
