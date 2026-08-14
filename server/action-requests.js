import { getPool } from './db.js';
import { publishWorkspaceEvent } from './events.js';
import { scheduleIndexJob } from './indexing.js';
import {
  queueAttachmentTextExtraction,
  scheduleAttachmentTextExtraction,
} from './ai/attachment-cache.js';
import { activeStorageProvider, persistUploadedFile } from './storage.js';
import { promises as fsp } from 'fs';
import path from 'path';
import {
  markTemporaryMediaSaved,
  sanitizeWeixinFileName,
  temporaryMediaPath,
} from './weixin/temp-media.js';
import crypto from 'crypto';
import { queueResourceProcessing } from '../apps/worker/src/resource-processing.js';
import {
  mapLog,
  mapNote,
  mapTask,
  PRIORITIES,
  STATUSES,
  toDateOrNull,
  toHours,
  toNullableText,
  toPriority,
  toProgress,
  toStatus,
  toTags,
  toToday,
} from './validators.js';

const ACTION_TYPES = new Set([
  'create_task',
  'update_task',
  'create_log',
  'update_log',
  'create_note',
  'update_note',
  'attach_weixin_media_to_task',
  'attach_weixin_media_to_note',
  'create_note_with_weixin_media',
  'create_resource',
  'update_resource',
]);
const REQUEST_STATUSES = new Set(['pending', 'applied', 'rejected', 'failed']);

const noteSelectSql = `
  SELECT
    n.*,
    a.log_id AS attachment_log_id,
    a.original_name AS attachment_original_name,
    a.stored_name AS attachment_stored_name,
    a.mime_type AS attachment_mime_type,
    a.file_size AS attachment_file_size,
    a.note AS attachment_note,
    a.created_at AS attachment_created_at,
    a.updated_at AS attachment_updated_at
  FROM task_notes n
  LEFT JOIN log_attachments a ON a.id = n.attachment_id
`;

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function progressForStatus(status, progress) {
  if (status === 'todo') return 0;
  if (status === 'done') return 100;
  return Math.max(0, Math.min(99, toProgress(progress)));
}

function normalizePositiveId(value, fieldName) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return id;
}

