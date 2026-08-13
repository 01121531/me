import { getPool } from '../db.js';
import { searchWorkspace as semanticSearchWorkspace } from '../ai/search.js';
import {
  mapAttachment,
  mapLog,
  mapNote,
  mapNoteAttachment,
  mapTask,
  mapTaskAttachment,
  PRIORITIES,
  STATUSES,
  toDateOrNull,
  toNullableText,
  toToday,
} from '../validators.js';

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
  LEFT JOIN log_attachments a ON a.id = n.attachment_id AND a.deleted_at IS NULL
  LEFT JOIN tasks tn ON tn.id = n.task_id
`;

function normalizeLimit(value, fallback = 30, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.round(number)));
}

function normalizeTaskId(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function like(value) {
  return `%${value}%`;
}

async function getTaskRow(taskId) {
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
      WHERE t.id = ? AND t.deleted_at IS NULL
      LIMIT 1
    `,
    [taskId],
  );
  return rows[0] || null;
}

async function mapNotesWithAttachments(rows) {
  const notes = rows.map(mapNote);
  if (!notes.length) return notes;

  const [attachments] = await getPool().query(
    `
      SELECT *
      FROM note_attachments
      WHERE deleted_at IS NULL AND note_id IN (${notes.map(() => '?').join(',')})
      ORDER BY created_at ASC, id ASC
    `,
    notes.map((note) => note.id),
  );
  const byNote = new Map();
  for (const attachment of attachments.map(mapNoteAttachment)) {
    const current = byNote.get(attachment.noteId) || [];
    current.push(attachment);
    byNote.set(attachment.noteId, current);
  }
  return notes.map((note) => ({
    ...note,
    attachments: byNote.get(note.id) || [],
  }));
}

async function mapLogsWithAttachments(rows) {
  const logs = rows.map(mapLog);
  if (!logs.length) return logs;

  const [attachments] = await getPool().query(
    `
      SELECT *
      FROM log_attachments
      WHERE deleted_at IS NULL AND log_id IN (${logs.map(() => '?').join(',')})
      ORDER BY created_at ASC, id ASC
    `,
    logs.map((log) => log.id),
  );
  const byLog = new Map();
  for (const attachment of attachments.map(mapAttachment)) {
    const current = byLog.get(attachment.logId) || [];
    current.push(attachment);
    byLog.set(attachment.logId, current);
  }
  return logs.map((log) => ({
    ...log,
    attachments: byLog.get(log.id) || [],
  }));
}

export async function listTasks(options = {}) {
  const where = ['t.deleted_at IS NULL'];
  const params = [];
  const status = STATUSES.includes(options.status) ? options.status : null;
  const priority = PRIORITIES.includes(options.priority) ? options.priority : null;
  const tag = toNullableText(options.tag);
  const search = toNullableText(options.search);
  const dueFrom = toDateOrNull(options.dueFrom);
  const dueTo = toDateOrNull(options.dueTo);
  const limit = normalizeLimit(options.limit, 50, 200);

  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (priority) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (tag) {
    where.push('t.tags LIKE ?');
    params.push(like(tag));
  }
  if (search) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)');
    params.push(like(search), like(search), like(search));
  }
  if (dueFrom) {
    where.push('t.due_date >= ?');
    params.push(dueFrom);
  }
  if (dueTo) {
    where.push('t.due_date <= ?');
    params.push(dueTo);
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
      LIMIT ?
    `,
    [...params, limit],
  );

  return {
    tasks: rows.map(mapTask),
    count: rows.length,
    filters: { status, priority, tag, search, dueFrom, dueTo },
  };
}

export async function getTask(taskId) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) throw new Error('taskId must be a positive integer.');

  const row = await getTaskRow(normalizedTaskId);
  if (!row) throw new Error(`Task ${normalizedTaskId} was not found.`);

  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.task_id = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT 8
    `,
    [normalizedTaskId],
  );
  const [noteRows] = await getPool().query(
    `
      ${noteSelectSql}
      WHERE n.task_id = ? AND n.deleted_at IS NULL
      ORDER BY n.sort_order ASC, n.updated_at DESC, n.id DESC
      LIMIT 8
    `,
    [normalizedTaskId],
  );
  const [taskAttachmentRows] = await getPool().query(
    `
      SELECT *
      FROM task_attachments
      WHERE deleted_at IS NULL AND task_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `,
    [normalizedTaskId],
  );
  const [[counts]] = await getPool().query(
    `
      SELECT
        (SELECT COUNT(*) FROM work_logs WHERE task_id = ? AND deleted_at IS NULL) AS log_count,
        (SELECT COUNT(*) FROM task_notes WHERE task_id = ? AND deleted_at IS NULL) AS note_count,
        (SELECT COUNT(*) FROM task_attachments WHERE task_id = ? AND deleted_at IS NULL) AS task_attachment_count
    `,
    [normalizedTaskId, normalizedTaskId, normalizedTaskId],
  );

  return {
    task: mapTask(row),
    recentLogs: await mapLogsWithAttachments(logRows),
    notes: await mapNotesWithAttachments(noteRows),
    taskAttachments: taskAttachmentRows.map(mapTaskAttachment),
    counts: {
      logs: Number(counts.log_count || 0),
      notes: Number(counts.note_count || 0),
      taskAttachments: Number(counts.task_attachment_count || 0),
    },
  };
}

