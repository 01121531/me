import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import helmet from 'helmet';
import multer from 'multer';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import {
  approveActionRequest,
  createActionRequest,
  listActionRequests,
  rejectActionRequest,
} from './action-requests.js';
import { observeApiWrites } from './audit.js';
import {
  initializeAuth,
  installAuthMiddleware,
  installAuthRoutes,
  requireApiAuth,
} from './auth.js';
import { ensureDatabase, getPool } from './db.js';
import { openEventStream } from './events.js';
import { getIndexStatus, scheduleIndexJob } from './indexing.js';
import { formatNoteWithAi, streamFormatNoteWithAi } from './ai/note-format.js';
import { planAiActionRequest } from './ai/action-planner.js';
import { generateLogDraftFromNote } from './ai/log-draft.js';
import { summarizeReportWithAi } from './ai/report-summary.js';
import { summarizeTaskWithAi } from './ai/task-summary.js';
import { answerWorkspace, searchWorkspace, streamAnswerWorkspace } from './ai/search.js';
import { suggestTasksFromTask } from './ai/task-suggestions.js';
import {
  attachmentTextJoinSql,
  attachmentTextSelectSql,
  deleteAttachmentTextCache,
  extractAndCacheAttachmentText,
  queueAttachmentTextExtraction,
  scheduleAttachmentTextExtraction,
} from './ai/attachment-cache.js';
import { installMcpServer } from './mcp/server.js';
import {
  createBackup,
  latestBackupDir,
  listBackups,
  verifyBackup,
} from './scripts/backup.js';
import {
  changeAccessPassword,
  checkOnlineUpdate,
  getOnlineUpdateStatus,
  getSettingsSnapshot,
  openOnlineUpdateEventStream,
  saveAiSettings,
  startOnlineUpdate,
  testAiConnection,
} from './settings.js';
import {
  createExcelExport,
  createMarkdownExport,
  createPdfExport,
  getWorkspaceExportData,
  workspaceExportFileName,
} from './export-data.js';
import { getReportData } from './report-data.js';
import { runSystemChecks } from './reliability-checks.js';
import {
  activeStorageProvider,
  initializeStorage,
  persistUploadedFile,
  removeStoredAttachment,
  sendStoredAttachment,
} from './storage.js';
import {
  disconnectWeixin,
  getWeixinStatus,
  initializeWeixinService,
  openWeixinEventStream,
  shutdownWeixinService,
  startWeixinLogin,
  submitWeixinVerifyCode,
} from './weixin/service.js';
import {
  mapAttachment,
  mapLog,
  mapNote,
  mapNoteAttachment,
  mapTaskAttachment,
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

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');
const uploadRoot = path.resolve(__dirname, '../uploads');
const logUploadRoot = path.join(uploadRoot, 'log-attachments');
const noteUploadRoot = path.join(uploadRoot, 'note-attachments');
const taskUploadRoot = path.join(uploadRoot, 'task-attachments');

const allowedFileExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
]);

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function sanitizeFileName(name) {
  const fallback = 'attachment';
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizeUploadedFileName(name) {
  const rawName = String(name || '');
  if (!rawName) return 'attachment';

  // Multer exposes multipart filenames as Latin-1 in some browser uploads.
  // Accept a UTF-8 recovery only when it round-trips exactly, leaving valid names untouched.
  const recoveredName = Buffer.from(rawName, 'latin1').toString('utf8');
  const isRecoverable = recoveredName !== rawName
    && !recoveredName.includes('\uFFFD')
    && Buffer.from(recoveredName, 'utf8').toString('latin1') === rawName;

  return sanitizeFileName(isRecoverable ? recoveredName : rawName);
}

function isAllowedUpload(file) {
  return allowedFileExtensions.has(path.extname(file.originalname).toLowerCase());
}

function isPreviewableImage(attachment) {
  return imageExtensions.has(path.extname(attachment.original_name).toLowerCase())
    && String(attachment.mime_type || '').startsWith('image/');
}

function downloadContentDisposition(filename) {
  const safeFallback = String(filename || 'download').replace(/[^a-zA-Z0-9._-]/g, '_') || 'download';
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename || 'download')}`;
}

async function removeAttachmentFile(attachment) {
  try {
    await removeStoredAttachment(attachment);
  } catch (error) {
    console.warn(`Failed to delete attachment file ${attachment.storage_key || attachment.relative_path}:`, error.message);
  }
}

async function createUploadedAttachmentValues(ownerId, file, kind, note) {
  const provider = activeStorageProvider();
  const key = await persistUploadedFile(file, kind, ownerId);
  return [
    Number(ownerId),
    normalizeUploadedFileName(file.originalname),
    file.filename,
    provider === 'local' ? `uploads/${key}` : key,
    provider,
    key,
    file.mimetype || 'application/octet-stream',
    file.size,
    note,
  ];
}

async function getAttachmentRowsByLogIds(logIds, { includeDeleted = false } = {}) {
  if (!logIds.length) return [];
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM log_attachments a
      ${attachmentTextJoinSql('log')}
      WHERE a.log_id IN (${logIds.map(() => '?').join(',')})
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
      ORDER BY a.created_at ASC, a.id ASC
    `,
    logIds,
  );
  return rows;
}

async function getAttachmentRow(id, { includeDeleted = false } = {}) {
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM log_attachments a
      ${attachmentTextJoinSql('log')}
      WHERE a.id = ?
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
    `,
    [Number(id)],
  );
  return rows[0] || null;
}

async function getNoteAttachmentRowsByNoteIds(noteIds, { includeDeleted = false } = {}) {
  if (!noteIds.length) return [];
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM note_attachments a
      ${attachmentTextJoinSql('note')}
      WHERE a.note_id IN (${noteIds.map(() => '?').join(',')})
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
      ORDER BY a.created_at ASC, a.id ASC
    `,
    noteIds,
  );
  return rows;
}

async function getNoteAttachmentRow(id, { includeDeleted = false } = {}) {
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM note_attachments a
      ${attachmentTextJoinSql('note')}
      WHERE a.id = ?
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
    `,
    [Number(id)],
  );
  return rows[0] || null;
}

async function getTaskAttachmentRows(taskId, { includeDeleted = false } = {}) {
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM task_attachments a
      ${attachmentTextJoinSql('task')}
      WHERE a.task_id = ?
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
      ORDER BY a.created_at ASC, a.id ASC
    `,
    [Number(taskId)],
  );
  return rows;
}

async function getTaskAttachmentRow(id, { includeDeleted = false } = {}) {
  const [rows] = await getPool().query(
    `
      SELECT a.*, ${attachmentTextSelectSql}
      FROM task_attachments a
      ${attachmentTextJoinSql('task')}
      WHERE a.id = ?
        ${includeDeleted ? '' : 'AND a.deleted_at IS NULL'}
    `,
    [Number(id)],
  );
  return rows[0] || null;
}

async function taskExists(taskId) {
  const [rows] = await getPool().query(
    'SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL',
    [Number(taskId)],
  );
  return rows.length > 0;
}

async function noteExists(noteId) {
  const [rows] = await getPool().query(
    'SELECT id FROM task_notes WHERE id = ? AND deleted_at IS NULL',
    [Number(noteId)],
  );
  return rows.length > 0;
}

