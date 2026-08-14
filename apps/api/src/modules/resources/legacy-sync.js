import crypto from 'node:crypto';
import { config } from '../../../../../server/config.js';
import { getPool } from '../../../../../server/db.js';
import { readStoredAttachment } from '../../../../../server/storage.js';
import {
  normalizeTaxonomyName,
  normalizedTaxonomyKey,
  splitLegacyTags,
} from '../../../../../packages/domain/src/taxonomy.js';

async function getDefaultWorkspaceId(db) {
  const [[workspace]] = await db.query(
    'SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1',
  );
  if (!workspace) throw new Error('默认工作区不存在。');
  return Number(workspace.id);
}

async function ensureTag(connection, workspaceId, name) {
  const cleanName = normalizeTaxonomyName(name);
  if (!cleanName) return null;
  const normalizedName = normalizedTaxonomyKey(cleanName);
  await connection.query(
    `
      INSERT INTO tags (public_id, workspace_id, name, normalized_name)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = VALUES(name), deleted_at = NULL
    `,
    [crypto.randomUUID(), workspaceId, cleanName, normalizedName],
  );
  const [[tag]] = await connection.query(
    'SELECT id FROM tags WHERE workspace_id = ? AND normalized_name = ? LIMIT 1',
    [workspaceId, normalizedName],
  );
  return tag ? Number(tag.id) : null;
}

async function syncLegacyNotes(db, workspaceId) {
  await db.query(
    `
      INSERT INTO notes
        (id, public_id, workspace_id, title, content, content_json, sort_order, ai_visibility,
         created_at, updated_at, deleted_at, deleted_reason)
      SELECT n.id, UUID(), ?, n.title, n.content, n.content_json, n.sort_order,
             COALESCE(n.ai_visibility, 'inherit'), n.created_at, n.updated_at, n.deleted_at, n.deleted_reason
      FROM task_notes n
      ON DUPLICATE KEY UPDATE
        title = VALUES(title), content = VALUES(content), content_json = VALUES(content_json),
        sort_order = VALUES(sort_order), ai_visibility = VALUES(ai_visibility),
        updated_at = VALUES(updated_at), deleted_at = VALUES(deleted_at), deleted_reason = VALUES(deleted_reason)
    `,
    [workspaceId],
  );
  await db.query(
    `
      DELETE links FROM note_task_links links
      JOIN task_notes legacy_note ON legacy_note.id = links.note_id
      WHERE links.is_primary = 1
    `,
  );
  await db.query(
    `INSERT INTO note_task_links (note_id, task_id, is_primary)
     SELECT id, task_id, 1 FROM task_notes WHERE task_id IS NOT NULL
     ON DUPLICATE KEY UPDATE is_primary = 1`,
  );
}