export async function getTaskTimeline(options = {}) {
  const taskId = normalizeTaskId(options.taskId);
  if (!taskId) throw new Error('taskId must be a positive integer.');
  const task = await getTaskRow(taskId);
  if (!task) throw new Error(`Task ${taskId} was not found.`);

  const where = ['l.task_id = ?', 'l.deleted_at IS NULL'];
  const params = [taskId];
  const search = toNullableText(options.search);
  const from = toDateOrNull(options.from);
  const to = toDateOrNull(options.to);
  const stage = STATUSES.includes(options.stage) ? options.stage : null;
  const limit = normalizeLimit(options.limit, 50, 200);

  if (search) {
    where.push('(l.content LIKE ? OR l.next_step LIKE ?)');
    params.push(like(search), like(search));
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

  const [rows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE t.deleted_at IS NULL AND ${where.join(' AND ')}
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT ?
    `,
    [...params, limit],
  );
  const logs = await mapLogsWithAttachments(rows);
  const totalHours = logs.reduce((sum, log) => sum + log.hours, 0);

  return {
    task: mapTask(task),
    logs,
    summary: {
      count: logs.length,
      totalHours: Math.round(totalHours * 100) / 100,
    },
    filters: { search, from, to, stage },
  };
}

export async function searchNotes(options = {}) {
  const query = toNullableText(options.query);
  const category = toNullableText(options.category);
  const taskId = normalizeTaskId(options.taskId);
  const scope = ['all', 'independent', 'task'].includes(options.scope) ? options.scope : 'all';
  const limit = normalizeLimit(options.limit, 30, 100);
  const where = ['n.deleted_at IS NULL', '(n.task_id IS NULL OR tn.deleted_at IS NULL)'];
  const params = [];

  if (taskId) {
    where.push('n.task_id = ?');
    params.push(taskId);
  } else if (scope === 'independent') {
    where.push('n.task_id IS NULL');
  } else if (scope === 'task') {
    where.push('n.task_id IS NOT NULL');
  }
  if (query) {
    where.push('(n.title LIKE ? OR n.content LIKE ? OR n.category LIKE ? OR a.original_name LIKE ? OR a.note LIKE ?)');
    params.push(like(query), like(query), like(query), like(query), like(query));
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
      LIMIT ?
    `,
    [...params, limit],
  );

  return {
    notes: await mapNotesWithAttachments(rows),
    count: rows.length,
    filters: { query, category, taskId, scope: taskId ? 'task' : scope },
  };
}

export async function generateReport(options = {}) {
  const from = toDateOrNull(options.from) || toToday();
  const to = toDateOrNull(options.to) || from;

  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title, t.status AS task_status, t.priority AS task_priority
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.log_date BETWEEN ? AND ?
      ORDER BY l.log_date DESC, l.id DESC
    `,
    [from, to],
  );
  const [activeRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status <> 'done' AND deleted_at IS NULL
      ORDER BY FIELD(status, 'in_progress', 'todo'), due_date IS NULL, due_date ASC, updated_at DESC
    `,
  );
  const [completedRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE status = 'done' AND deleted_at IS NULL AND DATE(updated_at) BETWEEN ? AND ?
      ORDER BY updated_at DESC
    `,
    [from, to],
  );

  const logs = logRows.map(mapLog);
  const totalHours = logs.reduce((sum, log) => sum + log.hours, 0);
  const taskMap = new Map();
  for (const log of logs) {
    const item = taskMap.get(log.taskId) || {
      taskId: log.taskId,
      title: log.taskTitle,
      hours: 0,
      entries: 0,
    };
    item.hours += log.hours;
    item.entries += 1;
    taskMap.set(log.taskId, item);
  }

  return {
    from,
    to,
    totalHours: Math.round(totalHours * 100) / 100,
    logs,
    byTask: Array.from(taskMap.values()).map((item) => ({
      ...item,
      hours: Math.round(item.hours * 100) / 100,
    })),
    activeTasks: activeRows.map(mapTask),
    completedTasks: completedRows.map(mapTask),
    nextSteps: logs.filter((log) => log.nextStep),
  };
}

function attachmentItem(kind, attachment) {
  return {
    kind,
    ...attachment,
    previewPath: attachment.previewUrl,
    downloadPath: attachment.downloadUrl,
  };
}

export async function listAttachments(options = {}) {
  const kind = ['task', 'log', 'note', 'all'].includes(options.kind) ? options.kind : 'all';
  const taskId = normalizeTaskId(options.taskId);
  const logId = normalizeTaskId(options.logId);
  const noteId = normalizeTaskId(options.noteId);
  const limit = normalizeLimit(options.limit, 50, 200);
  const attachments = [];

  if ((kind === 'task' || kind === 'all') && !logId && !noteId) {
    const params = [];
    const where = ['a.deleted_at IS NULL', 't.deleted_at IS NULL'];
    if (taskId) {
      where.push('a.task_id = ?');
      params.push(taskId);
    }
    const [rows] = await getPool().query(
      `
        SELECT a.*
        FROM task_attachments a
        JOIN tasks t ON t.id = a.task_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    attachments.push(...rows.map((row) => attachmentItem('task', mapTaskAttachment(row))));
  }

  if ((kind === 'log' || kind === 'all') && !noteId) {
    const params = [];
    const where = ['a.deleted_at IS NULL', 'l.deleted_at IS NULL', 't.deleted_at IS NULL'];
    if (taskId) {
      where.push('l.task_id = ?');
      params.push(taskId);
    }
    if (logId) {
      where.push('a.log_id = ?');
      params.push(logId);
    }
    const [rows] = await getPool().query(
      `
        SELECT a.*
        FROM log_attachments a
        JOIN work_logs l ON l.id = a.log_id
        JOIN tasks t ON t.id = l.task_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    attachments.push(...rows.map((row) => attachmentItem('log', mapAttachment(row))));
  }

  if ((kind === 'note' || kind === 'all') && !logId) {
    const params = [];
    const where = ['a.deleted_at IS NULL', 'n.deleted_at IS NULL', '(n.task_id IS NULL OR t.deleted_at IS NULL)'];
    if (taskId) {
      where.push('n.task_id = ?');
      params.push(taskId);
    }
    if (noteId) {
      where.push('a.note_id = ?');
      params.push(noteId);
    }
    const [rows] = await getPool().query(
      `
        SELECT a.*
        FROM note_attachments a
        JOIN task_notes n ON n.id = a.note_id
        LEFT JOIN tasks t ON t.id = n.task_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `,
      [...params, limit],
    );
    attachments.push(...rows.map((row) => attachmentItem('note', mapNoteAttachment(row))));
  }

  attachments.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id - a.id);
  return {
    attachments: attachments.slice(0, limit),
    count: Math.min(attachments.length, limit),
    filters: { kind, taskId, logId, noteId },
  };
}

async function keywordSearchWorkspace(query, options = {}) {
  const keyword = toNullableText(query);
  if (!keyword) throw new Error('query is required.');
  const taskId = normalizeTaskId(options.taskId);
  const limit = normalizeLimit(options.limit, 12, 50);
  const taskFilter = taskId ? 'AND t.id = ?' : '';
  const logFilter = taskId ? 'AND l.task_id = ?' : '';
  const noteFilter = taskId ? 'AND n.task_id = ?' : '';
  const results = [];

  const [taskRows] = await getPool().query(
    `
      SELECT t.id, t.title, t.description, t.status, t.updated_at
      FROM tasks t
      WHERE t.deleted_at IS NULL AND (t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?) ${taskFilter}
      ORDER BY t.updated_at DESC
      LIMIT ?
    `,
    taskId
      ? [like(keyword), like(keyword), like(keyword), taskId, limit]
      : [like(keyword), like(keyword), like(keyword), limit],
  );
  results.push(...taskRows.map((row) => ({
    entityType: 'task',
    entityId: Number(row.id),
    taskId: Number(row.id),
    label: row.title,
    excerpt: row.description || row.title,
    status: row.status,
    updatedAt: row.updated_at,
  })));

  const logParams = [like(keyword), like(keyword)];
  if (taskId) logParams.push(taskId);
  logParams.push(limit);
  const [logRows] = await getPool().query(
    `
      SELECT l.id, l.task_id, l.content, l.next_step, l.log_date, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND (l.content LIKE ? OR l.next_step LIKE ?) ${logFilter}
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT ?
    `,
    logParams,
  );
  results.push(...logRows.map((row) => ({
    entityType: 'log',
    entityId: Number(row.id),
    taskId: Number(row.task_id),
    label: `${row.task_title} work log`,
    excerpt: row.content || row.next_step || '',
    logDate: row.log_date,
    updatedAt: row.log_date,
  })));

  const noteParams = [like(keyword), like(keyword), like(keyword)];
  if (taskId) noteParams.push(taskId);
  noteParams.push(limit);
  const [noteRows] = await getPool().query(
    `
      SELECT n.id, n.task_id, n.title, n.content, n.category, n.updated_at
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL) AND (n.title LIKE ? OR n.content LIKE ? OR n.category LIKE ?) ${noteFilter}
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT ?
    `,
    noteParams,
  );
  results.push(...noteRows.map((row) => ({
    entityType: 'note',
    entityId: Number(row.id),
    taskId: row.task_id ? Number(row.task_id) : null,
    label: row.title,
    excerpt: row.content,
    category: row.category,
    updatedAt: row.updated_at,
  })));

  results.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    mode: 'keyword',
    sources: results.slice(0, limit),
    count: Math.min(results.length, limit),
  };
}

export async function searchWorkspaceRecords(options = {}) {
  const query = toNullableText(options.query);
  if (!query) throw new Error('query is required.');
  const limit = normalizeLimit(options.limit, 12, 30);
  const taskId = normalizeTaskId(options.taskId);
  const mode = options.mode === 'keyword' ? 'keyword' : 'semantic';

  if (mode === 'semantic') {
    try {
      const sources = await semanticSearchWorkspace(query, { taskId, limit });
      return {
        mode: 'semantic',
        sources,
        count: sources.length,
      };
    } catch {
      return keywordSearchWorkspace(query, { taskId, limit });
    }
  }
  return keywordSearchWorkspace(query, { taskId, limit });
}