async function attachmentBelongsToTask(attachmentId, taskId) {
  if (!attachmentId) return true;
  const [rows] = await getPool().query(
    `
      SELECT a.id
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      JOIN tasks t ON t.id = l.task_id
      WHERE a.id = ? AND l.task_id = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
    [Number(attachmentId), Number(taskId)],
  );
  return rows.length > 0;
}

function normalizeNoteTitle(value, content) {
  const title = toNullableText(value)
    || toNullableText(String(content || '').replace(/\s+/g, ' ').slice(0, 48))
    || '未命名笔记';
  return title.slice(0, 160);
}

function normalizeContentJson(value, fallback = null) {
  if (value === undefined) {
    if (!fallback) return null;
    return typeof fallback === 'object' ? JSON.stringify(fallback) : fallback;
  }
  if (!value) return null;
  return JSON.stringify(value);
}

function normalizeNoteVersionSource(value) {
  const source = String(value || '').trim();
  if (['manual', 'ai_format', 'restore'].includes(source)) return source;
  return 'manual';
}

function noteSnapshot(row) {
  return {
    taskId: row.task_id ? Number(row.task_id) : null,
    title: row.title || '未命名笔记',
    attachmentId: row.attachment_id ? Number(row.attachment_id) : null,
    category: row.category || '',
    content: row.content || '',
    contentJson: parseJsonValue(row.content_json),
    sortOrder: Number(row.sort_order || 0),
  };
}

function snapshotChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function createNoteVersion(connection, noteId, beforeRow, afterRow, source = 'manual', changeNote = '') {
  const before = noteSnapshot(beforeRow);
  const after = noteSnapshot(afterRow);
  if (!snapshotChanged(before, after)) return;
  await connection.query(
    `
      INSERT INTO note_versions
        (note_id, source, change_note, before_snapshot, after_snapshot)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      Number(noteId),
      normalizeNoteVersionSource(source),
      toNullableText(changeNote)?.slice(0, 255) || null,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}

function mapNoteVersion(row) {
  return {
    id: Number(row.id),
    noteId: Number(row.note_id),
    source: row.source || 'manual',
    changeNote: row.change_note || '',
    before: parseJsonValue(row.before_snapshot),
    after: parseJsonValue(row.after_snapshot),
    createdAt: row.created_at,
  };
}

function normalizeLogVersionSource(value) {
  const source = String(value || '').trim();
  if (['manual', 'restore', 'ai_format'].includes(source)) return source;
  return 'manual';
}

function logSnapshot(row) {
  return {
    taskId: Number(row.task_id),
    stage: row.stage || 'in_progress',
    logDate: row.log_date,
    content: row.content || '',
    hours: Number(row.hours || 0),
    progressSnapshot: Number(row.progress_snapshot || 0),
    nextStep: row.next_step || '',
  };
}

async function createLogVersion(connection, logId, beforeRow, afterRow, source = 'manual', changeNote = '') {
  const before = logSnapshot(beforeRow);
  const after = logSnapshot(afterRow);
  if (!snapshotChanged(before, after)) return;
  await connection.query(
    `
      INSERT INTO log_versions
        (log_id, source, change_note, before_snapshot, after_snapshot)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      Number(logId),
      normalizeLogVersionSource(source),
      toNullableText(changeNote)?.slice(0, 255) || null,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}

function mapLogVersion(row) {
  return {
    id: Number(row.id),
    logId: Number(row.log_id),
    source: row.source || 'manual',
    changeNote: row.change_note || '',
    before: parseJsonValue(row.before_snapshot),
    after: parseJsonValue(row.after_snapshot),
    createdAt: row.created_at,
  };
}

function removeAttachmentFromContentJson(value, attachmentId) {
  if (!value) return null;
  const json = typeof value === 'object' ? value : JSON.parse(value);
  const removeId = Number(attachmentId);

  const visit = (node) => {
    if (!node) return null;
    if (node.type === 'fileAttachment' && Number(node.attrs?.id) === removeId) {
      return null;
    }
    if (Array.isArray(node.content)) {
      return {
        ...node,
        content: node.content.map(visit).filter(Boolean),
      };
    }
    return node;
  };

  return JSON.stringify(visit(json));
}

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
    a.updated_at AS attachment_updated_at,
    tn.title AS task_title,
    tn.status AS task_status,
    tn.priority AS task_priority,
    tn.deleted_at AS task_deleted_at
  FROM task_notes n
  LEFT JOIN log_attachments a ON a.id = n.attachment_id AND a.deleted_at IS NULL
  LEFT JOIN tasks tn ON tn.id = n.task_id
`;

async function deleteAttachmentRows(rows) {
  await Promise.all(rows.map(removeAttachmentFile));
}

async function beginAttachmentTextExtraction(kind, attachments) {
  await Promise.all(
    attachments.map((attachment) => queueAttachmentTextExtraction(kind, attachment.id)),
  );
  attachments.forEach((attachment) => {
    scheduleAttachmentTextExtraction(kind, attachment.id);
  });
}

async function mapNotesWithAttachments(rows) {
  const notes = rows.map(mapNote);
  const noteAttachments = await getNoteAttachmentRowsByNoteIds(notes.map((note) => note.id));
  const byNote = new Map();
  for (const attachment of noteAttachments.map(mapNoteAttachment)) {
    const current = byNote.get(attachment.noteId) || [];
    current.push(attachment);
    byNote.set(attachment.noteId, current);
  }
  return notes.map((note) => ({
    ...note,
    attachments: byNote.get(note.id) || [],
  }));
}

async function hardDeleteTask(taskId) {
  const [attachmentRows] = await getPool().query(
    `
      SELECT a.*
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      WHERE l.task_id = ?
    `,
    [taskId],
  );
  const [noteAttachmentRows] = await getPool().query(
    `
      SELECT a.*
      FROM note_attachments a
      JOIN task_notes n ON n.id = a.note_id
      WHERE n.task_id = ?
    `,
    [taskId],
  );
  const taskAttachmentRows = await getTaskAttachmentRows(taskId, { includeDeleted: true });
  const [result] = await getPool().query('DELETE FROM tasks WHERE id = ?', [taskId]);
  if (!result.affectedRows) return false;

  await Promise.all([
    ...attachmentRows.map((attachment) => deleteAttachmentTextCache('log', attachment.id)),
    ...noteAttachmentRows.map((attachment) => deleteAttachmentTextCache('note', attachment.id)),
    ...taskAttachmentRows.map((attachment) => deleteAttachmentTextCache('task', attachment.id)),
  ]);
  await deleteAttachmentRows([...attachmentRows, ...noteAttachmentRows, ...taskAttachmentRows]);
  return true;
}

async function hardDeleteNote(noteId) {
  const attachments = await getNoteAttachmentRowsByNoteIds([Number(noteId)], { includeDeleted: true });
  const [result] = await getPool().query('DELETE FROM task_notes WHERE id = ?', [Number(noteId)]);
  if (!result.affectedRows) return false;

  await Promise.all(attachments.map((attachment) => deleteAttachmentTextCache('note', attachment.id)));
  await deleteAttachmentRows(attachments);
  attachments.forEach((attachment) => {
    scheduleIndexJob({
      targetType: 'note-attachments',
      targetId: attachment.id,
      operation: 'delete',
      reason: 'permanent delete note attachment cleanup',
    });
  });
  return true;
}

async function hardDeleteLog(logId) {
  const attachments = await getAttachmentRowsByLogIds([Number(logId)], { includeDeleted: true });
  const [result] = await getPool().query('DELETE FROM work_logs WHERE id = ?', [Number(logId)]);
  if (!result.affectedRows) return false;

  await Promise.all(attachments.map((attachment) => deleteAttachmentTextCache('log', attachment.id)));
  await deleteAttachmentRows(attachments);
  attachments.forEach((attachment) => {
    scheduleIndexJob({
      targetType: 'log-attachments',
      targetId: attachment.id,
      operation: 'delete',
      reason: 'permanent delete log attachment cleanup',
    });
  });
  return true;
}

async function getDeletedAttachment(kind, id) {
  if (kind === 'log') {
    return getAttachmentRow(id, { includeDeleted: true });
  }
  if (kind === 'note') {
    return getNoteAttachmentRow(id, { includeDeleted: true });
  }
  if (kind === 'task') {
    return getTaskAttachmentRow(id, { includeDeleted: true });
  }
  return null;
}

function attachmentTable(kind) {
  return {
    log: 'log_attachments',
    note: 'note_attachments',
    task: 'task_attachments',
  }[kind] || null;
}

function attachmentIndexTargetType(kind) {
  return {
    log: 'log-attachments',
    note: 'note-attachments',
    task: 'task-attachments',
  }[kind] || 'attachments';
}

async function softDeleteAttachment(kind, id, reason = '用户删除附件') {
  const table = attachmentTable(kind);
  if (!table) return null;
  const attachment = await getDeletedAttachment(kind, id);
  if (!attachment || attachment.deleted_at) return null;

  await getPool().query(
    `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL`,
    [String(reason || '用户删除附件').slice(0, 255), Number(id)],
  );

  if (kind === 'note') {
    const [[noteRow]] = await getPool().query('SELECT content_json FROM task_notes WHERE id = ?', [attachment.note_id]);
    if (noteRow?.content_json) {
      await getPool().query('UPDATE task_notes SET content_json = ? WHERE id = ?', [
        removeAttachmentFromContentJson(noteRow.content_json, id),
        attachment.note_id,
      ]);
    }
  }

  scheduleIndexJob({
    targetType: attachmentIndexTargetType(kind),
    targetId: attachment.id,
    operation: 'delete',
    reason: 'attachment moved to trash',
  });
  return attachment;
}

async function hardDeleteAttachment(kind, id) {
  const attachment = await getDeletedAttachment(kind, id);
  if (!attachment || !attachment.deleted_at) return false;
  const table = attachmentTable(kind);
  if (!table) return false;
  const [result] = await getPool().query(`DELETE FROM ${table} WHERE id = ?`, [Number(id)]);
  if (!result.affectedRows) return false;
  await deleteAttachmentTextCache(kind, attachment.id);
  await removeAttachmentFile(attachment);
  return attachment;
}

function mapTrashTask(row) {
  return {
    type: 'task',
    id: Number(row.id),
    title: row.title,
    summary: row.description || '',
    status: row.status,
    priority: row.priority,
    deletedAt: row.deleted_at,
    deletedReason: row.deleted_reason || '',
    counts: {
      logs: Number(row.log_count || 0),
      notes: Number(row.note_count || 0),
      attachments: Number(row.attachment_count || 0),
    },
  };
}

function mapTrashLog(row) {
  return {
    type: 'log',
    id: Number(row.id),
    title: row.task_title || `日志 #${row.id}`,
    summary: row.content || '',
    taskId: Number(row.task_id),
    taskTitle: row.task_title || '',
    taskDeletedAt: row.task_deleted_at || null,
    logDate: row.log_date,
    hours: Number(row.hours || 0),
    deletedAt: row.deleted_at,
    deletedReason: row.deleted_reason || '',
  };
}

function mapTrashNote(row) {
  return {
    type: 'note',
    id: Number(row.id),
    title: row.title || '未命名笔记',
    summary: row.content || '',
    category: row.category || '',
    taskId: row.task_id ? Number(row.task_id) : null,
    taskTitle: row.task_title || '',
    taskDeletedAt: row.task_deleted_at || null,
    deletedAt: row.deleted_at,
    deletedReason: row.deleted_reason || '',
  };
}

function mapTrashAttachment(kind, row, attachment) {
  return {
    type: 'attachment',
    kind,
    id: attachment.id,
    title: attachment.originalName || '附件',
    summary: attachment.note || row.source_title || '',
    attachment,
    taskId: row.task_id ? Number(row.task_id) : null,
    taskTitle: row.task_title || '',
    taskDeletedAt: row.task_deleted_at || null,
    logId: row.log_id ? Number(row.log_id) : null,
    logDate: row.log_date || '',
    logDeletedAt: row.log_deleted_at || null,
    noteId: row.note_id ? Number(row.note_id) : null,
    noteTitle: row.note_title || '',
    noteCategory: row.note_category || '',
    noteDeletedAt: row.note_deleted_at || null,
    sourceTitle: row.source_title || row.task_title || row.note_title || '',
    deletedAt: attachment.deletedAt,
    deletedReason: attachment.deletedReason,
  };
}

function mapAttachmentCenterItem(kind, row, attachment) {
  return {
    kind,
    attachment,
    id: attachment.id,
    taskId: row.task_id ? Number(row.task_id) : null,
    taskTitle: row.task_title || '',
    logId: row.log_id ? Number(row.log_id) : null,
    logDate: row.log_date || '',
    noteId: row.note_id ? Number(row.note_id) : null,
    noteTitle: row.note_title || '',
    noteCategory: row.note_category || '',
    sourceLabel: kind === 'task' ? '任务附件' : kind === 'log' ? '日志附件' : '笔记附件',
    sourceTitle: row.source_title || row.task_title || row.note_title || row.original_name || '附件',
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

function addAttachmentCenterFilters(where, params, { fileType, textStatus }) {
  if (fileType === 'image') {
    where.push("(a.mime_type LIKE 'image/%' OR LOWER(a.original_name) REGEXP '\\\\.(jpg|jpeg|png|gif|webp|bmp)$')");
  } else if (fileType === 'pdf') {
    where.push("(LOWER(a.original_name) LIKE '%.pdf' OR a.mime_type = 'application/pdf')");
  } else if (fileType === 'document') {
    where.push("(LOWER(a.original_name) REGEXP '\\\\.(doc|docx)$' OR a.mime_type LIKE '%word%' OR a.mime_type LIKE '%document%')");
  } else if (fileType === 'spreadsheet') {
    where.push("(LOWER(a.original_name) REGEXP '\\\\.(xls|xlsx|csv)$' OR a.mime_type LIKE '%excel%' OR a.mime_type LIKE '%spreadsheet%' OR a.mime_type = 'text/csv')");
  } else if (fileType === 'archive') {
    where.push("(LOWER(a.original_name) REGEXP '\\\\.(zip|rar|7z|tar|gz)$' OR a.mime_type LIKE '%zip%' OR a.mime_type LIKE '%compressed%' OR a.mime_type LIKE '%x-7z%' OR a.mime_type LIKE '%x-rar%')");
  } else if (fileType === 'other') {
    where.push(`NOT (
      a.mime_type LIKE 'image/%'
      OR LOWER(a.original_name) REGEXP '\\\\.(jpg|jpeg|png|gif|webp|bmp|pdf|doc|docx|xls|xlsx|csv|zip|rar|7z|tar|gz)$'
      OR a.mime_type = 'application/pdf'
      OR a.mime_type LIKE '%word%'
      OR a.mime_type LIKE '%document%'
      OR a.mime_type LIKE '%excel%'
      OR a.mime_type LIKE '%spreadsheet%'
      OR a.mime_type = 'text/csv'
      OR a.mime_type LIKE '%zip%'
      OR a.mime_type LIKE '%compressed%'
      OR a.mime_type LIKE '%x-7z%'
      OR a.mime_type LIKE '%x-rar%'
    )`);
  }

  if (textStatus === 'none') {
    where.push('atc.status IS NULL');
  } else if (['pending', 'processing', 'completed', 'failed', 'unsupported'].includes(textStatus)) {
    where.push('atc.status = ?');
    params.push(textStatus);
  }
}

function createUpload(root) {
  return multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        const dir = path.join(root, String(req.params.id));
        fs.mkdir(dir, { recursive: true }, (error) => cb(error, dir));
      },
      filename(_req, file, cb) {
        const safeName = normalizeUploadedFileName(file.originalname);
        cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
      },
    }),
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 10,
    },
    fileFilter(_req, file, cb) {
      if (!isAllowedUpload(file)) {
        cb(new Error('仅支持图片、PDF、Word、Excel、压缩包等常用文件类型。'));
        return;
      }
      cb(null, true);
    },
  });
}

const upload = createUpload(logUploadRoot);
const noteUpload = createUpload(noteUploadRoot);
const taskUpload = createUpload(taskUploadRoot);

async function repairAttachmentFileNames() {
  const db = getPool();
  const tables = ['log_attachments', 'note_attachments', 'task_attachments'];

  for (const table of tables) {
    const [rows] = await db.query(`SELECT id, original_name FROM ${table}`);
    for (const row of rows) {
      const correctedName = normalizeUploadedFileName(row.original_name);
      if (correctedName !== row.original_name) {
        await db.query(`UPDATE ${table} SET original_name = ? WHERE id = ?`, [correctedName, row.id]);
        if (table === 'note_attachments') {
          await repairNoteAttachmentNameInContent(row.note_id, row.id, row.original_name, correctedName);
        }
      }
    }
  }

  const [noteAttachments] = await db.query('SELECT id, note_id, original_name FROM note_attachments');
  for (const attachment of noteAttachments) {
    await repairNoteAttachmentNameInContent(
      attachment.note_id,
      attachment.id,
      null,
      attachment.original_name,
    );
  }
}

async function repairNoteAttachmentNameInContent(noteId, attachmentId, oldName, correctedName) {
  const db = getPool();
  const [rows] = await db.query(
    'SELECT content, CAST(content_json AS CHAR) AS content_json FROM task_notes WHERE id = ?',
    [noteId],
  );
  const note = rows[0];
  if (!note) return;

  let content = String(note.content || '');
  if (oldName && oldName !== correctedName) {
    content = content.split(oldName).join(correctedName);
  }
  let contentJson = note.content_json;
  let jsonChanged = false;

  if (contentJson) {
    try {
      const document = JSON.parse(contentJson);
      const updateAttachmentNode = (node) => {
        if (node?.type === 'fileAttachment' && Number(node.attrs?.id) === Number(attachmentId)) {
          if (node.attrs.name !== correctedName) {
            const previousName = String(node.attrs.name || '');
            if (previousName) content = content.split(previousName).join(correctedName);
            node.attrs.name = correctedName;
            jsonChanged = true;
          }
        }
        node?.content?.forEach(updateAttachmentNode);
      };
      updateAttachmentNode(document);
      if (jsonChanged) contentJson = JSON.stringify(document);
    } catch {
      // Legacy plain-text notes can have invalid JSON; their content remains usable.
    }
  }

  if (content !== note.content || jsonChanged) {
    await db.query(
      'UPDATE task_notes SET content = ?, content_json = ? WHERE id = ?',
      [content, contentJson, noteId],
    );
  }
}

