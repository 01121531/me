import { createActionRequest } from '../action-requests.js';
import { getPool } from '../db.js';
import { toNullableText } from '../validators.js';

const statusAliases = new Map([
  ['待办', 'todo'],
  ['未开始', 'todo'],
  ['进行中', 'in_progress'],
  ['处理中', 'in_progress'],
  ['已完成', 'done'],
  ['完成', 'done'],
]);

const priorityAliases = new Map([
  ['低', 'low'],
  ['中', 'medium'],
  ['高', 'high'],
  ['紧急', 'high'],
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sourceForTask(task, reason = '操作目标任务') {
  return {
    id: `task:${task.id}`,
    entityType: 'task',
    entityId: String(task.id),
    taskId: Number(task.id),
    noteId: null,
    label: task.title,
    excerpt: cleanText([
      `任务：${task.title}`,
      task.description ? `说明：${task.description}` : '',
      `状态：${task.status}`,
      `当前进度：${Number(task.progress || 0)}%`,
    ].filter(Boolean).join(' ')).slice(0, 360),
    score: 1,
    mode: 'database',
    reason,
    matchedFields: ['任务标题'],
    links: [],
    downloadUrl: null,
    previewUrl: null,
    fileName: null,
    mimeType: null,
    isImage: false,
    copyText: task.title,
  };
}

function sourceForResource(resource, reason = '操作目标资料') {
  return {
    id: `resource:${resource.id}`,
    entityType: 'resource',
    entityId: String(resource.id),
    resourceId: Number(resource.id),
    publicId: resource.public_id,
    taskId: null,
    noteId: null,
    label: resource.title,
    excerpt: cleanText([
      `资料：${resource.title}`,
      resource.description ? `说明：${resource.description}` : '',
      `类型：${resource.kind}`,
    ].filter(Boolean).join(' ')).slice(0, 360),
    score: 1,
    mode: 'database',
    reason,
    matchedFields: ['资料标题'],
    links: resource.source_url ? [resource.source_url] : [],
    downloadUrl: null,
    previewUrl: null,
    fileName: null,
    mimeType: null,
    isImage: false,
    copyText: resource.title,
  };
}

function isInstructionQuestion(question) {
  const text = cleanText(question);
  if (!text || /^(怎么|如何|为什么|能否介绍|可以怎样)/.test(text)) return false;
  return /(新建|创建|新增|添加|修改|更新|编辑|改成|设为|设置为|调整到|记录到|写入|写一条|写一个|保存为|移动到|关联到|分配标签)/.test(text);
}

function explicitEntityType(question) {
  const text = compactText(question);
  if (/日志|工作记录/.test(text)) return 'log';
  if (/笔记|备忘|记事/.test(text)) return 'note';
  if (/资料|文件|文档|链接|网址/.test(text)) return 'resource';
  if (/任务|待办/.test(text)) return 'task';
  return '';
}

function parseStatus(question) {
  for (const [label, value] of statusAliases) {
    if (String(question || '').includes(label)) return value;
  }
  return undefined;
}

function parsePriority(question) {
  const match = String(question || '').match(/(?:优先级|优先)(?:改成|设为|设置为|是)?[：:]?\s*(低|中|高|紧急)/);
  return match ? priorityAliases.get(match[1]) : undefined;
}

function parseProgress(question) {
  const match = String(question || '').match(/(?:进度)(?:改成|设为|设置为|调整到|到|是)?[：:]?\s*(\d{1,3})\s*%?/);
  if (!match) return undefined;
  return Math.max(0, Math.min(100, Number(match[1])));
}

function parseHours(question) {
  const match = String(question || '').match(/(?:耗时|工时|用了?)\s*(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
  return match ? Math.max(0, Number(match[1])) : undefined;
}

function parseDate(question, labelPattern) {
  const match = String(question || '').match(new RegExp(`(?:${labelPattern})(?:改成|设为|设置为|是)?[：:]?\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return match?.[1];
}

function trimPayloadText(value) {
  return cleanText(value).replace(/[。；;]+$/g, '').slice(0, 4000);
}

function parseCreateTitle(question, entityLabel) {
  const text = cleanText(question);
  const pattern = new RegExp(`(?:新建|创建|新增|添加)(?:一个|一条|个|条)?(?:${entityLabel})[：:\\s]*[“\"]?(.+?)[”\"]?(?=(?:，|,|；|;|。|\\s+(?:优先级|状态|进度|截止|分类|内容|说明|描述)[：:]?)|$)`);
  return trimPayloadText(text.match(pattern)?.[1] || '').slice(0, 255);
}

function parseLabeledText(question, label) {
  const match = cleanText(question).match(new RegExp(`(?:${label})[：:]\\s*(.+?)(?=(?:，|,|；|;|。|\\s+(?:标题|分类|内容|说明|描述|下一步|耗时|工时|进度|目录|标签|网址|链接)[：:]?)|$)`));
  return trimPayloadText(match?.[1] || '');
}

function parseUrl(question) {
  const match = String(question || '').match(/https?:\/\/[^\s，,；;。]+/i);
  return match?.[0] || '';
}

async function loadActiveTasks() {
  const [rows] = await getPool().query(
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 200',
  );
  return rows;
}

function entityMatchScore(title, question) {
  const compactTitle = compactText(title);
  const text = compactText(question);
  if (!compactTitle || !text.includes(compactTitle)) return 0;
  return 1000 + compactTitle.length;
}

async function resolveTask(question, preferredTaskId = null) {
  const numericId = Number(preferredTaskId || String(question || '').match(/任务\s*#?\s*(\d+)/)?.[1]);
  if (Number.isInteger(numericId) && numericId > 0) {
    const [[task]] = await getPool().query(
      'SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL',
      [numericId],
    );
    if (task) return { task, ambiguous: false };
  }

  const tasks = await loadActiveTasks();
  const matches = tasks
    .map((task) => ({ task, score: entityMatchScore(task.title, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return { task: null, ambiguous: false };
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { task: null, ambiguous: true, candidates: matches.slice(0, 3).map((item) => item.task) };
  }
  return { task: matches[0].task, ambiguous: false };
}

async function resolveLog(question) {
  const id = Number(String(question || '').match(/日志\s*#?\s*(\d+)/)?.[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [[row]] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.id = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
    [id],
  );
  return row || null;
}

async function resolveNote(question) {
  const id = Number(String(question || '').match(/笔记\s*#?\s*(\d+)/)?.[1]);
  if (Number.isInteger(id) && id > 0) {
    const [[row]] = await getPool().query(
      'SELECT * FROM task_notes WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (row) return row;
  }
  const [rows] = await getPool().query(
    'SELECT * FROM task_notes WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 200',
  );
  return rows
    .map((note) => ({ note, score: entityMatchScore(note.title, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.note || null;
}

async function resolveResource(question) {
  const id = Number(String(question || '').match(/(?:资料|文件|文档)\s*#?\s*(\d+)/)?.[1]);
  if (Number.isInteger(id) && id > 0) {
    const [[row]] = await getPool().query(
      'SELECT * FROM resources WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (row) return { resource: row, ambiguous: false };
  }
  const [rows] = await getPool().query(
    'SELECT * FROM resources WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 300',
  );
  const matches = rows
    .map((resource) => ({ resource, score: entityMatchScore(resource.title, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return { resource: null, ambiguous: false };
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { resource: null, ambiguous: true, candidates: matches.slice(0, 3).map((item) => item.resource) };
  }
  return { resource: matches[0].resource, ambiguous: false };
}

async function resolveExistingFolder(name) {
  if (!name) return null;
  const [[row]] = await getPool().query(
    `
      SELECT f.id, f.name
      FROM folders f
      JOIN workspaces w ON w.id = f.workspace_id AND w.is_default = 1
      WHERE f.deleted_at IS NULL AND LOWER(f.name) = LOWER(?)
      ORDER BY f.id
      LIMIT 1
    `,
    [name],
  );
  return row || null;
}

async function resolveExistingTags(rawNames) {
  const names = [...new Set(String(rawNames || '').split(/[，,、]/).map(cleanText).filter(Boolean))];
  if (!names.length) return { ids: [], missing: [] };
  const placeholders = names.map(() => '?').join(', ');
  const [rows] = await getPool().query(
    `
      SELECT t.id, t.name
      FROM tags t
      JOIN workspaces w ON w.id = t.workspace_id AND w.is_default = 1
      WHERE t.deleted_at IS NULL AND LOWER(t.name) IN (${placeholders})
    `,
    names.map((name) => name.toLowerCase()),
  );
  const found = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  return {
    ids: names.map((name) => found.get(name.toLowerCase())?.id).filter(Boolean),
    missing: names.filter((name) => !found.has(name.toLowerCase())),
  };
}

function clarification(message, intent = 'action_clarification') {
  return {
    intent,
    handled: true,
    answer: `<section class="ai-clarification-panel"><h3>还需要一点信息</h3><p>${escapeHtml(message)}</p></section>`,
    sources: [],
    grounded: false,
    facts: [],
    suggestions: [],
    actionRequests: [],
  };
}

function actionConfirmation(action, sources = [], intent = 'action') {
  return {
    intent,
    handled: true,
    answer: [
      '<section class="ai-fact-panel">',
      '<h3>待审批操作已生成</h3>',
      `<p>我已根据你的指令生成 <strong>${escapeHtml(action.title)}</strong>。确认前不会修改工作区数据。</p>`,
      '</section>',
    ].join(''),
    sources,
    grounded: true,
    facts: [{ type: 'action_request', id: action.id, title: action.title }],
    suggestions: [],
    actionRequests: [action],
  };
}

async function requestAction(actionType, payload, requestedBy, source = 'ai_chat') {
  return createActionRequest({
    toolName: 'ai_chat_planner',
    actionType,
    payload: {
      ...payload,
      sourceReason: '由 AI 对话根据用户明确指令生成，需审批后执行。',
    },
    requestedBy: requestedBy || 'local-ai',
    source,
  });
}

async function planTaskAction(question, options) {
  const text = cleanText(question);
  const createIntent = /(?:新建|创建|新增|添加)(?:一个|一条|个|条)?(?:任务|待办)/.test(text);
  if (createIntent) {
    const title = parseCreateTitle(text, '(?:任务|待办)');
    if (!title) return clarification('请补充任务标题，例如“创建任务：准备客户合同”。', 'action_create_task');
    const payload = {
      title,
      description: parseLabeledText(text, '说明|描述') || null,
      priority: parsePriority(text) || 'medium',
      status: parseStatus(text) || 'todo',
      progress: parseProgress(text),
      dueDate: parseDate(text, '截止日期|截止'),
      tags: parseLabeledText(text, '标签') || null,
    };
    const action = await requestAction('create_task', payload, options.requestedBy, options.source);
    return actionConfirmation(action, [], 'action_create_task');
  }

  const { task, ambiguous, candidates = [] } = await resolveTask(text, options.taskId);
  if (ambiguous) {
    return clarification(`匹配到多个任务：${candidates.map((item) => item.title).join('、')}。请明确要修改哪一个。`, 'action_update_task');
  }
  if (!task) return clarification('请写明要修改的任务标题或任务 ID。', 'action_update_task');

  const payload = { taskId: Number(task.id) };
  const status = parseStatus(text);
  const priority = parsePriority(text);
  const progress = parseProgress(text);
  const dueDate = parseDate(text, '截止日期|截止');
  if (status !== undefined) payload.status = status;
  if (priority !== undefined) payload.priority = priority;
  if (progress !== undefined) payload.progress = progress;
  if (dueDate !== undefined) payload.dueDate = dueDate;
  const description = parseLabeledText(text, '说明|描述');
  if (description) payload.description = description;

  if (Object.keys(payload).length === 1) {
    return clarification('已找到目标任务，请说明要修改状态、进度、优先级、截止日期或说明中的哪一项。', 'action_update_task');
  }
  const action = await requestAction('update_task', payload, options.requestedBy, options.source);
  return actionConfirmation(action, [sourceForTask(task)], 'action_update_task');
}

async function planLogAction(question, options) {
  const text = cleanText(question);
  const createIntent = /(?:新建|创建|新增|添加|写)(?:一个|一条|个|条)?(?:工作)?日志/.test(text);
  if (createIntent) {
    const { task } = await resolveTask(text, options.taskId);
    if (!task) return clarification('请写明这条日志属于哪一个任务。', 'action_create_log');
    const content = parseLabeledText(text, '日志内容|内容')
      || trimPayloadText(text.match(/(?:日志)[：:]\s*(.+)$/)?.[1] || '');
    if (!content) return clarification('请补充日志内容，例如“给任务 X 添加日志：已完成合同核对”。', 'action_create_log');
    const payload = {
      taskId: Number(task.id),
      content,
      hours: parseHours(text),
      progressSnapshot: parseProgress(text),
      stage: parseStatus(text) || task.status,
      logDate: parseDate(text, '日期'),
      nextStep: parseLabeledText(text, '下一步') || null,
    };
    const action = await requestAction('create_log', payload, options.requestedBy, options.source);
    return actionConfirmation(action, [sourceForTask(task)], 'action_create_log');
  }

  const log = await resolveLog(text);
  if (!log) return clarification('编辑日志时请提供日志 ID，例如“修改日志 #12”。', 'action_update_log');
  const payload = { logId: Number(log.id) };
  const content = parseLabeledText(text, '日志内容|内容');
  const nextStep = parseLabeledText(text, '下一步');
  if (content) payload.content = content;
  if (nextStep) payload.nextStep = nextStep;
  const hours = parseHours(text);
  const progress = parseProgress(text);
  const stage = parseStatus(text);
  const logDate = parseDate(text, '日期');
  if (hours !== undefined) payload.hours = hours;
  if (progress !== undefined) payload.progressSnapshot = progress;
  if (stage !== undefined) payload.stage = stage;
  if (logDate !== undefined) payload.logDate = logDate;
  if (Object.keys(payload).length === 1) return clarification('请说明要修改这条日志的哪些内容。', 'action_update_log');
  const action = await requestAction('update_log', payload, options.requestedBy, options.source);
  return actionConfirmation(action, [], 'action_update_log');
}

async function planNoteAction(question, options) {
  const text = cleanText(question);
  const createIntent = /(?:新建|创建|新增|添加|写)(?:一个|一条|个|条)?(?:任务)?笔记/.test(text);
  if (createIntent) {
    const resolvedTask = await resolveTask(text, options.taskId);
    const title = parseLabeledText(text, '标题') || parseCreateTitle(text, '(?:任务)?笔记');
    const content = parseLabeledText(text, '笔记内容|内容')
      || trimPayloadText(text.match(/(?:笔记)[：:]\s*(.+)$/)?.[1] || '');
    if (!content) return clarification('请补充笔记内容。', 'action_create_note');
    const payload = {
      taskId: resolvedTask.task ? Number(resolvedTask.task.id) : null,
      title: title || content.slice(0, 48),
      category: parseLabeledText(text, '分类') || null,
      content,
    };
    const action = await requestAction('create_note', payload, options.requestedBy, options.source);
    return actionConfirmation(action, resolvedTask.task ? [sourceForTask(resolvedTask.task)] : [], 'action_create_note');
  }

  const note = await resolveNote(text);
  if (!note) return clarification('编辑笔记时请提供笔记标题或笔记 ID。', 'action_update_note');
  const payload = { noteId: Number(note.id) };
  const title = parseLabeledText(text, '标题');
  const content = parseLabeledText(text, '笔记内容|内容');
  const category = parseLabeledText(text, '分类');
  if (title) payload.title = title;
  if (content) payload.content = content;
  if (category) payload.category = category;
  if (Object.keys(payload).length === 1) return clarification('请说明要修改这条笔记的标题、分类或内容。', 'action_update_note');
  const action = await requestAction('update_note', payload, options.requestedBy, options.source);
  return actionConfirmation(action, [], 'action_update_note');
}

async function planResourceAction(question, options) {
  const text = cleanText(question);
  const createIntent = /(?:新建|创建|新增|添加|保存为)(?:一个|一条|个|条)?(?:文本|网页|链接|文件)?(?:资料|文件|文档|链接|网址)/.test(text);
  if (createIntent) {
    const sourceUrl = parseUrl(text);
    const kind = sourceUrl ? 'link' : 'text';
    const title = parseLabeledText(text, '标题')
      || parseCreateTitle(text, '(?:资料|文件|文档|链接|网址)')
      || (sourceUrl ? new URL(sourceUrl).hostname : '');
    const content = parseLabeledText(text, '资料内容|正文|内容');
    if (!title) return clarification('请补充资料标题。', 'action_create_resource');
    if (kind === 'text' && !content) {
      return clarification('文本资料还需要正文内容；文件资料请在资料库中上传文件。', 'action_create_resource');
    }

    const folderName = parseLabeledText(text, '目录|文件夹');
    const folder = await resolveExistingFolder(folderName);
    if (folderName && !folder) {
      return clarification(`目录“${folderName}”尚未创建。请先在资料库中创建该目录，再让我保存资料。`, 'action_create_resource');
    }
    const tagNames = parseLabeledText(text, '标签');
    const tags = await resolveExistingTags(tagNames);
    if (tags.missing.length) {
      return clarification(`标签“${tags.missing.join('、')}”尚未创建。请先在资料库中创建标签。`, 'action_create_resource');
    }

    const payload = {
      kind,
      title,
      description: parseLabeledText(text, '说明|描述') || null,
      sourceUrl: sourceUrl || null,
      content: kind === 'text' ? content : null,
      folderId: folder?.id || null,
      tagIds: tags.ids,
    };
    const action = await requestAction('create_resource', payload, options.requestedBy, options.source);
    return actionConfirmation(action, [], 'action_create_resource');
  }

  const { resource, ambiguous, candidates = [] } = await resolveResource(text);
  if (ambiguous) {
    return clarification(`匹配到多个资料：${candidates.map((item) => item.title).join('、')}。请明确要更新哪一个。`, 'action_update_resource');
  }
  if (!resource) return clarification('请写明要修改的资料标题或资料 ID。', 'action_update_resource');

  const payload = { resourceId: Number(resource.id) };
  const title = parseLabeledText(text, '标题');
  const description = parseLabeledText(text, '说明|描述');
  if (title) payload.title = title;
  if (description) payload.description = description;

  const folderName = parseLabeledText(text, '目录|文件夹');
  if (folderName) {
    if (/^(根目录|无目录)$/.test(folderName)) payload.folderId = null;
    else {
      const folder = await resolveExistingFolder(folderName);
      if (!folder) return clarification(`目录“${folderName}”尚未创建。请先在资料库中创建该目录。`, 'action_update_resource');
      payload.folderId = folder.id;
    }
  }

  const tagNames = parseLabeledText(text, '标签');
  if (tagNames) {
    const tags = await resolveExistingTags(tagNames);
    if (tags.missing.length) {
      return clarification(`标签“${tags.missing.join('、')}”尚未创建。请先在资料库中创建标签。`, 'action_update_resource');
    }
    payload.tagIds = tags.ids;
  }

  if (/禁止\s*AI|不让\s*AI|AI\s*不可见/.test(text)) payload.aiVisibility = 'deny';
  if (/允许\s*AI|AI\s*可见/.test(text)) payload.aiVisibility = 'allow';
  if (Object.keys(payload).length === 1) {
    return clarification('请说明要修改资料的标题、说明、目录、已有标签或 AI 可见性。', 'action_update_resource');
  }
  const action = await requestAction('update_resource', payload, options.requestedBy, options.source);
  return actionConfirmation(action, [sourceForResource(resource)], 'action_update_resource');
}

export async function planAiActionRequest(question, options = {}) {
  const normalized = toNullableText(question);
  if (!normalized || !isInstructionQuestion(normalized)) return null;

  const entityType = explicitEntityType(normalized);
  if (entityType === 'log') return planLogAction(normalized, options);
  if (entityType === 'note') return planNoteAction(normalized, options);
  if (entityType === 'resource') return planResourceAction(normalized, options);

  const resolvedTask = await resolveTask(normalized, options.taskId);
  const hasTaskMutation = entityType === 'task'
    || Boolean(resolvedTask.task)
    || /(?:改成|设为|设置为|调整到).*(?:待办|进行中|已完成|进度|优先级)/.test(normalized);
  if (hasTaskMutation) return planTaskAction(normalized, options);

  return null;
}