function stringifyJson(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizeNoteTitle(value, content) {
  return (
    toNullableText(value)
    || toNullableText(String(content || '').replace(/\s+/g, ' ').slice(0, 48))
    || '未命名笔记'
  ).slice(0, 160);
}

function mapActionRequest(row) {
  return {
    id: Number(row.id),
    source: row.source,
    toolName: row.tool_name,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id ? Number(row.target_id) : null,
    title: row.title || '',
    payload: parseJsonField(row.payload),
    status: row.status,
    result: parseJsonField(row.result_json),
    errorMessage: row.error_message || '',
    requestedBy: row.requested_by || '',
    decidedBy: row.decided_by || '',
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actionTitle(actionType, payload = {}) {
  if (actionType === 'create_task') return `创建任务：${toNullableText(payload.title) || '未命名任务'}`;
  if (actionType === 'update_task') return `更新任务 #${payload.taskId}`;
  if (actionType === 'create_log') return `新增任务 #${payload.taskId} 的日志`;
  if (actionType === 'update_log') return `更新日志 #${payload.logId}`;
  if (actionType === 'create_note') return `新增${payload.taskId ? `任务 #${payload.taskId} 的` : '独立'}笔记`;
  if (actionType === 'update_note') return `更新笔记 #${payload.noteId}`;
  if (actionType === 'attach_weixin_media_to_task') return `保存微信附件到任务 #${payload.taskId}`;
  if (actionType === 'attach_weixin_media_to_note') return `保存微信附件到笔记 #${payload.noteId}`;
  if (actionType === 'create_note_with_weixin_media') return `将微信附件保存为笔记：${payload.title || '未命名笔记'}`;
  if (actionType === 'create_resource') return `创建资料：${payload.title || '未命名资料'}`;
  if (actionType === 'update_resource') return `更新资料 #${payload.resourceId}`;
  return actionType;
}

function targetForAction(actionType, payload = {}) {
  if (actionType === 'update_task') return { targetType: 'tasks', targetId: payload.taskId };
  if (actionType === 'create_log') return { targetType: 'tasks', targetId: payload.taskId };
  if (actionType === 'update_log') return { targetType: 'logs', targetId: payload.logId };
  if (actionType === 'create_note') return { targetType: payload.taskId ? 'tasks' : 'notes', targetId: payload.taskId || null };
  if (actionType === 'update_note') return { targetType: 'notes', targetId: payload.noteId };
  if (actionType === 'attach_weixin_media_to_task') return { targetType: 'tasks', targetId: payload.taskId };
  if (actionType === 'attach_weixin_media_to_note') return { targetType: 'notes', targetId: payload.noteId };
  if (actionType === 'create_note_with_weixin_media') return { targetType: 'notes', targetId: null };
  if (actionType === 'update_resource') return { targetType: 'resources', targetId: payload.resourceId };
  if (actionType === 'create_resource') return { targetType: 'resources', targetId: null };
  return { targetType: actionType === 'create_task' ? 'tasks' : null, targetId: null };
}

async function getActionRequestById(id) {
  const [rows] = await getPool().query('SELECT * FROM mcp_action_requests WHERE id = ?', [Number(id)]);
  return rows[0] ? mapActionRequest(rows[0]) : null;
}

export async function createActionRequest({
  toolName,
  actionType,
  payload,
  requestedBy = 'openclaw',
  source = 'mcp',
}) {
  if (!ACTION_TYPES.has(actionType)) {
    throw new Error(`Unsupported action type: ${actionType}`);
  }
  const { targetType, targetId } = targetForAction(actionType, payload);
  const [result] = await getPool().query(
    `
      INSERT INTO mcp_action_requests
        (source, tool_name, action_type, target_type, target_id, title, payload, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      source,
      toolName,
      actionType,
      targetType,
      targetId ? Number(targetId) : null,
      actionTitle(actionType, payload),
      JSON.stringify(payload || {}),
      requestedBy,
    ],
  );
  publishWorkspaceEvent({
    action: 'MCP action requested',
    targetType: 'action-requests',
    targetId: String(result.insertId),
  });
  return getActionRequestById(result.insertId);
}

export async function listActionRequests({ status = 'pending', limit = 50 } = {}) {
  const normalizedStatus = REQUEST_STATUSES.has(status) ? status : 'pending';
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const [rows] = await getPool().query(
    `
      SELECT *
      FROM mcp_action_requests
      WHERE status = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [normalizedStatus, normalizedLimit],
  );
  return rows.map(mapActionRequest);
}

async function selectTask(connection, taskId) {
  const [rows] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  return rows[0] || null;
}

async function selectNote(connection, noteId) {
  const [rows] = await connection.query('SELECT * FROM task_notes WHERE id = ?', [noteId]);
  return rows[0] || null;
}

async function taskExists(connection, taskId) {
  const [rows] = await connection.query('SELECT id FROM tasks WHERE id = ?', [taskId]);
  return rows.length > 0;
}

async function createTask(connection, payload) {
  const title = toNullableText(payload.title);
  if (!title) throw new Error('任务标题不能为空。');
  const status = toStatus(payload.status);
  const [[orderRow]] = await connection.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE status = ?',
    [status],
  );
  const [result] = await connection.query(
    `
      INSERT INTO tasks
        (title, description, priority, due_date, progress, status, tags, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      title,
      toNullableText(payload.description),
      toPriority(payload.priority),
      toDateOrNull(payload.dueDate),
      progressForStatus(status, payload.progress),
      status,
      toTags(payload.tags),
      Number(orderRow.next_order || 0),
    ],
  );
  const [rows] = await connection.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
  return {
    result: mapTask(rows[0]),
    affected: { targetType: 'tasks', targetId: result.insertId, operation: 'upsert' },
  };
}

async function updateTask(connection, payload) {
  const taskId = normalizePositiveId(payload.taskId, 'taskId');
  const current = await selectTask(connection, taskId);
  if (!current) throw new Error('任务不存在。');

  const nextStatus = payload.status === undefined ? current.status : toStatus(payload.status, current.status);
  let nextSortOrder = current.sort_order;
  if (payload.sortOrder !== undefined && Number.isFinite(Number(payload.sortOrder))) {
    nextSortOrder = Number(payload.sortOrder);
  } else if (nextStatus !== current.status) {
    const [[orderRow]] = await connection.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE status = ?',
      [nextStatus],
    );
    nextSortOrder = Number(orderRow.next_order || 0);
  }

  await connection.query(
    `
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, due_date = ?, progress = ?, status = ?, tags = ?, sort_order = ?
      WHERE id = ?
    `,
    [
      payload.title === undefined ? current.title : toNullableText(payload.title) || current.title,
      payload.description === undefined ? current.description : toNullableText(payload.description),
      payload.priority === undefined ? current.priority : toPriority(payload.priority, current.priority),
      payload.dueDate === undefined ? current.due_date : toDateOrNull(payload.dueDate),
      progressForStatus(nextStatus, payload.progress === undefined ? current.progress : payload.progress),
      nextStatus,
      payload.tags === undefined ? current.tags : toTags(payload.tags),
      nextSortOrder,
      taskId,
    ],
  );
  const [rows] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  return {
    result: mapTask(rows[0]),
    affected: { targetType: 'tasks', targetId: taskId, operation: 'upsert' },
  };
}

async function createLog(connection, payload) {
  const taskId = normalizePositiveId(payload.taskId, 'taskId');
  const [taskRows] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!taskRows.length) throw new Error('任务不存在。');
  const content = toNullableText(payload.content);
  if (!content) throw new Error('日志内容不能为空。');

  const [result] = await connection.query(
    `
      INSERT INTO work_logs
        (task_id, stage, log_date, content, hours, progress_snapshot, next_step)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      taskId,
      toStatus(payload.stage, taskRows[0].status),
      toDateOrNull(payload.logDate) || toToday(),
      content,
      toHours(payload.hours),
      payload.progressSnapshot === undefined
        ? Number(taskRows[0].progress)
        : toProgress(payload.progressSnapshot, Number(taskRows[0].progress)),
      toNullableText(payload.nextStep),
    ],
  );
  const [rows] = await connection.query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.id = ?
    `,
    [result.insertId],
  );
  return {
    result: mapLog(rows[0]),
    affected: { targetType: 'logs', targetId: result.insertId, operation: 'upsert' },
  };
}

async function updateLog(connection, payload) {
  const logId = normalizePositiveId(payload.logId, 'logId');
  const [existingRows] = await connection.query('SELECT * FROM work_logs WHERE id = ?', [logId]);
  if (!existingRows.length) throw new Error('日志不存在。');
  const existing = existingRows[0];
  const content = payload.content === undefined ? existing.content : toNullableText(payload.content);
  if (!content) throw new Error('日志内容不能为空。');

  await connection.query(
    `
      UPDATE work_logs
      SET stage = ?, log_date = ?, content = ?, hours = ?, progress_snapshot = ?, next_step = ?
      WHERE id = ?
    `,
    [
      payload.stage === undefined ? existing.stage : toStatus(payload.stage, existing.stage),
      payload.logDate === undefined ? existing.log_date : (toDateOrNull(payload.logDate) || existing.log_date),
      content,
      payload.hours === undefined ? Number(existing.hours) : toHours(payload.hours),
      payload.progressSnapshot === undefined
        ? Number(existing.progress_snapshot)
        : toProgress(payload.progressSnapshot, Number(existing.progress_snapshot)),
      payload.nextStep === undefined ? existing.next_step : toNullableText(payload.nextStep),
      logId,
    ],
  );
  const [rows] = await connection.query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.id = ?
    `,
    [logId],
  );
  return {
    result: mapLog(rows[0]),
    affected: { targetType: 'logs', targetId: logId, operation: 'upsert' },
  };
}