app.set('trust proxy', config.auth.secureCookies ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  strictTransportSecurity: false,
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.cors.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: config.auth.mode === 'oidc',
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
installAuthMiddleware(app);

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function writeSseEvent(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

installAuthRoutes(app, asyncRoute);
installMcpServer(app);
app.use('/api', requireApiAuth);
app.use('/api', observeApiWrites);

const progressForStatus = (status, progress) => {
  if (status === 'todo') return 0;
  if (status === 'done') return 100;
  return Math.max(0, Math.min(99, toProgress(progress)));
};

function normalizeAiScope(value, taskId = null) {
  if (value === 'task') return 'task';
  if (value === 'workspace') return 'workspace';
  return taskId ? 'task' : 'workspace';
}

function aiTaskIdForScope(scope, value) {
  const taskId = Number(value);
  return scope === 'task' && Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

function textPreview(value, maxLength = 160) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function titleFromQuestion(question) {
  return textPreview(question, 48) || '新对话';
}

function parseJsonValue(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapAiConversation(row) {
  return {
    id: Number(row.id),
    scope: row.scope,
    taskId: row.task_id === null || row.task_id === undefined ? null : Number(row.task_id),
    title: row.title || '新对话',
    preview: row.preview || '',
    localKey: row.local_key || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAiMessage(row) {
  const storedMetadata = parseJsonValue(row.sources_json, []);
  const metadata = Array.isArray(storedMetadata)
    ? { sources: storedMetadata }
    : (storedMetadata || {});
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    role: row.role,
    content: row.content || '',
    sources: Array.isArray(metadata.sources) ? metadata.sources : [],
    intent: metadata.intent || '',
    grounded: metadata.grounded,
    facts: Array.isArray(metadata.facts) ? metadata.facts : [],
    suggestions: Array.isArray(metadata.suggestions) ? metadata.suggestions : [],
    actionRequests: Array.isArray(metadata.actionRequests) ? metadata.actionRequests : [],
    createdAt: row.created_at,
  };
}

async function getAiConversation(id) {
  const [rows] = await getPool().query('SELECT * FROM ai_conversations WHERE id = ? LIMIT 1', [id]);
  return rows[0] ? mapAiConversation(rows[0]) : null;
}

async function ensureAiConversation({ conversationId, scope, taskId, localKey, title }) {
  const normalizedId = Number(conversationId);
  if (Number.isInteger(normalizedId) && normalizedId > 0) {
    const existing = await getAiConversation(normalizedId);
    if (existing) return existing;
  }

  const normalizedScope = normalizeAiScope(scope, taskId);
  const normalizedTaskId = aiTaskIdForScope(normalizedScope, taskId);
  const normalizedLocalKey = toNullableText(localKey);

  if (normalizedLocalKey) {
    const [existingRows] = await getPool().query(
      'SELECT * FROM ai_conversations WHERE local_key = ? LIMIT 1',
      [normalizedLocalKey],
    );
    if (existingRows[0]) return mapAiConversation(existingRows[0]);
  }

  const [result] = await getPool().query(
    'INSERT INTO ai_conversations (scope, task_id, title, local_key) VALUES (?, ?, ?, ?)',
    [normalizedScope, normalizedTaskId, toNullableText(title) || '新对话', normalizedLocalKey],
  );
  return getAiConversation(result.insertId);
}

async function saveAiExchange(conversationId, question, answer, sources = [], metadata = {}) {
  const assistantMetadata = {
    sources: sources || [],
    intent: metadata.intent || '',
    grounded: metadata.grounded,
    facts: Array.isArray(metadata.facts) ? metadata.facts : [],
    suggestions: Array.isArray(metadata.suggestions) ? metadata.suggestions : [],
    actionRequests: Array.isArray(metadata.actionRequests) ? metadata.actionRequests : [],
  };
  await getPool().query(
    'INSERT INTO ai_messages (conversation_id, role, content, sources_json) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    [
      conversationId,
      'user',
      question,
      null,
      conversationId,
      'assistant',
      answer || '',
      JSON.stringify(assistantMetadata),
    ],
  );

  const title = titleFromQuestion(question);
  const preview = textPreview(answer || question);
  await getPool().query(
    `
      UPDATE ai_conversations
      SET
        title = CASE WHEN title = '新对话' OR title = '' THEN ? ELSE title END,
        preview = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [title, preview, conversationId],
  );
  return getAiConversation(conversationId);
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await getPool().query('SELECT 1');
  res.json({ ok: true });
}));

app.get('/api/system/checks', asyncRoute(async (_req, res) => {
  res.json(await runSystemChecks(getPool()));
}));

app.get('/api/settings', asyncRoute(async (_req, res) => {
  res.json({ ...getSettingsSnapshot(), weixin: getWeixinStatus() });
}));

app.get('/api/settings/weixin', asyncRoute(async (_req, res) => {
  res.json(getWeixinStatus());
}));

app.get('/api/settings/weixin/events', (req, res) => {
  openWeixinEventStream(req, res);
});

app.post('/api/settings/weixin/login', asyncRoute(async (req, res) => {
  res.status(202).json(await startWeixinLogin({ force: req.body?.force === true }));
}));

app.post('/api/settings/weixin/verify', asyncRoute(async (req, res) => {
  res.json(await submitWeixinVerifyCode(req.body?.code));
}));

app.post('/api/settings/weixin/disconnect', asyncRoute(async (_req, res) => {
  res.json(await disconnectWeixin());
}));

app.patch('/api/settings/ai', asyncRoute(async (req, res) => {
  res.json({ ai: await saveAiSettings(req.body || {}) });
}));

app.post('/api/settings/ai/test', asyncRoute(async (req, res) => {
  res.json(await testAiConnection(req.body || {}));
}));

app.patch('/api/settings/password', asyncRoute(async (req, res) => {
  res.json(await changeAccessPassword(req.body || {}));
}));

app.get('/api/settings/update', asyncRoute(async (_req, res) => {
  res.json(getOnlineUpdateStatus());
}));

app.get('/api/settings/update/events', (req, res) => {
  openOnlineUpdateEventStream(req, res);
});

app.post('/api/settings/update/check', asyncRoute(async (req, res) => {
  res.json(await checkOnlineUpdate(req.body || {}));
}));

app.post('/api/settings/update', asyncRoute(async (req, res) => {
  res.status(202).json(await startOnlineUpdate(req.body || {}));
}));

app.get('/api/backups', asyncRoute(async (req, res) => {
  res.json({ backups: await listBackups({ limit: req.query.limit }) });
}));

app.post('/api/backups', asyncRoute(async (_req, res) => {
  res.status(201).json(await createBackup());
}));

app.post('/api/backups/verify', asyncRoute(async (req, res) => {
  const backupDir = toNullableText(req.body.backupDir) || await latestBackupDir();
  if (!backupDir) {
    return res.status(404).json({ message: '没有找到可用备份，请先创建备份。' });
  }
  res.json(await verifyBackup(backupDir));
}));

app.get('/api/events', (req, res) => {
  openEventStream(req, res);
});

app.get('/api/ai/conversations', asyncRoute(async (req, res) => {
  const scope = normalizeAiScope(req.query.scope, req.query.taskId);
  const taskId = aiTaskIdForScope(scope, req.query.taskId);
  if (scope === 'task' && !taskId) {
    return res.status(400).json({ message: '任务对话需要 taskId。' });
  }

  const params = [scope];
  const taskFilter = scope === 'task' ? 'task_id = ?' : 'task_id IS NULL';
  if (scope === 'task') params.push(taskId);

  const [rows] = await getPool().query(
    `
      SELECT *
      FROM ai_conversations
      WHERE scope = ? AND ${taskFilter}
      ORDER BY updated_at DESC, id DESC
      LIMIT 80
    `,
    params,
  );
  res.json({ conversations: rows.map(mapAiConversation) });
}));

app.post('/api/ai/conversations', asyncRoute(async (req, res) => {
  const scope = normalizeAiScope(req.body.scope, req.body.taskId);
  const taskId = aiTaskIdForScope(scope, req.body.taskId);
  if (scope === 'task' && !taskId) {
    return res.status(400).json({ message: '任务对话需要 taskId。' });
  }

  const conversation = await ensureAiConversation({
    scope,
    taskId,
    localKey: req.body.localKey,
    title: toNullableText(req.body.title) || '新对话',
  });
  res.status(201).json({ conversation });
}));

app.patch('/api/ai/conversations/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '对话 ID 不正确。' });
  const title = toNullableText(req.body.title);
  if (!title) return res.status(400).json({ message: '请输入对话标题。' });

  await getPool().query('UPDATE ai_conversations SET title = ? WHERE id = ?', [title.slice(0, 160), id]);
  const conversation = await getAiConversation(id);
  if (!conversation) return res.status(404).json({ message: '对话不存在。' });
  res.json({ conversation });
}));

app.delete('/api/ai/conversations/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '对话 ID 不正确。' });
  await getPool().query('DELETE FROM ai_conversations WHERE id = ?', [id]);
  res.status(204).end();
}));

app.get('/api/ai/conversations/:id/messages', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '对话 ID 不正确。' });
  const conversation = await getAiConversation(id);
  if (!conversation) return res.status(404).json({ message: '对话不存在。' });

  const [rows] = await getPool().query(
    `
      SELECT *
      FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [id],
  );
  res.json({ conversation, messages: rows.map(mapAiMessage) });
}));

app.get('/api/ai/index-status', asyncRoute(async (_req, res) => {
  res.json(await getIndexStatus());
}));

app.post('/api/ai/search', asyncRoute(async (req, res) => {
  const question = toNullableText(req.body.question);
  if (!question) return res.status(400).json({ message: '请输入要检索的内容。' });
  const taskId = req.body.taskId ? Number(req.body.taskId) : null;
  try {
    res.json({ sources: await searchWorkspace(question, { taskId, limit: req.body.limit }) });
  } catch (error) {
    console.error('AI search failed:', error.message);
    res.status(503).json({ message: '智能检索暂不可用，请检查索引 Worker、Qdrant 与 LiteLLM 配置。' });
  }
}));

app.post('/api/ai/ask', asyncRoute(async (req, res) => {
  const question = toNullableText(req.body.question);
  if (!question) return res.status(400).json({ message: '请输入问题。' });
  const taskId = req.body.taskId ? Number(req.body.taskId) : null;
  try {
    const actionPlan = await planAiActionRequest(question, {
      taskId,
      requestedBy: req.auth?.id || req.auth?.type || 'local-ai',
    });
    res.json(actionPlan || await answerWorkspace(question, { taskId, messages: req.body.messages }));
  } catch (error) {
    console.error('AI answer failed:', error.message);
    res.status(503).json({ message: '智能问答暂不可用，请检查索引 Worker、Qdrant 与 LiteLLM 配置。' });
  }
}));

app.post('/api/ai/tasks/:id/suggestions', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }
  try {
    res.json(await suggestTasksFromTask(taskId, { limit: req.body.limit }));
  } catch (error) {
    console.error('AI task suggestion failed:', error.message);
    res.status(503).json({ message: 'AI 任务建议暂不可用，请检查模型配置后重试。' });
  }
}));

app.post('/api/ai/tasks/:id/summary', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }
  try {
    res.json(await summarizeTaskWithAi(taskId));
  } catch (error) {
    console.error('AI task summary failed:', error.message);
    res.status(503).json({ message: 'AI 任务总结暂不可用，请检查模型配置后重试。' });
  }
}));