async function syncLegacyTags(db, workspaceId) {
  const [tasks] = await db.query('SELECT id, tags FROM tasks');
  const [notes] = await db.query('SELECT id, category FROM task_notes');
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const task of tasks) {
      await connection.query("DELETE FROM task_tags WHERE task_id = ? AND source = 'legacy'", [task.id]);
      for (const name of splitLegacyTags(task.tags)) {
        const tagId = await ensureTag(connection, workspaceId, name);
        if (tagId) {
          await connection.query(
            "INSERT IGNORE INTO task_tags (task_id, tag_id, source) VALUES (?, ?, 'legacy')",
            [task.id, tagId],
          );
        }
      }
    }
    for (const note of notes) {
      await connection.query("DELETE FROM note_tags WHERE note_id = ? AND source = 'legacy'", [note.id]);
      const tagId = await ensureTag(connection, workspaceId, note.category);
      if (tagId) {
        await connection.query(
          "INSERT IGNORE INTO note_tags (note_id, tag_id, source) VALUES (?, ?, 'legacy')",
          [note.id, tagId],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function attachmentChecksum(row) {
  try {
    const buffer = await readStoredAttachment(row, Math.max(config.ai.attachmentParsing.maxBytes, 55 * 1024 * 1024));
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

function resourceState(row) {
  if (row.text_status === 'failed') return 'failed';
  if (row.text_status === 'pending' || row.text_status === 'processing') return 'processing';
  return 'ready';
}

async function backfillAttachment(db, workspaceId, descriptor, row) {
  const [[mapped]] = await db.query(
    'SELECT resource_id FROM legacy_resource_map WHERE legacy_kind = ? AND legacy_id = ?',
    [descriptor.kind, row.id],
  );
  if (mapped) return false;

  const checksum = await attachmentChecksum(row);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [resourceResult] = await connection.query(
      `
        INSERT INTO resources
          (public_id, workspace_id, kind, title, description, status, ai_visibility,
           created_at, updated_at, deleted_at, deleted_reason)
        VALUES (?, ?, 'file', ?, ?, ?, 'inherit', ?, ?, ?, ?)
      `,
      [
        crypto.randomUUID(),
        workspaceId,
        row.original_name,
        row.note || null,
        resourceState(row),
        row.created_at,
        row.updated_at,
        row.deleted_at,
        row.deleted_reason,
      ],
    );
    const resourceId = Number(resourceResult.insertId);
    const [versionResult] = await connection.query(
      `
        INSERT INTO resource_versions
          (public_id, resource_id, version_no, original_name, stored_name, relative_path,
           storage_provider, storage_key, mime_type, file_size, checksum_sha256, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        crypto.randomUUID(),
        resourceId,
        row.original_name,
        row.stored_name,
        row.relative_path,
        row.storage_provider || 'local',
        row.storage_key,
        row.mime_type,
        Number(row.file_size || 0),
        checksum,
        row.created_at,
      ],
    );
    const versionId = Number(versionResult.insertId);
    await connection.query(
      `
        INSERT INTO resource_contents
          (version_id, status, parser, extracted_text, summary, text_chars, page_count,
           truncated, content_hash, error_message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        versionId,
        row.text_status || 'pending',
        row.text_parser,
        row.cached_text,
        String(row.cached_text || '').replace(/\s+/g, ' ').trim().slice(0, 360) || null,
        Number(row.text_chars || 0),
        row.page_count,
        row.text_truncated ? 1 : 0,
        row.text_content_hash,
        row.text_error,
        row.created_at,
        row.updated_at,
      ],
    );
    await connection.query(
      `INSERT INTO resource_relations (resource_id, target_type, target_id, relation_type)
       VALUES (?, ?, ?, 'attachment')`,
      [resourceId, descriptor.targetType, row[descriptor.ownerKey]],
    );
    await connection.query(
      `INSERT INTO legacy_resource_map (legacy_kind, legacy_id, resource_id, version_id)
       VALUES (?, ?, ?, ?)`,
      [descriptor.kind, row.id, resourceId, versionId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') return false;
    throw error;
  } finally {
    connection.release();
  }
}

async function backfillLegacyAttachments(db, workspaceId) {
  const descriptors = [
    { table: 'task_attachments', kind: 'task', ownerKey: 'task_id', targetType: 'task' },
    { table: 'log_attachments', kind: 'log', ownerKey: 'log_id', targetType: 'log' },
    { table: 'note_attachments', kind: 'note', ownerKey: 'note_id', targetType: 'note' },
  ];
  let created = 0;
  for (const descriptor of descriptors) {
    const [rows] = await db.query(
      `
        SELECT a.*, c.status AS text_status, c.parser AS text_parser, c.text AS cached_text,
               c.text_chars, c.page_count, c.truncated AS text_truncated,
               c.content_hash AS text_content_hash, c.error_message AS text_error
        FROM ${descriptor.table} a
        LEFT JOIN attachment_text_cache c
          ON c.attachment_kind = ? AND c.attachment_id = a.id
        ORDER BY a.id
      `,
      [descriptor.kind],
    );
    for (const row of rows) {
      if (await backfillAttachment(db, workspaceId, descriptor, row)) created += 1;
    }
  }
  return created;
}

export async function syncLegacyWorkspaceData() {
  const db = getPool();
  const workspaceId = await getDefaultWorkspaceId(db);
  await syncLegacyNotes(db, workspaceId);
  await syncLegacyTags(db, workspaceId);
  const resourcesCreated = await backfillLegacyAttachments(db, workspaceId);
  return { workspaceId, resourcesCreated };
}