async function createNote(connection, payload) {
  const taskId = payload.taskId ? normalizePositiveId(payload.taskId, 'taskId') : null;
  if (taskId && !(await taskExists(connection, taskId))) throw new Error('关联的任务不存在。');
  const content = toNullableText(payload.content);
  if (!content) throw new Error('笔记内容不能为空。');

  const [result] = await connection.query(
    `
      INSERT INTO task_notes (task_id, title, attachment_id, category, content, content_json)
      VALUES (?, ?, NULL, ?, ?, ?)
    `,
    [
      taskId,
      normalizeNoteTitle(payload.title, content),
      toNullableText(payload.category)?.slice(0, 60) || null,
      content,
      stringifyJson(payload.contentJson),
    ],
  );
  const [rows] = await connection.query(`${noteSelectSql} WHERE n.id = ?`, [result.insertId]);
  return {
    result: mapNote(rows[0]),
    affected: { targetType: 'notes', targetId: result.insertId, operation: 'upsert' },
  };
}

async function updateNote(connection, payload) {
  const noteId = normalizePositiveId(payload.noteId, 'noteId');
  const existing = await selectNote(connection, noteId);
  if (!existing) throw new Error('笔记不存在。');

  const content = payload.content === undefined ? existing.content : toNullableText(payload.content);
  if (!content) throw new Error('笔记内容不能为空。');
  const taskId = payload.taskId === undefined
    ? (existing.task_id ? Number(existing.task_id) : null)
    : (payload.taskId ? normalizePositiveId(payload.taskId, 'taskId') : null);
  if (taskId && !(await taskExists(connection, taskId))) throw new Error('关联的任务不存在。');

  await connection.query(
    `
      UPDATE task_notes
      SET task_id = ?, title = ?, category = ?, content = ?, content_json = ?
      WHERE id = ?
    `,
    [
      taskId,
      payload.title === undefined ? existing.title : normalizeNoteTitle(payload.title, content),
      payload.category === undefined ? existing.category : (toNullableText(payload.category)?.slice(0, 60) || null),
      content,
      payload.contentJson === undefined ? existing.content_json : stringifyJson(payload.contentJson),
      noteId,
    ],
  );
  const [rows] = await connection.query(`${noteSelectSql} WHERE n.id = ?`, [noteId]);
  return {
    result: mapNote(rows[0]),
    affected: { targetType: 'notes', targetId: noteId, operation: 'upsert' },
  };
}