app.post('/api/ai/tasks/:taskId/notes/:noteId/log-draft', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.taskId);
  const noteId = Number(req.params.noteId);
  const [[task]] = await getPool().query(
    'SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL',
    [taskId],
  );
  if (!task) return res.status(404).json({ message: '任务不存在。' });

  const [[note]] = await getPool().query(
    'SELECT * FROM task_notes WHERE id = ? AND task_id = ? AND deleted_at IS NULL',
    [noteId, taskId],
  );
  if (!note) return res.status(404).json({ message: '笔记不存在，或不属于当前任务。' });

  try {
    const draft = await generateLogDraftFromNote({ task, note });
    res.json({ taskId, noteId, draft });
  } catch (error) {
    console.error('AI log draft failed:', error.message);
    const status = error.message === '笔记内容不能为空。' ? 400 : 503;
    res.status(status).json({ message: status === 400 ? error.message : 'AI 生成日志草稿暂不可用，请检查模型配置或稍后重试。' });
  }
}));

app.post('/api/ai/task-suggestions/actions', asyncRoute(async (req, res) => {
  const title = toNullableText(req.body.title);
  if (!title) return res.status(400).json({ message: '任务标题不能为空。' });
  const payload = {
    title: title.slice(0, 160),
    description: toNullableText(req.body.description),
    priority: PRIORITIES.includes(req.body.priority) ? req.body.priority : toPriority(req.body.priority),
    dueDate: toDateOrNull(req.body.dueDate),
    status: 'todo',
    progress: 0,
    tags: Array.isArray(req.body.tags)
      ? req.body.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : toNullableText(req.body.tags),
    sourceTaskId: req.body.sourceTaskId ? Number(req.body.sourceTaskId) : null,
    sourceReason: toNullableText(req.body.sourceReason) || 'AI 根据当前任务资料生成的后续任务建议',
  };
  const action = await createActionRequest({
    toolName: 'ai_task_suggestion',
    actionType: 'create_task',
    payload,
    requestedBy: req.auth?.id || req.auth?.type || 'local-ai',
    source: 'ai',
  });
  res.locals.auditTarget = { targetType: 'action-requests', targetId: String(action.id) };
  res.status(201).json(action);
}));

app.post('/api/ai/reports/summary', asyncRoute(async (req, res) => {
  try {
    res.json(await summarizeReportWithAi({
      from: req.body.from,
      to: req.body.to,
      type: req.body.type,
    }));
  } catch (error) {
    console.error('AI report summary failed:', error.message);
    res.status(503).json({ message: 'AI 汇总生成暂不可用，请检查模型配置后重试。' });
  }
}));

app.post('/api/ai/notes/format', asyncRoute(async (req, res) => {
  try {
    const result = await formatNoteWithAi({
      noteId: req.body.noteId ? Number(req.body.noteId) : null,
      title: toNullableText(req.body.title) || '',
      category: toNullableText(req.body.category) || '',
      content: toNullableText(req.body.content) || '',
      contentJson: req.body.contentJson || null,
      instruction: toNullableText(req.body.instruction) || '',
    });
    res.json(result);
  } catch (error) {
    console.error('AI note format failed:', error.message);
    const status = error.message === '笔记内容不能为空。' ? 400 : 503;
    res.status(status).json({ message: error.message || 'AI 整理暂不可用，请稍后重试。' });
  }
}));

app.post('/api/ai/notes/format-stream', asyncRoute(async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  try {
    const result = await streamFormatNoteWithAi({
      noteId: req.body.noteId ? Number(req.body.noteId) : null,
      title: toNullableText(req.body.title) || '',
      category: toNullableText(req.body.category) || '',
      content: toNullableText(req.body.content) || '',
      contentJson: req.body.contentJson || null,
      instruction: toNullableText(req.body.instruction) || '',
    }, {
      signal: controller.signal,
      onDelta: (delta) => writeSseEvent(res, 'delta', delta),
    });
    writeSseEvent(res, 'done', result);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('AI note format stream failed:', error.message);
      writeSseEvent(res, 'error', { message: error.message || 'AI 整理暂不可用，请稍后重试。' });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}));

app.post('/api/ai/ask-stream', asyncRoute(async (req, res) => {
  const question = toNullableText(req.body.question);
  if (!question) return res.status(400).json({ message: '请输入问题。' });

  const taskId = req.body.taskId ? Number(req.body.taskId) : null;
  const scope = normalizeAiScope(req.body.scope, taskId);
  const conversationTaskId = aiTaskIdForScope(scope, taskId);
  if (scope === 'task' && !conversationTaskId) {
    return res.status(400).json({ message: '任务对话需要 taskId。' });
  }
  const conversation = await ensureAiConversation({
    conversationId: req.body.conversationId,
    scope,
    taskId: conversationTaskId,
    localKey: req.body.localKey,
    title: titleFromQuestion(question),
  });
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  try {
    writeSseEvent(res, 'conversation', conversation);
    let finalPayload = {};
    const actionPlan = await planAiActionRequest(question, {
      taskId,
      requestedBy: req.auth?.id || req.auth?.type || 'local-ai',
    });
    let result;
    if (actionPlan) {
      result = actionPlan;
      writeSseEvent(res, 'intent', actionPlan.intent);
      writeSseEvent(res, 'sources', actionPlan.sources || []);
      writeSseEvent(res, 'actionRequests', actionPlan.actionRequests || []);
      writeSseEvent(res, 'delta', actionPlan.answer);
      finalPayload = {
        grounded: actionPlan.grounded,
        intent: actionPlan.intent,
        facts: actionPlan.facts,
        suggestions: actionPlan.suggestions,
        actionRequests: actionPlan.actionRequests,
      };
    } else {
      result = await streamAnswerWorkspace(question, {
        taskId,
        messages: req.body.messages,
        signal: controller.signal,
      }, {
        onIntent: (intent) => writeSseEvent(res, 'intent', intent),
        onSources: (sources) => writeSseEvent(res, 'sources', sources),
        onActionRequests: (actions) => writeSseEvent(res, 'actionRequests', actions),
        onDelta: (delta) => writeSseEvent(res, 'delta', delta),
        onDone: (payload) => {
          finalPayload = payload || {};
        },
      });
    }
    const savedConversation = await saveAiExchange(
      conversation.id,
      question,
      result.answer,
      result.sources,
      {
        ...finalPayload,
        actionRequests: result.actionRequests || finalPayload.actionRequests || [],
      },
    );
    writeSseEvent(res, 'done', {
      ...finalPayload,
      conversation: savedConversation,
    });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('AI stream failed:', error.message);
      writeSseEvent(res, 'error', { message: '智能问答暂不可用，请检查模型接口配置。' });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}));

app.post('/api/attachments/:kind/:id/reextract', asyncRoute(async (req, res) => {
  const kind = ['log', 'note', 'task'].includes(req.params.kind) ? req.params.kind : null;
  if (!kind) {
    return res.status(400).json({ message: '附件类型不正确。' });
  }

  const cache = await extractAndCacheAttachmentText(kind, req.params.id, { force: true });
  const targetType = {
    log: 'log-attachments',
    note: 'note-attachments',
    task: 'task-attachments',
  }[kind];
  scheduleIndexJob({
    targetType,
    targetId: Number(req.params.id),
    operation: 'upsert',
    reason: 'POST /attachments/:kind/:id/reextract',
  });
  res.json({
    status: cache.status,
    parser: cache.parser,
    textChars: Number(cache.text_chars || 0),
    textUpdatedAt: cache.updated_at,
    textError: cache.error_message || '',
    textTruncated: Boolean(cache.truncated),
  });
}));

app.get('/api/action-requests', asyncRoute(async (req, res) => {
  res.json(await listActionRequests({
    status: req.query.status || 'pending',
    limit: req.query.limit,
  }));
}));

app.post('/api/action-requests/:id/approve', asyncRoute(async (req, res) => {
  const decidedBy = req.auth?.id || req.auth?.type || 'local';
  const action = await approveActionRequest(req.params.id, { decidedBy });
  if (!action) {
    return res.status(404).json({ message: '动作请求不存在。' });
  }
  res.locals.auditTarget = { targetType: 'action-requests', targetId: String(action.id) };
  res.json(action);
}));

app.post('/api/action-requests/:id/reject', asyncRoute(async (req, res) => {
  const decidedBy = req.auth?.id || req.auth?.type || 'local';
  const action = await rejectActionRequest(req.params.id, {
    decidedBy,
    reason: req.body.reason,
  });
  res.locals.auditTarget = { targetType: 'action-requests', targetId: String(action.id) };
  res.json(action);
}));

app.get('/api/tasks', asyncRoute(async (req, res) => {
  const where = ['t.deleted_at IS NULL'];
  const params = [];
  const { status, priority, tag, dueFrom, dueTo } = req.query;

  if (STATUSES.includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (PRIORITIES.includes(priority)) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (tag) {
    where.push('t.tags LIKE ?');
    params.push(`%${String(tag).trim()}%`);
  }
  const fromDate = toDateOrNull(dueFrom);
  const toDate = toDateOrNull(dueTo);
  if (fromDate) {
    where.push('t.due_date >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    where.push('t.due_date <= ?');
    params.push(toDate);
  }

  const [rows] = await getPool().query(
    `
      SELECT
        t.*,
        (
          SELECT l.content
          FROM work_logs l
          WHERE l.task_id = t.id AND l.deleted_at IS NULL
          ORDER BY l.log_date DESC, l.id DESC
          LIMIT 1
        ) AS latest_log_content,
        (
          SELECT l.log_date
          FROM work_logs l
          WHERE l.task_id = t.id AND l.deleted_at IS NULL
          ORDER BY l.log_date DESC, l.id DESC
          LIMIT 1
        ) AS latest_log_date,
        (
          SELECT l.hours
          FROM work_logs l
          WHERE l.task_id = t.id AND l.deleted_at IS NULL
          ORDER BY l.log_date DESC, l.id DESC
          LIMIT 1
        ) AS latest_log_hours
      FROM tasks t
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY FIELD(t.status, 'todo', 'in_progress', 'done'), t.sort_order ASC, t.created_at DESC
    `,
    params,
  );

  res.json(rows.map(mapTask));
}));

app.post('/api/tasks', asyncRoute(async (req, res) => {
  const title = toNullableText(req.body.title);
  if (!title) {
    return res.status(400).json({ message: '任务标题不能为空。' });
  }

  const status = toStatus(req.body.status);
  const [[orderRow]] = await getPool().query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE status = ? AND deleted_at IS NULL',
    [status],
  );

  const [result] = await getPool().query(
    `
      INSERT INTO tasks
        (title, description, priority, due_date, progress, status, tags, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      title,
      toNullableText(req.body.description),
      toPriority(req.body.priority),
      toDateOrNull(req.body.dueDate),
      progressForStatus(status, req.body.progress),
      status,
      toTags(req.body.tags),
      Number(orderRow.next_order || 0),
    ],
  );

  const [rows] = await getPool().query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
  res.locals.auditTarget = { targetType: 'tasks', targetId: String(result.insertId) };
  res.status(201).json(mapTask(rows[0]));
}));

app.patch('/api/tasks/reorder', asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ message: '排序数据不能为空。' });
  }

  const normalized = items.map((item) => ({
    id: Number(item.id),
    status: toStatus(item.status, ''),
    sortOrder: Number(item.sortOrder),
  }));

  const invalid = normalized.some(
    (item) => !Number.isInteger(item.id) || item.id <= 0 || !item.status || !Number.isFinite(item.sortOrder),
  );
  if (invalid) {
    return res.status(400).json({ message: '排序数据格式不正确。' });
  }

  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of normalized) {
      await connection.query(
        `
          UPDATE tasks
          SET
            status = ?,
            sort_order = ?,
            progress = CASE
              WHEN ? = 'todo' THEN 0
              WHEN ? = 'done' THEN 100
              ELSE LEAST(progress, 99)
            END
          WHERE id = ?
            AND deleted_at IS NULL
        `,
        [item.status, item.sortOrder, item.status, item.status, item.id],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ ok: true });
}));

app.patch('/api/tasks/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const [existingRows] = await getPool().query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!existingRows.length) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const current = existingRows[0];
  const nextStatus = req.body.status === undefined ? current.status : toStatus(req.body.status, current.status);
  let nextSortOrder = current.sort_order;

  if (req.body.sortOrder !== undefined && Number.isFinite(Number(req.body.sortOrder))) {
    nextSortOrder = Number(req.body.sortOrder);
  } else if (nextStatus !== current.status) {
    const [[orderRow]] = await getPool().query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tasks WHERE status = ? AND deleted_at IS NULL',
      [nextStatus],
    );
    nextSortOrder = Number(orderRow.next_order || 0);
  }

  await getPool().query(
    `
      UPDATE tasks
      SET
        title = ?,
        description = ?,
        priority = ?,
        due_date = ?,
        progress = ?,
        status = ?,
        tags = ?,
        sort_order = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
    [
      req.body.title === undefined ? current.title : toNullableText(req.body.title) || current.title,
      req.body.description === undefined ? current.description : toNullableText(req.body.description),
      req.body.priority === undefined ? current.priority : toPriority(req.body.priority, current.priority),
      req.body.dueDate === undefined ? current.due_date : toDateOrNull(req.body.dueDate),
      progressForStatus(
        nextStatus,
        req.body.progress === undefined ? current.progress : req.body.progress,
      ),
      nextStatus,
      req.body.tags === undefined ? current.tags : toTags(req.body.tags),
      nextSortOrder,
      id,
    ],
  );

  const [rows] = await getPool().query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [id]);
  res.json(mapTask(rows[0]));
}));

app.delete('/api/tasks/:id', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  const reason = toNullableText(req.body?.reason) || '用户删除任务';
  const [result] = await getPool().query(
    'UPDATE tasks SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL',
    [reason.slice(0, 255), taskId],
  );
  if (!result.affectedRows) {
    return res.status(404).json({ message: '任务不存在。' });
  }
  scheduleIndexJob({
    targetType: 'tasks',
    targetId: taskId,
    operation: 'delete',
    reason: 'DELETE /tasks/:id moved to trash',
  });
  res.locals.auditTarget = { targetType: 'tasks', targetId: String(taskId) };
  res.status(204).end();
}));

