export const STATUSES = ['todo', 'in_progress', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];

export function toNullableText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function toDateOrNull(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function toProgress(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function toHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(999.99, Math.round(number * 100) / 100));
}

export function toPriority(value, fallback = 'medium') {
  return PRIORITIES.includes(value) ? value : fallback;
}

export function toStatus(value, fallback = 'todo') {
  return STATUSES.includes(value) ? value : fallback;
}

export function toTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean).join(',');
  }
  return toNullableText(value);
}

export function toToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function mapTask(row) {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description || '',
    priority: row.priority,
    dueDate: row.due_date,
    progress: Number(row.progress),
    status: row.status,
    tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestLog: row.latest_log_content
      ? {
          content: row.latest_log_content,
          logDate: row.latest_log_date,
          hours: Number(row.latest_log_hours || 0),
        }
      : null,
    deletedAt: row.deleted_at || null,
    deletedReason: row.deleted_reason || '',
  };
}

export function mapLog(row) {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    taskTitle: row.task_title,
    stage: row.stage || 'in_progress',
    logDate: row.log_date,
    content: row.content,
    hours: Number(row.hours || 0),
    progressSnapshot: Number(row.progress_snapshot),
    nextStep: row.next_step || '',
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
    deletedReason: row.deleted_reason || '',
    attachments: [],
  };
}

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapBaseAttachment(row, { ownerKey, previewBase, downloadBase }) {
  const mimeType = row.mime_type || 'application/octet-stream';
  const mapped = {
    id: Number(row.id),
    originalName: row.original_name,
    storedName: row.stored_name,
    mimeType,
    fileSize: Number(row.file_size || 0),
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    deletedReason: row.deleted_reason || '',
    isImage: mimeType.startsWith('image/'),
    previewUrl: mimeType.startsWith('image/') ? `${previewBase}/${row.id}/preview` : null,
    downloadUrl: `${downloadBase}/${row.id}/download`,
    textStatus: row.text_status || null,
    textParser: row.text_parser || null,
    textChars: Number(row.text_chars || 0),
    textUpdatedAt: row.text_updated_at || null,
    textError: row.text_error || '',
    textTruncated: Boolean(row.text_truncated),
  };

  if (ownerKey && row[ownerKey] !== undefined && row[ownerKey] !== null) {
    mapped[ownerKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = Number(row[ownerKey]);
  }
  return mapped;
}

export function mapAttachment(row) {
  return {
    ...mapBaseAttachment(row, {
      ownerKey: 'log_id',
      previewBase: '/api/attachments',
      downloadBase: '/api/attachments',
    }),
    logId: Number(row.log_id),
  };
}

export function mapNoteAttachment(row) {
  return {
    ...mapBaseAttachment(row, {
      ownerKey: 'note_id',
      previewBase: '/api/note-attachments',
      downloadBase: '/api/note-attachments',
    }),
    noteId: Number(row.note_id),
  };
}

export function mapTaskAttachment(row) {
  return {
    ...mapBaseAttachment(row, {
      ownerKey: 'task_id',
      previewBase: '/api/task-attachments',
      downloadBase: '/api/task-attachments',
    }),
    taskId: Number(row.task_id),
  };
}

export function mapNote(row) {
  const attachment = row.attachment_id
    ? mapAttachment({
        id: row.attachment_id,
        log_id: row.attachment_log_id,
        original_name: row.attachment_original_name,
        stored_name: row.attachment_stored_name,
        mime_type: row.attachment_mime_type,
        file_size: row.attachment_file_size,
        note: row.attachment_note,
        created_at: row.attachment_created_at,
        updated_at: row.attachment_updated_at,
      })
    : null;

  return {
    id: Number(row.id),
    taskId: row.task_id ? Number(row.task_id) : null,
    taskTitle: row.task_title || '',
    taskStatus: row.task_status || '',
    taskPriority: row.task_priority || '',
    attachmentId: row.attachment_id ? Number(row.attachment_id) : null,
    title: row.title || '未命名笔记',
    category: row.category,
    content: row.content,
    contentJson: parseJsonField(row.content_json),
    sortOrder: Number(row.sort_order || 0),
    aiVisibility: row.ai_visibility || 'inherit',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    deletedReason: row.deleted_reason || '',
    attachment,
    attachments: [],
  };
}
