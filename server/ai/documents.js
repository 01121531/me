import crypto from 'crypto';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { readStoredAttachment } from '../storage.js';
import { extractAndCacheAttachmentText, getAttachmentTextCache } from './attachment-cache.js';
import { extractAttachmentText } from './attachment-text.js';
import { redactSensitiveText } from '../../packages/domain/src/redaction.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function taskText(row) {
  return [
    `任务：${row.title}`,
    row.description ? `说明：${row.description}` : '',
    row.tags ? `标签：${row.tags}` : '',
    `优先级：${row.priority}`,
    `状态：${row.status}`,
    `当前进度：${row.progress}%`,
    row.due_date ? `截止日期：${row.due_date}` : '',
  ].filter(Boolean).join('\n');
}

function logText(row) {
  return [
    `任务：${row.task_title}`,
    `工作日志：${row.content}`,
    `日期：${row.log_date}`,
    `阶段：${row.stage}`,
    `进度快照：${row.progress_snapshot}%`,
    `耗时：${row.hours} 小时`,
    row.next_step ? `下一步：${row.next_step}` : '',
  ].filter(Boolean).join('\n');
}

function noteText(row) {
  return [
    `笔记：${row.title}`,
    row.category ? `分类：${row.category}` : '',
    row.task_title ? `关联任务：${row.task_title}` : '独立笔记',
    row.content,
  ].filter(Boolean).join('\n');
}

function toDocument(entityType, row, text, metadata) {
  const normalizedText = cleanText(text);
  if (!normalizedText) return null;
  return {
    documentId: `${entityType}:${row.id}`,
    entityType,
    entityId: String(row.id),
    rootTaskId: metadata.taskId || null,
    text: normalizedText,
    metadata,
  };
}