app.get('/api/note-categories', asyncRoute(async (_req, res) => {
  const [rows] = await getPool().query(
    `
      SELECT n.category, COUNT(*) AS note_count, MAX(n.updated_at) AS latest_updated
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.deleted_at IS NULL
        AND (n.task_id IS NULL OR t.deleted_at IS NULL)
        AND n.category IS NOT NULL
        AND TRIM(n.category) <> ''
      GROUP BY n.category
      ORDER BY note_count DESC, latest_updated DESC, n.category ASC
      LIMIT 100
    `,
  );

  res.json(rows.map((row) => ({
    name: row.category,
    count: Number(row.note_count || 0),
  })));
}));

app.get('/api/tasks/:id/notes', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const search = toNullableText(req.query.search);
  const category = toNullableText(req.query.category);
  const where = ['n.task_id = ?', 'n.deleted_at IS NULL'];
  const params = [taskId];

  if (search) {
    where.push('(n.title LIKE ? OR n.content LIKE ? OR n.category LIKE ? OR a.original_name LIKE ? OR a.note LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    where.push('n.category = ?');
    params.push(category);
  }

  const [rows] = await getPool().query(
    `
      ${noteSelectSql}
      WHERE ${where.join(' AND ')}
      ORDER BY n.sort_order ASC, n.updated_at DESC, n.id DESC
    `,
    params,
  );
  res.json(await mapNotesWithAttachments(rows));
}));

app.post('/api/tasks/:id/notes', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const content = toNullableText(req.body.content);
  if (!content) {
    return res.status(400).json({ message: '笔记内容不能为空。' });
  }

  const category = toNullableText(req.body.category);
  const title = normalizeNoteTitle(req.body.title, content);
  const contentJson = normalizeContentJson(req.body.contentJson);
  const attachmentId = req.body.attachmentId ? Number(req.body.attachmentId) : null;
  if (!(await attachmentBelongsToTask(attachmentId, taskId))) {
    return res.status(400).json({ message: '只能引用当前任务下的附件。' });
  }

  const [result] = await getPool().query(
    'INSERT INTO task_notes (task_id, title, attachment_id, category, content, content_json) VALUES (?, ?, ?, ?, ?, ?)',
    [taskId, title, attachmentId, category ? category.slice(0, 60) : null, content, contentJson],
  );

  const [rows] = await getPool().query(`${noteSelectSql} WHERE n.id = ?`, [result.insertId]);
  const [note] = await mapNotesWithAttachments(rows);
  res.locals.auditTarget = { targetType: 'notes', targetId: String(result.insertId) };
  res.status(201).json(note);
}));

app.get('/api/notes', asyncRoute(async (req, res) => {
  const search = toNullableText(req.query.search);
  const category = toNullableText(req.query.category);
  const includeLinked = req.query.includeLinked === '1' || req.query.includeLinked === 'true';
  const where = includeLinked
    ? ['n.deleted_at IS NULL', '(n.task_id IS NULL OR tn.deleted_at IS NULL)']
    : ['n.task_id IS NULL', 'n.deleted_at IS NULL'];
  const params = [];

  if (search) {
    where.push('(n.title LIKE ? OR n.content LIKE ? OR n.category LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    where.push('n.category = ?');
    params.push(category);
  }

  const [rows] = await getPool().query(
    `
      ${noteSelectSql}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY n.sort_order ASC, n.updated_at DESC, n.id DESC
    `,
    params,
  );
  res.json(await mapNotesWithAttachments(rows));
}));

app.post('/api/notes', asyncRoute(async (req, res) => {
  const content = toNullableText(req.body.content);
  if (!content) {
    return res.status(400).json({ message: '笔记内容不能为空。' });
  }

  const category = toNullableText(req.body.category);
  const title = normalizeNoteTitle(req.body.title, content);
  const contentJson = normalizeContentJson(req.body.contentJson);
  const [result] = await getPool().query(
    'INSERT INTO task_notes (task_id, title, attachment_id, category, content, content_json) VALUES (NULL, ?, NULL, ?, ?, ?)',
    [title, category ? category.slice(0, 60) : null, content, contentJson],
  );

  const [rows] = await getPool().query(`${noteSelectSql} WHERE n.id = ?`, [result.insertId]);
  const [note] = await mapNotesWithAttachments(rows);
  res.locals.auditTarget = { targetType: 'notes', targetId: String(result.insertId) };
  res.status(201).json(note);
}));

app.patch('/api/notes/reorder', asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ message: '排序数据不能为空。' });
  }

  const normalized = items.map((item) => ({
    id: Number(item.id),
    taskId: item.taskId === undefined ? undefined : (item.taskId ? Number(item.taskId) : null),
    sortOrder: Number(item.sortOrder),
  }));

  const invalid = normalized.some(
    (item) => !Number.isInteger(item.id) || item.id <= 0 || !Number.isFinite(item.sortOrder),
  );
  if (invalid) {
    return res.status(400).json({ message: '排序数据格式不正确。' });
  }

  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of normalized) {
      if (item.taskId !== undefined) {
        await connection.query(
          `
            UPDATE task_notes
            SET
              task_id = ?,
              sort_order = ?
          WHERE id = ? AND deleted_at IS NULL
          `,
          [item.taskId, item.sortOrder, item.id],
        );
      } else {
        await connection.query(
          `
            UPDATE task_notes
            SET
              sort_order = ?
            WHERE id = ? AND deleted_at IS NULL
          `,
          [item.sortOrder, item.id],
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

  res.json({ ok: true });
}));

app.get('/api/notes/:id/versions', asyncRoute(async (req, res) => {
  const noteId = Number(req.params.id);
  const [noteRows] = await getPool().query('SELECT id FROM task_notes WHERE id = ? AND deleted_at IS NULL', [noteId]);
  if (!noteRows.length) {
    return res.status(404).json({ message: '笔记不存在。' });
  }

  const [rows] = await getPool().query(
    `
      SELECT *
      FROM note_versions
      WHERE note_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 80
    `,
    [noteId],
  );
  res.json(rows.map(mapNoteVersion));
}));

app.post('/api/notes/:id/versions/:versionId/restore', asyncRoute(async (req, res) => {
  const noteId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  const snapshotName = req.body.snapshot === 'after' ? 'after_snapshot' : 'before_snapshot';
  const db = getPool();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [noteRows] = await connection.query('SELECT * FROM task_notes WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [noteId]);
    if (!noteRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: '笔记不存在。' });
    }

    const [versionRows] = await connection.query(
      'SELECT * FROM note_versions WHERE id = ? AND note_id = ?',
      [versionId, noteId],
    );
    if (!versionRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: '版本记录不存在。' });
    }

    const current = noteRows[0];
    const target = parseJsonValue(versionRows[0][snapshotName]);
    if (!target?.content) {
      await connection.rollback();
      return res.status(400).json({ message: '版本内容不可用，无法回退。' });
    }

    let attachmentId = target.attachmentId ? Number(target.attachmentId) : null;
    const currentTaskId = current.task_id ? Number(current.task_id) : null;
    if (attachmentId && !(await attachmentBelongsToTask(attachmentId, currentTaskId))) {
      attachmentId = null;
    }

    await connection.query(
      `
        UPDATE task_notes
        SET title = ?, category = ?, content = ?, content_json = ?, attachment_id = ?
        WHERE id = ?
      `,
      [
        normalizeNoteTitle(target.title, target.content),
        target.category ? String(target.category).slice(0, 60) : null,
        target.content,
        normalizeContentJson(target.contentJson),
        attachmentId,
        noteId,
      ],
    );

    const [updatedRows] = await connection.query('SELECT * FROM task_notes WHERE id = ?', [noteId]);
    await createNoteVersion(
      connection,
      noteId,
      current,
      updatedRows[0],
      'restore',
      `从版本 #${versionId} 回退`,
    );
    await connection.commit();

    const [rows] = await getPool().query(`${noteSelectSql} WHERE n.id = ?`, [noteId]);
    const [note] = await mapNotesWithAttachments(rows);
    res.json(note);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/notes/:id', asyncRoute(async (req, res) => {
  const noteId = Number(req.params.id);
  const [existingRows] = await getPool().query('SELECT * FROM task_notes WHERE id = ? AND deleted_at IS NULL', [noteId]);
  if (!existingRows.length) {
    return res.status(404).json({ message: '笔记不存在。' });
  }
  const existing = existingRows[0];

  const content = req.body.content === undefined
    ? existing.content
    : toNullableText(req.body.content);
  if (!content) {
    return res.status(400).json({ message: '笔记内容不能为空。' });
  }

  const category = req.body.category === undefined
    ? existing.category
    : toNullableText(req.body.category);
  const title = req.body.title === undefined
    ? existing.title
    : normalizeNoteTitle(req.body.title, content);

  const taskId = req.body.taskId === undefined
    ? (existing.task_id ? Number(existing.task_id) : null)
    : (req.body.taskId ? Number(req.body.taskId) : null);

  if (taskId && !(await taskExists(taskId))) {
    return res.status(404).json({ message: '关联的任务不存在。' });
  }

  let attachmentId = req.body.attachmentId === undefined
    ? existing.attachment_id
    : (req.body.attachmentId ? Number(req.body.attachmentId) : null);

  if (taskId !== existing.task_id) {
    if (attachmentId && !(await attachmentBelongsToTask(attachmentId, taskId))) {
      attachmentId = null;
    }
  } else {
    if (attachmentId && !(await attachmentBelongsToTask(attachmentId, taskId))) {
      return res.status(400).json({ message: '只能引用当前任务下的附件。' });
    }
  }

  if (!taskId && attachmentId) {
    return res.status(400).json({ message: '独立笔记暂不能引用任务附件。' });
  }

  const sortOrder = req.body.sortOrder === undefined
    ? Number(existing.sort_order || 0)
    : Number(req.body.sortOrder || 0);
  const contentJson = normalizeContentJson(req.body.contentJson, existing.content_json);
  const changeSource = normalizeNoteVersionSource(req.body.changeSource);
  const changeNote = req.body.changeNote || (changeSource === 'ai_format' ? 'AI 整理' : '');

  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE task_notes SET task_id = ?, title = ?, category = ?, content = ?, content_json = ?, attachment_id = ?, sort_order = ? WHERE id = ?',
      [taskId, title, category ? category.slice(0, 60) : null, content, contentJson, attachmentId, sortOrder, noteId],
    );
    const [updatedRows] = await connection.query('SELECT * FROM task_notes WHERE id = ? AND deleted_at IS NULL', [noteId]);
    await createNoteVersion(connection, noteId, existing, updatedRows[0], changeSource, changeNote);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await getPool().query(`${noteSelectSql} WHERE n.id = ? AND n.deleted_at IS NULL`, [noteId]);
  const [note] = await mapNotesWithAttachments(rows);
  res.json(note);
}));

app.delete('/api/notes/:id', asyncRoute(async (req, res) => {
  const noteId = Number(req.params.id);
  const reason = toNullableText(req.body?.reason) || '用户删除笔记';
  const [result] = await getPool().query(
    'UPDATE task_notes SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL',
    [reason.slice(0, 255), noteId],
  );
  if (!result.affectedRows) {
    return res.status(404).json({ message: '笔记不存在。' });
  }
  scheduleIndexJob({
    targetType: 'notes',
    targetId: noteId,
    operation: 'delete',
    reason: 'DELETE /notes/:id moved to trash',
  });
  res.locals.auditTarget = { targetType: 'notes', targetId: String(noteId) };
  res.status(204).end();
}));

