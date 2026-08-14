import { closePool, ensureDatabase, getPool } from '../db.js';
import { syncLegacyWorkspaceData } from '../../apps/api/src/modules/resources/legacy-sync.js';

const descriptors = [
  { kind: 'task', table: 'task_attachments' },
  { kind: 'log', table: 'log_attachments' },
  { kind: 'note', table: 'note_attachments' },
];

try {
  await ensureDatabase();
  await syncLegacyWorkspaceData();
  const db = getPool();
  const report = { notes: {}, attachments: {}, mismatches: [] };

  const [[legacyNotes]] = await db.query('SELECT COUNT(*) AS count FROM task_notes');
  const [[newNotes]] = await db.query('SELECT COUNT(*) AS count FROM notes');
  report.notes = { legacy: Number(legacyNotes.count), unified: Number(newNotes.count) };
  if (report.notes.legacy !== report.notes.unified) report.mismatches.push('note_count');

  for (const descriptor of descriptors) {
    const [[legacy]] = await db.query(`SELECT COUNT(*) AS count FROM ${descriptor.table}`);
    const [[mapped]] = await db.query(
      'SELECT COUNT(*) AS count FROM legacy_resource_map WHERE legacy_kind = ?',
      [descriptor.kind],
    );
    const [[invalid]] = await db.query(
      `
        SELECT COUNT(*) AS count
        FROM legacy_resource_map map
        JOIN ${descriptor.table} legacy ON legacy.id = map.legacy_id
        JOIN resource_versions version ON version.id = map.version_id
        WHERE map.legacy_kind = ?
          AND (COALESCE(version.file_size, 0) <> COALESCE(legacy.file_size, 0)
            OR COALESCE(version.original_name, '') <> COALESCE(legacy.original_name, ''))
      `,
      [descriptor.kind],
    );
    report.attachments[descriptor.kind] = {
      legacy: Number(legacy.count),
      mapped: Number(mapped.count),
      metadataMismatches: Number(invalid.count),
    };
    if (Number(legacy.count) !== Number(mapped.count)) report.mismatches.push(`${descriptor.kind}_attachment_count`);
    if (Number(invalid.count)) report.mismatches.push(`${descriptor.kind}_attachment_metadata`);
  }

  const [[relationMismatch]] = await db.query(`
    SELECT COUNT(*) AS count
    FROM legacy_resource_map map
    LEFT JOIN resource_relations relation
      ON relation.resource_id = map.resource_id
     AND relation.target_type = map.legacy_kind
    WHERE relation.id IS NULL
  `);
  report.relationMismatches = Number(relationMismatch.count);
  if (report.relationMismatches) report.mismatches.push('resource_relations');

  console.log(JSON.stringify(report, null, 2));
  if (report.mismatches.length) {
    process.exitCode = 1;
    throw new Error(`Workspace reconciliation failed: ${report.mismatches.join(', ')}`);
  }
  console.log('Workspace reconciliation passed.');
} finally {
  await closePool();
}