export async function loadIndexDocument(entityType, entityId) {
  const db = getPool();
  if (entityType === 'task') {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [entityId]);
    const row = rows[0];
    return row && toDocument('task', row, taskText(row), {
      title: row.title,
      taskId: Number(row.id),
      status: row.status,
      priority: row.priority,
      progress: Number(row.progress),
      dueDate: row.due_date,
      tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    });
  }

  if (entityType === 'log') {
    const [rows] = await db.query(
      `
        SELECT l.*, t.title AS task_title
        FROM work_logs l
        JOIN tasks t ON t.id = l.task_id
        WHERE l.id = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL
      `,
      [entityId],
    );
    const row = rows[0];
    return row && toDocument('log', row, logText(row), {
      title: row.task_title,
      taskId: Number(row.task_id),
      stage: row.stage,
      logDate: row.log_date,
      progressSnapshot: Number(row.progress_snapshot),
    });
  }

  if (entityType === 'note') {
    const [rows] = await db.query(
      `
        SELECT n.*, t.title AS task_title
        FROM task_notes n
        LEFT JOIN tasks t ON t.id = n.task_id
        WHERE n.id = ? AND n.deleted_at IS NULL
          AND COALESCE(n.ai_visibility, 'inherit') <> 'deny'
          AND (n.task_id IS NULL OR t.deleted_at IS NULL)
      `,
      [entityId],
    );
    const row = rows[0];
    return row && toDocument('note', row, noteText(row), {
      title: row.title,
      taskId: row.task_id ? Number(row.task_id) : null,
      category: row.category || null,
      updatedAt: row.updated_at,
    });
  }

  if (entityType === 'resource') {
    const [rows] = await db.query(
      `
        SELECT
          r.*,
          v.id AS version_id,
          v.original_name,
          v.mime_type,
          v.storage_key,
          v.source_url,
          c.extracted_text,
          c.summary,
          GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS tag_names,
          MIN(CASE WHEN rr.target_type = 'task' THEN rr.target_id END) AS task_id
        FROM resources r
        LEFT JOIN resource_versions v
          ON v.resource_id = r.id
         AND v.version_no = (SELECT MAX(latest.version_no) FROM resource_versions latest WHERE latest.resource_id = r.id)
        LEFT JOIN resource_contents c ON c.version_id = v.id
        LEFT JOIN resource_tags rt ON rt.resource_id = r.id
        LEFT JOIN tags t ON t.id = rt.tag_id AND t.deleted_at IS NULL
        LEFT JOIN resource_relations rr ON rr.resource_id = r.id
        WHERE r.id = ? AND r.deleted_at IS NULL AND r.ai_visibility <> 'deny'
        GROUP BY r.id, v.id, c.version_id
      `,
      [entityId],
    );
    const row = rows[0];
    if (!row) return null;
    const text = redactSensitiveText([
      `资料：${row.title}`,
      row.description ? `说明：${row.description}` : '',
      row.tag_names ? `标签：${row.tag_names}` : '',
      row.source_url ? `来源：${row.source_url}` : '',
      row.summary ? `摘要：${row.summary}` : '',
      row.extracted_text ? `内容：${row.extracted_text}` : '',
    ].filter(Boolean).join('\n'));
    return toDocument('resource', row, text, {
      title: row.title,
      taskId: row.task_id ? Number(row.task_id) : null,
      resourceId: Number(row.id),
      resourcePublicId: row.public_id,
      kind: row.kind,
      fileName: row.original_name || null,
      mimeType: row.mime_type || null,
      sourceUrl: row.source_url || null,
      downloadUrl: row.storage_key
        ? `/api/v1/resources/${row.public_id}/versions/${row.version_id}/download`
        : null,
      tags: row.tag_names ? row.tag_names.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    });
  }

  const attachmentQuery = {
    log_attachment: `
      SELECT a.*, l.task_id, l.content AS owner_content, t.title AS task_title
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      JOIN tasks t ON t.id = l.task_id
      WHERE a.id = ? AND a.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
    note_attachment: `
      SELECT a.*, n.task_id, n.title AS owner_content, t.title AS task_title
      FROM note_attachments a
      JOIN task_notes n ON n.id = a.note_id
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE a.id = ? AND a.deleted_at IS NULL AND n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL)
    `,
    task_attachment: `
      SELECT a.*, a.task_id, t.title AS owner_content, t.title AS task_title
      FROM task_attachments a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.id = ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
  }[entityType];

  if (attachmentQuery) {
    const [rows] = await db.query(attachmentQuery, [entityId]);
    const row = rows[0];
    if (!row) return null;
    const kind = entityType.split('_')[0];
    let cached = await getAttachmentTextCache(kind, row.id);
    if (!cached || cached.status === 'pending' || cached.status === 'failed') {
      cached = await extractAndCacheAttachmentText(kind, row.id);
    }
    let extracted = {
      parser: cached?.parser || null,
      text: cached?.status === 'completed' ? cached.text || '' : '',
    };
    if (!extracted.text && !cached) {
      const buffer = await readStoredAttachment(row, config.ai.attachmentParsing.maxBytes);
      extracted = await extractAttachmentText(row, buffer, config.ai.attachmentParsing.maxChars);
    }
    const text = [
      `附件：${row.original_name}`,
      row.note ? `备注：${row.note}` : '',
      row.task_title ? `关联任务：${row.task_title}` : '独立笔记附件',
      row.owner_content ? `所属记录：${row.owner_content}` : '',
      extracted.text ? `文件内容：${extracted.text}` : '',
    ].filter(Boolean).join('\n');
    return toDocument(entityType, row, text, {
      title: row.task_title || row.original_name,
      taskId: row.task_id ? Number(row.task_id) : null,
      fileName: row.original_name,
      mimeType: row.mime_type,
      parser: extracted.parser,
    });
  }

  return null;
}

export function documentChecksum(document, indexVersion) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ text: document.text, metadata: document.metadata, indexVersion }))
    .digest('hex');
}

export async function getIndexState(entityType, entityId) {
  const [rows] = await getPool().query(
    'SELECT * FROM ai_index_state WHERE entity_type = ? AND entity_id = ?',
    [entityType, String(entityId)],
  );
  return rows[0] || null;
}

export async function saveIndexState(document, checksum, indexVersion) {
  await getPool().query(
    `
      INSERT INTO ai_index_state
        (entity_type, entity_id, root_task_id, content_hash, index_version, metadata, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        root_task_id = VALUES(root_task_id),
        content_hash = VALUES(content_hash),
        index_version = VALUES(index_version),
        metadata = VALUES(metadata),
        indexed_at = CURRENT_TIMESTAMP
    `,
    [
      document.entityType,
      document.entityId,
      document.rootTaskId,
      checksum,
      indexVersion,
      JSON.stringify(document.metadata),
    ],
  );
}

export async function removeIndexState(entityType, entityId) {
  await getPool().query(
    'DELETE FROM ai_index_state WHERE entity_type = ? AND entity_id = ?',
    [entityType, String(entityId)],
  );
}

export async function removeIndexStateForTask(taskId) {
  await getPool().query(
    `
      DELETE FROM ai_index_state
      WHERE (entity_type = 'task' AND entity_id = ?) OR root_task_id = ?
    `,
    [String(taskId), Number(taskId)],
  );
}