app.post('/api/notes/:id/attachments',
  asyncRoute(async (req, res, next) => {
    if (!(await noteExists(req.params.id))) {
      return res.status(404).json({ message: '笔记不存在。' });
    }
    next();
  }),
  noteUpload.array('files', 10),
  asyncRoute(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: '请选择要上传的文件。' });
    }

    const note = toNullableText(req.body.note);
    const values = await Promise.all(
      files.map((file) => createUploadedAttachmentValues(req.params.id, file, 'note-attachments', note)),
    );

    await getPool().query(
      `
        INSERT INTO note_attachments
          (note_id, original_name, stored_name, relative_path, storage_provider, storage_key, mime_type, file_size, note)
        VALUES ?
      `,
      [values],
    );

    const attachments = await getNoteAttachmentRowsByNoteIds([Number(req.params.id)]);
    await beginAttachmentTextExtraction('note', attachments);
    attachments.forEach((attachment) => {
      scheduleIndexJob({
        targetType: 'note-attachments',
        targetId: attachment.id,
        operation: 'upsert',
        reason: 'POST /notes/:id/attachments',
      });
    });
    const refreshed = await getNoteAttachmentRowsByNoteIds([Number(req.params.id)]);
    res.status(201).json(refreshed.map(mapNoteAttachment));
  }),
);

app.delete('/api/note-attachments/:id', asyncRoute(async (req, res) => {
  const attachment = await softDeleteAttachment(
    'note',
    req.params.id,
    toNullableText(req.body?.reason) || '用户删除笔记附件',
  );
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  res.locals.auditTarget = { targetType: 'notes', targetId: String(attachment.note_id) };
  res.status(204).end();
}));

app.get('/api/note-attachments/:id/preview', asyncRoute(async (req, res) => {
  const attachment = await getNoteAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  if (!isPreviewableImage(attachment)) {
    return res.status(400).json({ message: '该附件不支持图片预览。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'inline' });
}));

app.get('/api/note-attachments/:id/download', asyncRoute(async (req, res) => {
  const attachment = await getNoteAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'attachment' });
}));

app.get('/api/tasks/:id/attachments', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const attachments = await getTaskAttachmentRows(taskId);
  res.json(attachments.map(mapTaskAttachment));
}));

app.post('/api/tasks/:id/attachments',
  asyncRoute(async (req, res, next) => {
    if (!(await taskExists(req.params.id))) {
      return res.status(404).json({ message: '任务不存在。' });
    }
    next();
  }),
  taskUpload.array('files', 10),
  asyncRoute(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: '请选择要上传的文件。' });
    }

    const note = toNullableText(req.body.note);
    const values = await Promise.all(
      files.map((file) => createUploadedAttachmentValues(req.params.id, file, 'task-attachments', note)),
    );

    await getPool().query(
      `
        INSERT INTO task_attachments
          (task_id, original_name, stored_name, relative_path, storage_provider, storage_key, mime_type, file_size, note)
        VALUES ?
      `,
      [values],
    );

    const attachments = await getTaskAttachmentRows(Number(req.params.id));
    await beginAttachmentTextExtraction('task', attachments);
    attachments.forEach((attachment) => {
      scheduleIndexJob({
        targetType: 'task-attachments',
        targetId: attachment.id,
        operation: 'upsert',
        reason: 'POST /tasks/:id/attachments',
      });
    });
    const refreshed = await getTaskAttachmentRows(Number(req.params.id));
    res.status(201).json(refreshed.map(mapTaskAttachment));
  }),
);

app.delete('/api/task-attachments/:id', asyncRoute(async (req, res) => {
  const attachment = await softDeleteAttachment(
    'task',
    req.params.id,
    toNullableText(req.body?.reason) || '用户删除任务附件',
  );
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  res.locals.auditTarget = { targetType: 'tasks', targetId: String(attachment.task_id) };
  res.status(204).end();
}));

app.get('/api/task-attachments/:id/preview', asyncRoute(async (req, res) => {
  const attachment = await getTaskAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  if (!isPreviewableImage(attachment)) {
    return res.status(400).json({ message: '该附件不支持图片预览。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'inline' });
}));

app.get('/api/task-attachments/:id/download', asyncRoute(async (req, res) => {
  const attachment = await getTaskAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'attachment' });
}));

app.get('/api/tasks/:id/logs', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  if (!(await taskExists(taskId))) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const where = ['l.task_id = ?', 'l.deleted_at IS NULL'];
  const params = [taskId];
  const search = toNullableText(req.query.search);
  const from = toDateOrNull(req.query.from);
  const to = toDateOrNull(req.query.to);
  const stage = STATUSES.includes(req.query.stage) ? req.query.stage : null;
  const minHours = req.query.minHours === undefined || req.query.minHours === ''
    ? null
    : toHours(req.query.minHours);
  const maxHours = req.query.maxHours === undefined || req.query.maxHours === ''
    ? null
    : toHours(req.query.maxHours);

  if (search) {
    where.push('(l.content LIKE ? OR l.next_step LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (from) {
    where.push('l.log_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('l.log_date <= ?');
    params.push(to);
  }
  if (stage) {
    where.push('l.stage = ?');
    params.push(stage);
  }
  if (minHours !== null) {
    where.push('l.hours >= ?');
    params.push(minHours);
  }
  if (maxHours !== null) {
    where.push('l.hours <= ?');
    params.push(maxHours);
  }

  const [rows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.log_date DESC, l.id DESC
    `,
    params,
  );
  const logs = rows.map(mapLog);
  const attachments = await getAttachmentRowsByLogIds(logs.map((log) => log.id));
  const attachmentsByLog = new Map();
  for (const attachment of attachments.map(mapAttachment)) {
    const current = attachmentsByLog.get(attachment.logId) || [];
    current.push(attachment);
    attachmentsByLog.set(attachment.logId, current);
  }
  res.json(logs.map((log) => ({
    ...log,
    attachments: attachmentsByLog.get(log.id) || [],
  })));
}));

app.get('/api/workbench', asyncRoute(async (req, res) => {
  const from = toDateOrNull(req.query.from) || toToday();
  const to = toDateOrNull(req.query.to) || from;

  const [todoRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status = 'todo' AND deleted_at IS NULL
      ORDER BY due_date IS NULL, due_date ASC, updated_at DESC
      LIMIT 12
    `,
  );

  const [inProgressRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status = 'in_progress' AND deleted_at IS NULL
      ORDER BY updated_at DESC, due_date IS NULL, due_date ASC
      LIMIT 12
    `,
  );

  const [dueRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status <> 'done' AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date <= ?
      ORDER BY due_date ASC, FIELD(status, 'in_progress', 'todo'), updated_at DESC
      LIMIT 12
    `,
    [to],
  );

  const [activeRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status <> 'done' AND deleted_at IS NULL
      ORDER BY FIELD(status, 'in_progress', 'todo'), due_date IS NULL, due_date ASC, updated_at DESC
      LIMIT 18
    `,
  );

  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title, t.status AS task_status, t.priority AS task_priority
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.log_date BETWEEN ? AND ?
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT 20
    `,
    [from, to],
  );

  const [noteRows] = await getPool().query(
    `
      ${noteSelectSql}
      WHERE n.deleted_at IS NULL AND (n.task_id IS NULL OR tn.deleted_at IS NULL)
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT 10
    `,
  );

  const [logAttachmentRows] = await getPool().query(
    `
      SELECT
        a.*,
        ${attachmentTextSelectSql},
        l.task_id AS related_task_id,
        l.log_date AS source_date,
        t.title AS task_title
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      JOIN tasks t ON t.id = l.task_id
      ${attachmentTextJoinSql('log')}
      WHERE a.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND DATE(a.created_at) BETWEEN ? AND ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 10
    `,
    [from, to],
  );

  const [noteAttachmentRows] = await getPool().query(
    `
      SELECT
        a.*,
        ${attachmentTextSelectSql},
        n.title AS note_title,
        n.category AS note_category,
        n.task_id AS related_task_id
      FROM note_attachments a
      JOIN task_notes n ON n.id = a.note_id
      ${attachmentTextJoinSql('note')}
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE a.deleted_at IS NULL AND n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL) AND DATE(a.created_at) BETWEEN ? AND ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 10
    `,
    [from, to],
  );

  const [taskAttachmentRows] = await getPool().query(
    `
      SELECT
        a.*,
        ${attachmentTextSelectSql},
        t.title AS task_title,
        t.status AS task_status
      FROM task_attachments a
      JOIN tasks t ON t.id = a.task_id
      ${attachmentTextJoinSql('task')}
      WHERE a.deleted_at IS NULL AND t.deleted_at IS NULL AND DATE(a.created_at) BETWEEN ? AND ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 10
    `,
    [from, to],
  );

  const logs = logRows.map(mapLog);
  const totalHours = logs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const recentNotes = await mapNotesWithAttachments(noteRows);
  const attachments = [
    ...taskAttachmentRows.map((row) => ({
      kind: 'task',
      sourceLabel: '任务附件',
      sourceTitle: row.task_title,
      taskId: Number(row.task_id),
      taskTitle: row.task_title,
      attachment: mapTaskAttachment(row),
    })),
    ...logAttachmentRows.map((row) => ({
      kind: 'log',
      sourceLabel: '日志附件',
      sourceTitle: row.task_title,
      taskId: Number(row.related_task_id),
      taskTitle: row.task_title,
      sourceDate: row.source_date,
      attachment: mapAttachment(row),
    })),
    ...noteAttachmentRows.map((row) => ({
      kind: 'note',
      sourceLabel: row.related_task_id ? '任务笔记附件' : '独立笔记附件',
      sourceTitle: row.note_title || '未命名笔记',
      taskId: row.related_task_id ? Number(row.related_task_id) : null,
      noteId: Number(row.note_id),
      noteCategory: row.note_category || '',
      attachment: mapNoteAttachment(row),
    })),
  ]
    .sort((left, right) => String(right.attachment.createdAt || '').localeCompare(String(left.attachment.createdAt || '')))
    .slice(0, 16);

  res.json({
    from,
    to,
    metrics: {
      activeTasks: activeRows.length,
      todoTasks: todoRows.length,
      inProgressTasks: inProgressRows.length,
      dueTasks: dueRows.length,
      logs: logs.length,
      totalHours: Math.round(totalHours * 100) / 100,
      attachments: attachments.length,
      recentNotes: recentNotes.length,
    },
    todoTasks: todoRows.map(mapTask),
    inProgressTasks: inProgressRows.map(mapTask),
    dueTasks: dueRows.map(mapTask),
    activeTasks: activeRows.map(mapTask),
    logs,
    recentNotes,
    attachments,
  });
}));

app.post('/api/tasks/:id/logs', asyncRoute(async (req, res) => {
  const taskId = Number(req.params.id);
  const [taskRows] = await getPool().query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [taskId]);
  if (!taskRows.length) {
    return res.status(404).json({ message: '任务不存在。' });
  }

  const content = toNullableText(req.body.content);
  if (!content) {
    return res.status(400).json({ message: '日志内容不能为空。' });
  }

  const [result] = await getPool().query(
    `
      INSERT INTO work_logs
        (task_id, stage, log_date, content, hours, progress_snapshot, next_step)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      taskId,
      toStatus(req.body.stage, taskRows[0].status),
      toDateOrNull(req.body.logDate) || toToday(),
      content,
      toHours(req.body.hours),
      req.body.progressSnapshot === undefined
        ? Number(taskRows[0].progress)
        : toProgress(req.body.progressSnapshot, Number(taskRows[0].progress)),
      toNullableText(req.body.nextStep),
    ],
  );

  const [rows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.id = ?
    `,
    [result.insertId],
  );
  res.locals.auditTarget = { targetType: 'logs', targetId: String(result.insertId) };
  res.status(201).json(mapLog(rows[0]));
}));

app.get('/api/logs/:id/versions', asyncRoute(async (req, res) => {
  const logId = Number(req.params.id);
  const [logRows] = await getPool().query('SELECT id FROM work_logs WHERE id = ? AND deleted_at IS NULL', [logId]);
  if (!logRows.length) {
    return res.status(404).json({ message: '日志不存在。' });
  }

  const [rows] = await getPool().query(
    `
      SELECT *
      FROM log_versions
      WHERE log_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 80
    `,
    [logId],
  );
  res.json(rows.map(mapLogVersion));
}));

