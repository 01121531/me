import { ensureDatabase, getPool, closePool } from '../db.js';
import { extractAndCacheAttachmentText } from '../ai/attachment-cache.js';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : 0;

async function loadAttachments() {
  const sqlLimit = limit ? 'LIMIT ?' : '';
  const params = limit ? [limit] : [];
  const [rows] = await getPool().query(
    `
      SELECT 'log' AS kind, id, original_name, created_at FROM log_attachments
      UNION ALL
      SELECT 'note' AS kind, id, original_name, created_at FROM note_attachments
      UNION ALL
      SELECT 'task' AS kind, id, original_name, created_at FROM task_attachments
      ORDER BY created_at ASC, id ASC
      ${sqlLimit}
    `,
    params,
  );
  return rows;
}

try {
  await ensureDatabase();
  const attachments = await loadAttachments();
  let completed = 0;
  let failed = 0;
  let unsupported = 0;

  for (const [index, attachment] of attachments.entries()) {
    const label = `${attachment.kind}:${attachment.id} ${attachment.original_name}`;
    process.stdout.write(`[${index + 1}/${attachments.length}] ${label} ... `);
    const cache = await extractAndCacheAttachmentText(attachment.kind, attachment.id, { force });
    if (cache.status === 'completed') completed += 1;
    if (cache.status === 'failed') failed += 1;
    if (cache.status === 'unsupported') unsupported += 1;
    process.stdout.write(`${cache.status} ${Number(cache.text_chars || 0)} chars\n`);
  }

  console.log(`OCR backfill complete: completed=${completed}, failed=${failed}, unsupported=${unsupported}.`);
} finally {
  await closePool();
}
