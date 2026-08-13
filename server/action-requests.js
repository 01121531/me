import { getPool } from './db.js';
import { publishWorkspaceEvent } from './events.js';
import { scheduleIndexJob } from './indexing.js';
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
  return actionType;
}

function targetForAction(actionType, payload = {}) {
  if (actionType === 'update_task') return { targetType: 'tasks', targetId: payload.taskId };
  if (actionType === 'create_log') return { targetType: 'tasks', targetId: payload.taskId };
  if (actionType === 'update_log') return { targetType: 'logs', targetId: payload.logId };
  if (actionType === 'create_note') return { targetType: payload.taskId ? 'tasks' : 'notes', targetId: payload.taskId || null };
  if (actionType === 'update_note') return { targetType: 'notes', targetId: payload.noteId };
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

async function applyAction(connection, action) {
  const payload = parseJsonField(action.payload) || {};
  if (action.action_type === 'create_task') return createTask(connection, payload);
  if (action.action_type === 'update_task') return updateTask(connection, payload);
  if (action.action_type === 'create_log') return createLog(connection, payload);
  if (action.action_type === 'update_log') return updateLog(connection, payload);
  if (action.action_type === 'create_note') return createNote(connection, payload);
  if (action.action_type === 'update_note') return updateNote(connection, payload);
  throw new Error(`Unsupported action type: ${action.action_type}`);
}

export async function approveActionRequest(id, { decidedBy = 'local' } = {}) {
  const actionId = normalizePositiveId(id, 'id');
  const connection = await getPool().getConnection();
  let affected = null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM mcp_action_requests WHERE id = ? FOR UPDATE', [actionId]);
    const action = rows[0];
    if (!action) throw new Error('动作请求不存在。');
    if (action.status !== 'pending') throw new Error('该动作请求已经处理过。');

    const applied = await applyAction(connection, action);
    affected = applied.affected;
    await connection.query(
      `
        UPDATE mcp_action_requests
        SET status = 'applied', result_json = ?, error_message = NULL, decided_by = ?, decided_at = NOW(), applied_at = NOW()
        WHERE id = ?
      `,
      [JSON.stringify(applied.result), decidedBy, actionId],
    );
    await connection.commit();
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
    scheduleIndexJob({
      targetType: affected.targetType,
      targetId: affected.targetId,
      operation: affected.operation,
      reason: `MCP approval ${action.actionType}`,
    });
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