app.patch('/api/logs/:id', asyncRoute(async (req, res) => {
  const logId = Number(req.params.id);
  const [existingRows] = await getPool().query('SELECT * FROM work_logs WHERE id = ? AND deleted_at IS NULL', [logId]);
  if (!existingRows.length) {
    return res.status(404).json({ message: '日志不存在。' });
  }
  const existing = existingRows[0];

  const content = req.body.content === undefined
    ? existing.content
    : toNullableText(req.body.content);
  if (!content) {
    return res.status(400).json({ message: '日志内容不能为空。' });
  }

  const stage = req.body.stage === undefined
    ? existing.stage
    : toStatus(req.body.stage, existing.stage);
  const logDate = req.body.logDate === undefined
    ? existing.log_date
    : (toDateOrNull(req.body.logDate) || existing.log_date);
  const hours = req.body.hours === undefined
    ? Number(existing.hours)
    : toHours(req.body.hours);
  const progressSnapshot = req.body.progressSnapshot === undefined
    ? Number(existing.progress_snapshot)
    : toProgress(req.body.progressSnapshot, Number(existing.progress_snapshot));
  const nextStep = req.body.nextStep === undefined
    ? existing.next_step
    : toNullableText(req.body.nextStep);

  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `
        UPDATE work_logs
        SET stage = ?, log_date = ?, content = ?, hours = ?, progress_snapshot = ?, next_step = ?
        WHERE id = ?
      `,
      [stage, logDate, content, hours, progressSnapshot, nextStep, logId],
    );
    const [updatedRows] = await connection.query('SELECT * FROM work_logs WHERE id = ? AND deleted_at IS NULL', [logId]);
    await createLogVersion(connection, logId, existing, updatedRows[0], 'manual', req.body.changeNote || '');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.id = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
    [logId],
  );
  res.json(mapLog(rows[0]));
}));

app.delete('/api/logs/:id', asyncRoute(async (req, res) => {
  const logId = Number(req.params.id);
  const reason = toNullableText(req.body?.reason) || '用户删除日志';
  const [result] = await getPool().query(
    'UPDATE work_logs SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL',
    [reason.slice(0, 255), logId],
  );
  if (!result.affectedRows) {
    return res.status(404).json({ message: '日志不存在。' });
  }
  scheduleIndexJob({
    targetType: 'logs',
    targetId: logId,
    operation: 'delete',
    reason: 'DELETE /logs/:id moved to trash',
  });
  res.locals.auditTarget = { targetType: 'logs', targetId: String(logId) };
  res.status(204).end();
}));

app.get('/api/attachment-center', asyncRoute(async (req, res) => {
  const kind = ['task', 'log', 'note', 'all'].includes(req.query.kind) ? req.query.kind : 'all';
  const search = toNullableText(req.query.search);
  const taskId = Number(req.query.taskId);
  const filterTaskId = Number.isInteger(taskId) && taskId > 0 ? taskId : null;
  const fileType = ['all', 'image', 'pdf', 'document', 'spreadsheet', 'archive', 'other'].includes(req.query.fileType)
    ? req.query.fileType
    : 'all';
  const textStatus = ['all', 'none', 'pending', 'processing', 'completed', 'failed', 'unsupported'].includes(req.query.textStatus)
    ? req.query.textStatus
    : 'all';
  const from = toDateOrNull(req.query.from);
  const to = toDateOrNull(req.query.to);
  const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
  const items = [];

  const addDateFilters = (where, params) => {
    if (from) {
      where.push('DATE(a.created_at) >= ?');
      params.push(from);
    }
    if (to) {
      where.push('DATE(a.created_at) <= ?');
      params.push(to);
    }
  };

  if (kind === 'task' || kind === 'all') {
    const where = ['a.deleted_at IS NULL', 't.deleted_at IS NULL'];
    const params = [];
    addDateFilters(where, params);
    if (search) {
      where.push('(a.original_name LIKE ? OR a.note LIKE ? OR t.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filterTaskId) {
      where.push('a.task_id = ?');
      params.push(filterTaskId);
    }
    addAttachmentCenterFilters(where, params, { fileType, textStatus });
    const [rows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          t.id AS task_id,
          t.title AS task_title,
          t.title AS source_title
        FROM task_attachments a
        JOIN tasks t ON t.id = a.task_id
        ${attachmentTextJoinSql('task')}
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    items.push(...rows.map((row) => mapAttachmentCenterItem('task', row, mapTaskAttachment(row))));
  }

  if (kind === 'log' || kind === 'all') {
    const where = ['a.deleted_at IS NULL', 'l.deleted_at IS NULL', 't.deleted_at IS NULL'];
    const params = [];
    addDateFilters(where, params);
    if (search) {
      where.push('(a.original_name LIKE ? OR a.note LIKE ? OR l.content LIKE ? OR t.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filterTaskId) {
      where.push('l.task_id = ?');
      params.push(filterTaskId);
    }
    addAttachmentCenterFilters(where, params, { fileType, textStatus });
    const [rows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          l.id AS log_id,
          l.task_id AS task_id,
          l.log_date,
          l.content AS source_title,
          t.title AS task_title
        FROM log_attachments a
        JOIN work_logs l ON l.id = a.log_id
        JOIN tasks t ON t.id = l.task_id
        ${attachmentTextJoinSql('log')}
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    items.push(...rows.map((row) => mapAttachmentCenterItem('log', row, mapAttachment(row))));
  }

  if (kind === 'note' || kind === 'all') {
    const where = ['a.deleted_at IS NULL', 'n.deleted_at IS NULL', '(n.task_id IS NULL OR t.deleted_at IS NULL)'];
    const params = [];
    addDateFilters(where, params);
    if (search) {
      where.push('(a.original_name LIKE ? OR a.note LIKE ? OR n.title LIKE ? OR n.content LIKE ? OR n.category LIKE ? OR t.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filterTaskId) {
      where.push('n.task_id = ?');
      params.push(filterTaskId);
    }
    addAttachmentCenterFilters(where, params, { fileType, textStatus });
    const [rows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          n.id AS note_id,
          n.task_id AS task_id,
          n.title AS note_title,
          n.category AS note_category,
          n.title AS source_title,
          t.title AS task_title
        FROM note_attachments a
        JOIN task_notes n ON n.id = a.note_id
        LEFT JOIN tasks t ON t.id = n.task_id
        ${attachmentTextJoinSql('note')}
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    items.push(...rows.map((row) => mapAttachmentCenterItem('note', row, mapNoteAttachment(row))));
  }

  items.sort((left, right) => (
    String(right.createdAt || '').localeCompare(String(left.createdAt || '')) || right.id - left.id
  ));

  res.json({
    kind,
    search: search || '',
    taskId: filterTaskId || '',
    fileType,
    textStatus,
    from: from || '',
    to: to || '',
    total: items.length,
    imageTotal: items.filter((item) => item.attachment?.isImage).length,
    items: items.slice(0, limit),
  });
}));

app.patch('/api/attachment-center/trash', asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const reason = toNullableText(req.body?.reason) || '附件中心批量移入回收站';
  if (!items.length) {
    return res.status(400).json({ message: '请选择要移入回收站的附件。' });
  }
  if (items.length > 100) {
    return res.status(400).json({ message: '单次最多处理 100 个附件。' });
  }

  const moved = [];
  const missing = [];
  for (const item of items) {
    const kind = ['task', 'log', 'note'].includes(item?.kind) ? item.kind : '';
    const id = Number(item?.id);
    if (!kind || !Number.isInteger(id) || id <= 0) {
      missing.push(item);
      continue;
    }
    const attachment = await softDeleteAttachment(kind, id, reason);
    if (attachment) {
      moved.push({ kind, id });
    } else {
      missing.push({ kind, id });
    }
  }

  res.json({
    ok: true,
    requested: items.length,
    moved: moved.length,
    missing: missing.length,
    items: moved,
  });
}));

app.patch('/api/attachment-center/:kind/:id', asyncRoute(async (req, res) => {
  const kind = ['task', 'log', 'note'].includes(req.params.kind) ? req.params.kind : '';
  const id = Number(req.params.id);
  if (!kind || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '附件参数不正确。' });
  }
  const table = attachmentTable(kind);
  const attachment = kind === 'task'
    ? await getTaskAttachmentRow(id)
    : kind === 'note'
      ? await getNoteAttachmentRow(id)
      : await getAttachmentRow(id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }

  await getPool().query(`UPDATE ${table} SET note = ? WHERE id = ? AND deleted_at IS NULL`, [
    toNullableText(req.body?.note),
    id,
  ]);

  const updated = kind === 'task'
    ? await getTaskAttachmentRow(id)
    : kind === 'note'
      ? await getNoteAttachmentRow(id)
      : await getAttachmentRow(id);
  scheduleIndexJob({
    targetType: attachmentIndexTargetType(kind),
    targetId: id,
    operation: 'upsert',
    reason: 'PATCH /attachment-center/:kind/:id',
  });
  res.json({
    ok: true,
    kind,
    attachment: kind === 'task'
      ? mapTaskAttachment(updated)
      : kind === 'note'
        ? mapNoteAttachment(updated)
        : mapAttachment(updated),
  });
}));

app.post('/api/logs/:id/attachments',
  asyncRoute(async (req, res, next) => {
    const [rows] = await getPool().query('SELECT * FROM work_logs WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!rows.length) {
      return res.status(404).json({ message: '日志不存在。' });
    }
    next();
  }),
  upload.array('files', 10),
  asyncRoute(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: '请选择要上传的文件。' });
    }

    const note = toNullableText(req.body.note);
    const values = await Promise.all(
      files.map((file) => createUploadedAttachmentValues(req.params.id, file, 'log-attachments', note)),
    );

    await getPool().query(
      `
        INSERT INTO log_attachments
          (log_id, original_name, stored_name, relative_path, storage_provider, storage_key, mime_type, file_size, note)
        VALUES ?
      `,
      [values],
    );

    const attachments = await getAttachmentRowsByLogIds([Number(req.params.id)]);
    await beginAttachmentTextExtraction('log', attachments);
    attachments.forEach((attachment) => {
      scheduleIndexJob({
        targetType: 'log-attachments',
        targetId: attachment.id,
        operation: 'upsert',
        reason: 'POST /logs/:id/attachments',
      });
    });
    const refreshed = await getAttachmentRowsByLogIds([Number(req.params.id)]);
    res.status(201).json(refreshed.map(mapAttachment));
  }),
);

app.patch('/api/attachments/:id', asyncRoute(async (req, res) => {
  const attachment = await getAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }

  await getPool().query('UPDATE log_attachments SET note = ? WHERE id = ?', [
    toNullableText(req.body.note),
    Number(req.params.id),
  ]);
  const updated = await getAttachmentRow(req.params.id);
  scheduleIndexJob({
    targetType: 'log-attachments',
    targetId: updated.id,
    operation: 'upsert',
    reason: 'PATCH /attachments/:id',
  });
  res.locals.auditTarget = { targetType: 'logs', targetId: String(updated.log_id) };
  res.json(mapAttachment(updated));
}));

app.delete('/api/attachments/:id', asyncRoute(async (req, res) => {
  const attachment = await softDeleteAttachment(
    'log',
    req.params.id,
    toNullableText(req.body?.reason) || '用户删除日志附件',
  );
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  res.locals.auditTarget = { targetType: 'logs', targetId: String(attachment.log_id) };
  res.status(204).end();
}));