async function persistWeixinMediaAttachment(connection, payload, ownerKind) {
  const tempMediaId = String(payload.tempMediaId || '').trim();
  if (!tempMediaId) throw new Error('微信临时附件 ID 不能为空。');
  const [mediaRows] = await connection.query(
    "SELECT * FROM weixin_temp_media WHERE id = ? AND status = 'temporary' FOR UPDATE",
    [tempMediaId],
  );
  const media = mediaRows[0];
  if (!media) throw new Error('微信临时附件不存在、已保存或已清理。');

  const ownerId = ownerKind === 'task'
    ? normalizePositiveId(payload.taskId, 'taskId')
    : normalizePositiveId(payload.noteId, 'noteId');
  const ownerTable = ownerKind === 'task' ? 'tasks' : 'task_notes';
  const [ownerRows] = await connection.query(
    `SELECT id FROM ${ownerTable} WHERE id = ? AND deleted_at IS NULL`,
    [ownerId],
  );
  if (!ownerRows.length) throw new Error(ownerKind === 'task' ? '任务不存在。' : '笔记不存在。');

  const sourceName = sanitizeWeixinFileName(media.original_name);
  const requestedName = sanitizeWeixinFileName(payload.originalName || sourceName);
  const sourceExtension = path.extname(sourceName);
  const originalName = path.extname(requestedName) || !sourceExtension
    ? requestedName
    : `${requestedName}${sourceExtension}`;
  const storedName = `${Date.now()}-${crypto.randomUUID()}-${originalName}`;
  const attachmentKind = ownerKind === 'task' ? 'task-attachments' : 'note-attachments';
  const provider = activeStorageProvider();
  const sourcePath = temporaryMediaPath(media);
  const stagingPath = `${sourcePath}.approval-${crypto.randomUUID()}`;
  await fsp.copyFile(sourcePath, stagingPath);
  let storageKey;
  try {
    storageKey = await persistUploadedFile({
      path: stagingPath,
      filename: storedName,
      originalname: originalName,
      mimetype: media.mime_type,
      size: Number(media.file_size || 0),
    }, attachmentKind, ownerId);
  } finally {
    await fsp.unlink(stagingPath).catch(() => {});
  }
  const table = ownerKind === 'task' ? 'task_attachments' : 'note_attachments';
  const ownerColumn = ownerKind === 'task' ? 'task_id' : 'note_id';
  const [result] = await connection.query(
    `
      INSERT INTO ${table}
        (${ownerColumn}, original_name, stored_name, relative_path, storage_provider, storage_key, mime_type, file_size, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      ownerId,
      originalName,
      storedName,
      provider === 'local' ? `uploads/${storageKey}` : storageKey,
      provider,
      storageKey,
      media.mime_type || 'application/octet-stream',
      Number(media.file_size || 0),
      toNullableText(payload.note) || '来自微信对话',
    ],
  );
  await markTemporaryMediaSaved(connection, tempMediaId);
  return {
    id: Number(result.insertId),
    ownerId,
    ownerKind,
    originalName,
    mimeType: media.mime_type || 'application/octet-stream',
    cleanupFilePath: sourcePath,
  };
}

async function attachWeixinMediaToTask(connection, payload) {
  const attachment = await persistWeixinMediaAttachment(connection, payload, 'task');
  const { cleanupFilePath, ...result } = attachment;
  return {
    result,
    affected: { targetType: 'task-attachments', targetId: attachment.id, operation: 'upsert' },
    cleanupFilePath,
  };
}

async function attachWeixinMediaToNote(connection, payload) {
  const attachment = await persistWeixinMediaAttachment(connection, payload, 'note');
  const { cleanupFilePath, ...result } = attachment;
  return {
    result,
    affected: { targetType: 'note-attachments', targetId: attachment.id, operation: 'upsert' },
    cleanupFilePath,
  };
}

async function createNoteWithWeixinMedia(connection, payload) {
  const createdNote = await createNote(connection, {
    title: payload.title,
    content: payload.content || '来自微信的临时附件。',
    contentJson: payload.contentJson,
    category: null,
    taskId: payload.taskId || null,
  });
  const noteId = createdNote.result.id;
  const attachment = await persistWeixinMediaAttachment(connection, {
    ...payload,
    noteId,
  }, 'note');
  const { cleanupFilePath, ...attachmentResult } = attachment;
  return {
    result: { note: createdNote.result, attachment: attachmentResult },
    affected: [
      createdNote.affected,
      { targetType: 'note-attachments', targetId: attachment.id, operation: 'upsert' },
    ],
    cleanupFilePath,
  };
}

async function ensureResourceTags(connection, workspaceId, values) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const [rows] = await connection.query(
    `SELECT id FROM tags WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    [workspaceId, ...ids],
  );
  if (rows.length !== ids.length) throw new Error('资料只能使用已经存在的标签。');
  return ids;
}