app.get('/api/attachments/:id/preview', asyncRoute(async (req, res) => {
  const attachment = await getAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }
  if (!isPreviewableImage(attachment)) {
    return res.status(400).json({ message: '该附件不支持图片预览。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'inline' });
}));

app.get('/api/attachments/:id/download', asyncRoute(async (req, res) => {
  const attachment = await getAttachmentRow(req.params.id);
  if (!attachment) {
    return res.status(404).json({ message: '附件不存在。' });
  }

  await sendStoredAttachment(res, attachment, { disposition: 'attachment' });
}));

app.get('/api/reports', asyncRoute(async (req, res) => {
  res.json(await getReportData({ from: req.query.from, to: req.query.to }));
}));

app.get('/api/trash', asyncRoute(async (req, res) => {
  const type = ['task', 'log', 'note', 'attachment', 'all'].includes(req.query.type) ? req.query.type : 'all';
  const payload = {};

  if (type === 'task' || type === 'all') {
    const [rows] = await getPool().query(
      `
        SELECT
          t.*,
          (SELECT COUNT(*) FROM work_logs l WHERE l.task_id = t.id AND l.deleted_at IS NULL) AS log_count,
          (SELECT COUNT(*) FROM task_notes n WHERE n.task_id = t.id AND n.deleted_at IS NULL) AS note_count,
          (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id AND a.deleted_at IS NULL) AS attachment_count
        FROM tasks t
        WHERE t.deleted_at IS NOT NULL
        ORDER BY t.deleted_at DESC, t.id DESC
        LIMIT 100
      `,
    );
    payload.tasks = rows.map(mapTrashTask);
  }

  if (type === 'log' || type === 'all') {
    const [rows] = await getPool().query(
      `
        SELECT l.*, t.title AS task_title, t.deleted_at AS task_deleted_at
        FROM work_logs l
        LEFT JOIN tasks t ON t.id = l.task_id
        WHERE l.deleted_at IS NOT NULL
        ORDER BY l.deleted_at DESC, l.id DESC
        LIMIT 100
      `,
    );
    payload.logs = rows.map(mapTrashLog);
  }

  if (type === 'note' || type === 'all') {
    const [rows] = await getPool().query(
      `
        SELECT n.*, t.title AS task_title, t.deleted_at AS task_deleted_at
        FROM task_notes n
        LEFT JOIN tasks t ON t.id = n.task_id
        WHERE n.deleted_at IS NOT NULL
        ORDER BY n.deleted_at DESC, n.id DESC
        LIMIT 100
      `,
    );
    payload.notes = rows.map(mapTrashNote);
  }

  if (type === 'attachment' || type === 'all') {
    const attachments = [];
    const [taskRows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          t.id AS task_id,
          t.title AS task_title,
          t.title AS source_title,
          t.deleted_at AS task_deleted_at
        FROM task_attachments a
        LEFT JOIN tasks t ON t.id = a.task_id
        ${attachmentTextJoinSql('task')}
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC, a.id DESC
        LIMIT 100
      `,
    );
    attachments.push(...taskRows.map((row) => mapTrashAttachment('task', row, mapTaskAttachment(row))));

    const [logRows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          l.id AS log_id,
          l.task_id AS task_id,
          l.log_date,
          l.content AS source_title,
          l.deleted_at AS log_deleted_at,
          t.title AS task_title,
          t.deleted_at AS task_deleted_at
        FROM log_attachments a
        LEFT JOIN work_logs l ON l.id = a.log_id
        LEFT JOIN tasks t ON t.id = l.task_id
        ${attachmentTextJoinSql('log')}
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC, a.id DESC
        LIMIT 100
      `,
    );
    attachments.push(...logRows.map((row) => mapTrashAttachment('log', row, mapAttachment(row))));

    const [noteRows] = await getPool().query(
      `
        SELECT
          a.*,
          ${attachmentTextSelectSql},
          n.id AS note_id,
          n.task_id AS task_id,
          n.title AS note_title,
          n.category AS note_category,
          n.title AS source_title,
          n.deleted_at AS note_deleted_at,
          t.title AS task_title,
          t.deleted_at AS task_deleted_at
        FROM note_attachments a
        LEFT JOIN task_notes n ON n.id = a.note_id
        LEFT JOIN tasks t ON t.id = n.task_id
        ${attachmentTextJoinSql('note')}
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC, a.id DESC
        LIMIT 100
      `,
    );
    attachments.push(...noteRows.map((row) => mapTrashAttachment('note', row, mapNoteAttachment(row))));

    payload.attachments = attachments
      .sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')))
      .slice(0, 100);
  }

  res.json({
    type,
    tasks: payload.tasks || [],
    logs: payload.logs || [],
    notes: payload.notes || [],
    attachments: payload.attachments || [],
  });
}));

app.post('/api/trash/attachment/:kind/:id/restore', asyncRoute(async (req, res) => {
  const kind = ['task', 'log', 'note'].includes(req.params.kind) ? req.params.kind : '';
  const id = Number(req.params.id);
  if (!kind || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '附件回收站参数不正确。' });
  }

  if (kind === 'task') {
    const [rows] = await getPool().query(
      `
        SELECT a.id, t.id AS task_exists, t.deleted_at AS task_deleted_at
        FROM task_attachments a
        LEFT JOIN tasks t ON t.id = a.task_id
        WHERE a.id = ? AND a.deleted_at IS NOT NULL
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ message: '附件不在回收站中。' });
    if (!rows[0].task_exists) return res.status(409).json({ message: '所属任务不存在，无法恢复附件。' });
    if (rows[0].task_deleted_at) return res.status(409).json({ message: '请先恢复这个附件所属的任务。' });
    await getPool().query('UPDATE task_attachments SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
  } else if (kind === 'log') {
    const [rows] = await getPool().query(
      `
        SELECT
          a.id,
          l.id AS log_exists,
          l.deleted_at AS log_deleted_at,
          t.id AS task_exists,
          t.deleted_at AS task_deleted_at
        FROM log_attachments a
        LEFT JOIN work_logs l ON l.id = a.log_id
        LEFT JOIN tasks t ON t.id = l.task_id
        WHERE a.id = ? AND a.deleted_at IS NOT NULL
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ message: '附件不在回收站中。' });
    if (!rows[0].log_exists) return res.status(409).json({ message: '所属日志不存在，无法恢复附件。' });
    if (rows[0].log_deleted_at) return res.status(409).json({ message: '请先恢复这个附件所属的日志。' });
    if (!rows[0].task_exists) return res.status(409).json({ message: '所属任务不存在，无法恢复附件。' });
    if (rows[0].task_deleted_at) return res.status(409).json({ message: '请先恢复这个附件所属的任务。' });
    await getPool().query('UPDATE log_attachments SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
  } else {
    const [rows] = await getPool().query(
      `
        SELECT
          a.id,
          n.id AS note_exists,
          n.deleted_at AS note_deleted_at,
          t.id AS task_exists,
          t.deleted_at AS task_deleted_at
        FROM note_attachments a
        LEFT JOIN task_notes n ON n.id = a.note_id
        LEFT JOIN tasks t ON t.id = n.task_id
        WHERE a.id = ? AND a.deleted_at IS NOT NULL
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ message: '附件不在回收站中。' });
    if (!rows[0].note_exists) return res.status(409).json({ message: '所属笔记不存在，无法恢复附件。' });
    if (rows[0].note_deleted_at) return res.status(409).json({ message: '请先恢复这个附件所属的笔记。' });
    if (rows[0].task_exists && rows[0].task_deleted_at) {
      return res.status(409).json({ message: '请先恢复这个附件所属的任务。' });
    }
    await getPool().query('UPDATE note_attachments SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
  }

  scheduleIndexJob({
    targetType: attachmentIndexTargetType(kind),
    targetId: id,
    operation: 'upsert',
    reason: 'restore attachment from trash',
  });
  res.json({ ok: true, type: 'attachment', kind, id });
}));

app.delete('/api/trash/attachment/:kind/:id', asyncRoute(async (req, res) => {
  const kind = ['task', 'log', 'note'].includes(req.params.kind) ? req.params.kind : '';
  const id = Number(req.params.id);
  if (!kind || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '附件回收站参数不正确。' });
  }

  const deleted = await hardDeleteAttachment(kind, id);
  if (!deleted) return res.status(404).json({ message: '附件不在回收站中。' });
  scheduleIndexJob({
    targetType: attachmentIndexTargetType(kind),
    targetId: id,
    operation: 'delete',
    reason: 'permanent delete attachment from trash',
  });
  res.status(204).end();
}));

app.post('/api/trash/:type/:id/restore', asyncRoute(async (req, res) => {
  const type = req.params.type;
  const id = Number(req.params.id);
  if (!['task', 'log', 'note'].includes(type) || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '回收站项目参数不正确。' });
  }

  if (type === 'task') {
    const [result] = await getPool().query(
      'UPDATE tasks SET deleted_at = NULL, deleted_reason = NULL WHERE id = ? AND deleted_at IS NOT NULL',
      [id],
    );
    if (!result.affectedRows) return res.status(404).json({ message: '任务不在回收站中。' });
    scheduleIndexJob({ targetType: 'tasks', targetId: id, operation: 'upsert', reason: 'restore task from trash' });
    res.json({ ok: true, type, id });
    return;
  }

  if (type === 'log') {
    const [rows] = await getPool().query(
      `
        SELECT l.id, t.deleted_at AS task_deleted_at
        FROM work_logs l
        LEFT JOIN tasks t ON t.id = l.task_id
        WHERE l.id = ? AND l.deleted_at IS NOT NULL
      `,
      [id],
    );
    if (!rows.length) return res.status(404).json({ message: '日志不在回收站中。' });
    if (rows[0].task_deleted_at) {
      return res.status(409).json({ message: '请先恢复这条日志所属的任务。' });
    }
    await getPool().query('UPDATE work_logs SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
    scheduleIndexJob({ targetType: 'logs', targetId: id, operation: 'upsert', reason: 'restore log from trash' });
    res.json({ ok: true, type, id });
    return;
  }

  const [rows] = await getPool().query(
    `
      SELECT n.id, t.deleted_at AS task_deleted_at
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.id = ? AND n.deleted_at IS NOT NULL
    `,
    [id],
  );
  if (!rows.length) return res.status(404).json({ message: '笔记不在回收站中。' });
  if (rows[0].task_deleted_at) {
    return res.status(409).json({ message: '请先恢复这条笔记所属的任务。' });
  }
  await getPool().query('UPDATE task_notes SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?', [id]);
  scheduleIndexJob({ targetType: 'notes', targetId: id, operation: 'upsert', reason: 'restore note from trash' });
  res.json({ ok: true, type, id });
}));

app.delete('/api/trash/:type/:id', asyncRoute(async (req, res) => {
  const type = req.params.type;
  const id = Number(req.params.id);
  if (!['task', 'log', 'note'].includes(type) || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '回收站项目参数不正确。' });
  }

  let deleted = false;
  if (type === 'task') {
    deleted = await hardDeleteTask(id);
    if (deleted) scheduleIndexJob({ targetType: 'tasks', targetId: id, operation: 'delete', reason: 'permanent delete task from trash' });
  } else if (type === 'log') {
    deleted = await hardDeleteLog(id);
    if (deleted) scheduleIndexJob({ targetType: 'logs', targetId: id, operation: 'delete', reason: 'permanent delete log from trash' });
  } else {
    deleted = await hardDeleteNote(id);
    if (deleted) scheduleIndexJob({ targetType: 'notes', targetId: id, operation: 'delete', reason: 'permanent delete note from trash' });
  }

  if (!deleted) return res.status(404).json({ message: '回收站项目不存在。' });
  res.status(204).end();
}));

app.get('/api/exports/workspace', asyncRoute(async (req, res) => {
  const format = String(req.query.format || 'markdown').toLowerCase();
  const data = await getWorkspaceExportData({ from: req.query.from, to: req.query.to });

  if (format === 'markdown' || format === 'md') {
    const filename = workspaceExportFileName(data, 'md');
    res.type('text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', downloadContentDisposition(filename));
    res.send(createMarkdownExport(data));
    return;
  }

  if (format === 'excel' || format === 'xlsx') {
    const filename = workspaceExportFileName(data, 'xlsx');
    const buffer = await createExcelExport(data);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', downloadContentDisposition(filename));
    res.send(Buffer.from(buffer));
    return;
  }

  if (format === 'pdf') {
    const filename = workspaceExportFileName(data, 'pdf');
    const buffer = await createPdfExport(data);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', downloadContentDisposition(filename));
    res.send(Buffer.from(buffer));
    return;
  }

  res.status(400).json({ message: '导出格式仅支持 Markdown、Excel 或 PDF。' });
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在。' });
});

app.use(express.static(distPath, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? '单个文件不能超过 50MB。'
      : '文件上传失败，请检查文件数量和大小。';
    return res.status(400).json({ message });
  }
  if (err?.message?.includes('仅支持')) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

app.use((err, _req, res, _next) => {
  const statusCode = Number(err?.statusCode || err?.status || 0);
  if (statusCode >= 400 && statusCode < 600) {
    res.status(statusCode).json({ message: err.message || '请求处理失败。' });
    return;
  }
  console.error(err);
  res.status(500).json({ message: '服务器处理失败，请查看终端日志。' });
});

ensureDatabase()
  .then(async () => {
    await initializeAuth();
    await initializeStorage();
    await repairAttachmentFileNames();
    await initializeWeixinService();
    app.listen(config.port, () => {
      console.log(`API server ready at http://127.0.0.1:${config.port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdownWeixinService()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}