async function createResourceAction(connection, payload) {
  const kind = ['link', 'text'].includes(payload.kind) ? payload.kind : null;
  if (!kind) throw new Error('AI 目前只能创建链接或文本资料。');
  const title = toNullableText(payload.title)?.slice(0, 255);
  if (!title) throw new Error('资料标题不能为空。');
  const [[workspace]] = await connection.query('SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1');
  if (!workspace) throw new Error('默认工作区不存在。');
  const folderId = payload.folderId ? normalizePositiveId(payload.folderId, 'folderId') : null;
  if (folderId) {
    const [[folder]] = await connection.query('SELECT id FROM folders WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [folderId, workspace.id]);
    if (!folder) throw new Error('资料目录不存在。');
  }
  const tagIds = await ensureResourceTags(connection, workspace.id, payload.tagIds);
  const content = kind === 'text' ? toNullableText(payload.content) : null;
  const sourceUrl = kind === 'link' ? toNullableText(payload.sourceUrl || payload.url) : null;
  if (kind === 'text' && !content) throw new Error('文本资料内容不能为空。');
  if (kind === 'link' && !sourceUrl) throw new Error('链接资料网址不能为空。');
  const [resourceResult] = await connection.query(
    `INSERT INTO resources
      (public_id, workspace_id, folder_id, kind, title, description, status, ai_visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), workspace.id, folderId, kind, title, toNullableText(payload.description), kind === 'text' ? 'ready' : 'processing', payload.aiVisibility === 'deny' ? 'deny' : 'inherit'],
  );
  const resourceId = Number(resourceResult.insertId);
  const [versionResult] = await connection.query(
    'INSERT INTO resource_versions (public_id, resource_id, version_no, source_url) VALUES (?, ?, 1, ?)',
    [crypto.randomUUID(), resourceId, sourceUrl],
  );
  const versionId = Number(versionResult.insertId);
  await connection.query(
    `INSERT INTO resource_contents (version_id, status, parser, extracted_text, summary, text_chars, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [versionId, kind === 'text' ? 'completed' : 'pending', kind === 'text' ? 'text' : null,
      content, content?.replace(/\s+/g, ' ').slice(0, 360) || null, content?.length || 0,
      content ? crypto.createHash('sha256').update(content).digest('hex') : null],
  );
  for (const tagId of tagIds) {
    await connection.query("INSERT INTO resource_tags (resource_id, tag_id, source) VALUES (?, ?, 'manual')", [resourceId, tagId]);
  }
  return {
    result: { id: resourceId, title, kind, status: kind === 'text' ? 'ready' : 'processing' },
    affected: { targetType: 'resources', targetId: resourceId, operation: 'upsert', processVersionId: kind === 'link' ? versionId : null },
  };
}

async function updateResourceAction(connection, payload) {
  const resourceId = normalizePositiveId(payload.resourceId, 'resourceId');
  const [[resource]] = await connection.query('SELECT * FROM resources WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [resourceId]);
  if (!resource) throw new Error('资料不存在。');
  const folderId = payload.folderId === undefined ? resource.folder_id : (payload.folderId ? normalizePositiveId(payload.folderId, 'folderId') : null);
  if (folderId) {
    const [[folder]] = await connection.query('SELECT id FROM folders WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL', [folderId, resource.workspace_id]);
    if (!folder) throw new Error('资料目录不存在。');
  }
  const tagIds = payload.tagIds === undefined ? null : await ensureResourceTags(connection, resource.workspace_id, payload.tagIds);
  await connection.query(
    'UPDATE resources SET title = ?, description = ?, folder_id = ?, ai_visibility = ? WHERE id = ?',
    [payload.title === undefined ? resource.title : String(payload.title).trim().slice(0, 255),
      payload.description === undefined ? resource.description : toNullableText(payload.description), folderId,
      ['inherit', 'allow', 'deny'].includes(payload.aiVisibility) ? payload.aiVisibility : resource.ai_visibility, resourceId],
  );
  if (tagIds) {
    await connection.query('DELETE FROM resource_tags WHERE resource_id = ?', [resourceId]);
    for (const tagId of tagIds) {
      await connection.query("INSERT INTO resource_tags (resource_id, tag_id, source) VALUES (?, ?, 'manual')", [resourceId, tagId]);
    }
  }
  if (payload.relation?.targetType && payload.relation?.targetId) {
    const targetType = ['task', 'log', 'note'].includes(payload.relation.targetType) ? payload.relation.targetType : null;
    if (!targetType) throw new Error('资料关联类型无效。');
    const targetTable = { task: 'tasks', log: 'work_logs', note: 'task_notes' }[targetType];
    const targetId = normalizePositiveId(payload.relation.targetId, 'targetId');
    const [[target]] = await connection.query(
      `SELECT id FROM ${targetTable} WHERE id = ? AND deleted_at IS NULL`,
      [targetId],
    );
    if (!target) throw new Error('要关联的对象不存在。');
    await connection.query(
      `INSERT IGNORE INTO resource_relations (resource_id, target_type, target_id, relation_type) VALUES (?, ?, ?, 'reference')`,
      [resourceId, targetType, targetId],
    );
  }
  return {
    result: { id: resourceId, title: payload.title || resource.title },
    affected: { targetType: 'resources', targetId: resourceId, operation: 'upsert' },
  };
}

async function applyAction(connection, action) {
  const payload = parseJsonField(action.payload) || {};
  if (action.action_type === 'create_task') return createTask(connection, payload);
  if (action.action_type === 'update_task') return updateTask(connection, payload);
  if (action.action_type === 'create_log') return createLog(connection, payload);
  if (action.action_type === 'update_log') return updateLog(connection, payload);
  if (action.action_type === 'create_note') return createNote(connection, payload);
  if (action.action_type === 'update_note') return updateNote(connection, payload);
  if (action.action_type === 'attach_weixin_media_to_task') return attachWeixinMediaToTask(connection, payload);
  if (action.action_type === 'attach_weixin_media_to_note') return attachWeixinMediaToNote(connection, payload);
  if (action.action_type === 'create_note_with_weixin_media') return createNoteWithWeixinMedia(connection, payload);
  if (action.action_type === 'create_resource') return createResourceAction(connection, payload);
  if (action.action_type === 'update_resource') return updateResourceAction(connection, payload);
  throw new Error(`Unsupported action type: ${action.action_type}`);
}

export async function approveActionRequest(id, { decidedBy = 'local' } = {}) {
  const actionId = normalizePositiveId(id, 'id');
  const connection = await getPool().getConnection();
  let affected = null;
  let cleanupFilePath = '';
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM mcp_action_requests WHERE id = ? FOR UPDATE', [actionId]);
    const action = rows[0];
    if (!action) throw new Error('动作请求不存在。');
    if (action.status !== 'pending') throw new Error('该动作请求已经处理过。');

    const applied = await applyAction(connection, action);
    affected = applied.affected;
    cleanupFilePath = applied.cleanupFilePath || '';
    await connection.query(
      `
        UPDATE mcp_action_requests
        SET status = 'applied', result_json = ?, error_message = NULL, decided_by = ?, decided_at = NOW(), applied_at = NOW()
        WHERE id = ?
      `,
      [JSON.stringify(applied.result), decidedBy, actionId],
    );
    await connection.commit();
    if (cleanupFilePath) await fsp.unlink(cleanupFilePath).catch(() => {});
  } catch (error) {
    await connection.rollback();
    await getPool().query(
      `
        UPDATE mcp_action_requests
        SET status = 'failed', error_message = ?, decided_by = ?, decided_at = NOW()
        WHERE id = ? AND status = 'pending'
      `,
      [error.message, decidedBy, actionId],
    );
  } finally {
    connection.release();
  }

  const action = await getActionRequestById(actionId);
  if (affected && action?.status === 'applied') {
    const affectedItems = Array.isArray(affected) ? affected : [affected];
    for (const item of affectedItems) {
      scheduleIndexJob({
        targetType: item.targetType,
        targetId: item.targetId,
        operation: item.operation,
        reason: `MCP approval ${action.actionType}`,
      });
      const attachmentKind = {
        'task-attachments': 'task',
        'note-attachments': 'note',
        'log-attachments': 'log',
      }[item.targetType];
      if (attachmentKind) {
        queueAttachmentTextExtraction(attachmentKind, item.targetId)
          .then(() => scheduleAttachmentTextExtraction(attachmentKind, item.targetId))
          .catch((error) => {
            console.error(`Failed to queue approved attachment ${attachmentKind}:${item.targetId}:`, error.message);
          });
      }
      if (item.processVersionId) {
        queueResourceProcessing(item.targetId, item.processVersionId).catch((error) => {
          console.error(`Failed to queue approved resource ${item.targetId}:`, error.message);
        });
      }
    }
  }
  publishWorkspaceEvent({
    action: `MCP action ${action?.status || 'updated'}`,
    targetType: 'action-requests',
    targetId: String(actionId),
  });
  return action;
}

export async function rejectActionRequest(id, { decidedBy = 'local', reason = '' } = {}) {
  const actionId = normalizePositiveId(id, 'id');
  const [result] = await getPool().query(
    `
      UPDATE mcp_action_requests
      SET status = 'rejected', error_message = ?, decided_by = ?, decided_at = NOW()
      WHERE id = ? AND status = 'pending'
    `,
    [toNullableText(reason), decidedBy, actionId],
  );
  if (!result.affectedRows) {
    const existing = await getActionRequestById(actionId);
    if (!existing) throw new Error('动作请求不存在。');
    return existing;
  }
  publishWorkspaceEvent({
    action: 'MCP action rejected',
    targetType: 'action-requests',
    targetId: String(actionId),
  });
  return getActionRequestById(actionId);
}

export { ACTION_TYPES, REQUEST_STATUSES };
