import { OpenAI } from '@llamaindex/openai';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { toNullableText } from '../validators.js';
import { retrieveRelevantNodes } from './vector-store.js';

let chatModel;
let chatModelSignature = '';

const workspaceAssistantPrompt = [
  '你是个人助理任务台的工作助手。',
  '数据库事实只能来自下方提供的任务台资料；资料不足时必须明确说明缺少什么，禁止自行补全。',
  '回答使用中文，简洁，并在相关句子后标注来源编号，例如 [1]。',
  '回答必须把事实和建议分开：事实放在标题为“数据库事实”的区块；只有用户需要分析或下一步时才增加标题为“AI 建议”的区块。',
  '建议必须明确标注为建议，不得把建议描述成已经发生的任务、日志、日期、进度或附件内容。',
  '输出可嵌入页面的安全 HTML 片段，不要输出完整 html、head 或 body。',
  '不要使用 Markdown 语法，不要输出 **加粗**、- 列表、反引号代码块；必须直接使用 HTML 标签表达结构。',
  '优先使用 p、strong、em、ul、ol、li、table、thead、tbody、tr、th、td、dl、dt、dd、section、progress、blockquote、pre、code、br、h3、h4、a 等内容标签。',
  '如果回答包含任务数量、状态、进度、耗时或网址，优先组织成数据面板：用 class="ai-summary-panel"、class="ai-metric-grid"、class="ai-task-grid"、class="ai-task-panel-card" 等结构化区块。',
  '回答里出现网址时必须使用 <a href="https://...">文字</a>，字段类资料优先用 dl 或 table，重要结论用 strong。',
  '禁止输出 script、style、iframe、object、embed、form、input、button、事件属性或内联样式。',
  '不要编造任务、时间、进度、日志、笔记或附件内容。',
].join('\n');

const noWorkspaceContextAnswer = '<p>没有检索到足够的任务台资料，因此无法确认答案。</p>';
const noTaskContextAnswer = '<p>没有检索到足够相关的任务资料，因此无法确认答案。</p>';
const emptyModelAnswer = '<p>模型没有返回可用答案。</p>';
const taskSourceTypes = new Set(['task', 'log', 'task_attachment', 'log_attachment']);
const noteSourceTypes = new Set(['note', 'note_attachment']);
const genericQueryPhrases = [
  'incomplete tasks',
  'unfinished tasks',
  'open tasks',
  '没有完成',
  '還沒完成',
  '未完成',
  '没完成',
  '没做完',
  '任务方面',
  '工作日志',
  '会议记录',
  '会议笔记',
  '任务',
  '笔记',
  '记录',
  '日志',
  '完成',
  '进度',
  '状态',
  '待办',
  '进行中',
  '已完成',
  '未处理',
  '哪些',
  '还有',
  '什么',
  '怎么',
  '怎样',
  '怎么样',
  '如何',
  '情况',
  '相关',
  '关于',
  '查看',
  '看看',
  '一下',
  '请问',
  '当前',
  '现在',
  '来源',
  '资料',
  '内容',
  '优先级',
  '截止',
  '下一步',
  '工时',
  '耗时',
  '附件',
  '文件',
  '下载',
  '预览',
  '的',
  '了',
  '吗',
  '呢',
];

function getChatModel() {
  if (!config.ai.litellm.baseUrl || !config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_CHAT_MODEL.');
  }
  const nextSignature = [
    config.ai.litellm.baseUrl,
    config.ai.litellm.apiKey,
    config.ai.litellm.chatModel,
  ].join('\n');
  if (!chatModel || chatModelSignature !== nextSignature) {
    chatModel = new OpenAI({
      model: config.ai.litellm.chatModel,
      apiKey: config.ai.litellm.apiKey,
      baseURL: config.ai.litellm.baseUrl,
      temperature: 0.2,
      maxRetries: 1,
      timeout: 45000,
    });
    chatModelSignature = nextSignature;
  }
  return chatModel;
}

function messageToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : part?.text || ''))
    .join('')
    .trim();
}

function normalizeLimit(value, fallback = 8, max = 20) {
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
  return `%${String(value || '').trim()}%`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeActionUrl(value) {
  const trimmed = String(value || '')
    .trim()
    .replace(/[)\]}>,，。；;、!?！？]+$/g, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractLinks(value) {
  const seen = new Set();
  const links = [];
  const text = String(value || '');
  const pattern = /\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi;
  for (const match of text.matchAll(pattern)) {
    const url = normalizeActionUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label: url.replace(/^mailto:/i, '') });
  }
  return links;
}

function normalizeLinks(links) {
  const seen = new Set();
  return (Array.isArray(links) ? links : [])
    .map((item) => {
      const url = normalizeActionUrl(typeof item === 'string' ? item : item?.url);
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return {
        url,
        label: String(item?.label || url.replace(/^mailto:/i, '')).trim(),
      };
    })
    .filter(Boolean);
}

function attachmentUrlBase(entityType) {
  if (entityType === 'log_attachment') return '/api/attachments';
  if (entityType === 'note_attachment') return '/api/note-attachments';
  if (entityType === 'task_attachment') return '/api/task-attachments';
  return '';
}

function isImageMimeType(value) {
  return String(value || '').startsWith('image/');
}

function isIncompleteTaskQuestion(question) {
  const text = String(question || '').toLowerCase();
  return /未完成|没完成|還沒完成|没有完成|还有.*(?:没|未).*任务|待办任务|未处理任务|没做完|open tasks|incomplete tasks|unfinished tasks/.test(text);
}

function isTaskOverviewQuestion(question) {
  return /任务总览|任务概览|全部任务|所有任务|有哪些任务|任务情况|任务统计|我的任务/.test(String(question || ''));
}

function isTodayLogQuestion(question) {
  return /今天.*(?:做了|日志|记录|进展)|今日.*(?:日志|工作|进展)|今天的工作/.test(String(question || ''));
}

function isWeekLogQuestion(question) {
  return /本周.*(?:做了|日志|记录|进展|工作)|这周.*(?:做了|日志|记录|进展|工作)|周报|本星期/.test(String(question || ''));
}

function hasActionSignal(question) {
  const text = String(question || '').trim();
  if (/^(怎么|如何|为什么|能否介绍|可以怎样)/.test(text)) return false;
  return /(新建|创建|新增|添加|修改|更新|编辑|改成|设为|设置为|调整到|记录到|写入|写(?:一条|一个)?(?:日志|笔记))/.test(text)
    && /(任务|待办|日志|工作记录|笔记|备忘|进度|优先级|待办|进行中|已完成)/.test(text);
}

export function classifyAiQueryIntent(question) {
  const text = compactText(question);
  if (hasActionSignal(question)) return 'action';
  if (isTodayLogQuestion(question)) return 'log_today';
  if (isWeekLogQuestion(question)) return 'log_week';
  if (isIncompleteTaskQuestion(question)) return 'incomplete_tasks';
  if (isTaskOverviewQuestion(question)) return 'task_overview';
  const hasTaskSignal = isIncompleteTaskQuestion(question)
    || /任务|待办|进行中|已完成|未完成|没完成|进度|状态|截止|优先级|工作日志|下一步|工时|耗时/.test(text);
  const hasNoteSignal = /笔记|记事|备忘|会议笔记|会议记录/.test(text);
  const hasAttachmentSignal = /附件|文件|pdf|图片|截图|word|excel|表格|压缩包|下载|预览/.test(text);
  const hasLinkSignal = /网址|链接|网站|url|https?:\/\//i.test(String(question || ''));
  if (hasTaskSignal && hasNoteSignal) return 'task_note';
  if (hasNoteSignal) return 'note_search';
  if (hasAttachmentSignal) return 'attachment_search';
  if (hasLinkSignal) return 'link_search';
  if (hasTaskSignal) return 'task_progress';
  return 'general';
}

function isTaskLikeIntent(intent) {
  return ['task', 'task_note', 'task_overview', 'incomplete_tasks', 'task_progress', 'log_today', 'log_week'].includes(intent);
}

function isNoteLikeIntent(intent) {
  return intent === 'note' || intent === 'note_search';
}

function stripGenericQueryPhrases(value) {
  let text = compactText(value);
  for (const phrase of genericQueryPhrases.sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(compactText(phrase), ' ');
  }
  return text;
}

function extractStrongKeywords(question) {
  const raw = String(question || '')
    .replace(/\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi, ' ')
    .toLowerCase();
  const candidates = raw
    .split(/[^\p{Script=Han}a-z0-9_@.-]+/u)
    .flatMap((part) => {
      const stripped = stripGenericQueryPhrases(part)
        .split(/\s+/)
        .map((item) => item.trim());
      return [part.trim(), ...stripped];
    })
    .map((item) => item.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((item) => item.length >= 2 && !genericQueryPhrases.some((phrase) => compactText(phrase) === compactText(item)));
  return uniqueValues(candidates).slice(0, 6);
}

function keywordSearchTerms(question) {
  const normalized = toNullableText(question);
  if (!normalized) return [];
  return uniqueValues([normalized, ...extractStrongKeywords(normalized)])
    .filter((term) => term.length >= 2)
    .slice(0, 6);
}

function likeClause(fields, terms) {
  const clauses = terms.map(() => `(${fields.map((field) => `${field} LIKE ?`).join(' OR ')})`);
  const params = terms.flatMap((term) => fields.map(() => like(term)));
  return {
    sql: clauses.length ? `(${clauses.join(' OR ')})` : '1 = 0',
    params,
  };
}

function toChatContent(value, maxLength = 2400) {
  const text = cleanText(value);
  return text ? text.slice(0, maxLength) : '';
}

function normalizeChatHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
      const content = toChatContent(message?.content);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-12);
}

function chatCompletionsUrl() {
  const baseUrl = String(config.ai.litellm.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('LiteLLM requires LITELLM_BASE_URL.');
  }
  return `${baseUrl}/chat/completions`;
}

function sourceLabel(metadata, entityType, entityId) {
  const title = String(metadata?.title || '').trim();
  if (entityType === 'task') return title || `任务 #${entityId}`;
  if (entityType === 'log') return title ? `${title} 的工作日志` : `工作日志 #${entityId}`;
  if (entityType === 'note') return title || `笔记 #${entityId}`;
  if (entityType.endsWith('_attachment')) return `${title || '附件'}：${metadata.fileName || `附件 #${entityId}`}`;
  return `${entityType} #${entityId}`;
}

function toSource(hit) {
  const metadata = hit.metadata || {};
  const entityType = String(metadata.entityType || 'unknown');
  const entityId = String(metadata.entityId || hit.id || '');
  const links = normalizeLinks([...(metadata.links || []), ...extractLinks(hit.text)]);
  return {
    id: String(metadata.documentId || `${entityType}:${entityId}`),
    entityType,
    entityId,
    taskId: metadata.taskId ? Number(metadata.taskId) : null,
    noteId: entityType === 'note'
      ? Number(entityId)
      : entityType === 'note_attachment' && metadata.ownerId
        ? Number(metadata.ownerId)
        : null,
    label: sourceLabel(metadata, entityType, entityId),
    excerpt: hit.text.slice(0, 360),
    score: Math.round(Number(hit.score || 0) * 1000) / 1000,
    mode: metadata.searchMode || 'semantic',
    reason: metadata.reason || '',
    matchedFields: Array.isArray(metadata.matchedFields) ? metadata.matchedFields : [],
    links,
    downloadUrl: metadata.downloadUrl || null,
    previewUrl: metadata.previewUrl || null,
    fileName: metadata.fileName || null,
    mimeType: metadata.mimeType || null,
    isImage: Boolean(metadata.isImage),
    copyText: metadata.copyText || metadata.fileName || hit.text.slice(0, 360),
  };
}

function matchedFieldsFor(terms, fields) {
  const normalizedTerms = terms.map(compactText).filter(Boolean);
  return Object.entries(fields)
    .filter(([, value]) => {
      const haystack = compactText(value);
      return haystack && normalizedTerms.some((term) => haystack.includes(term));
    })
    .map(([label]) => label);
}

function withMatchedFields(hit, matchedFields, score = hit.score) {
  return {
    ...hit,
    score,
    metadata: {
      ...(hit.metadata || {}),
      matchedFields: uniqueValues(matchedFields),
    },
  };
}

function taskNode(row, score = 0.45) {
  return {
    id: `task:${row.id}`,
    score,
    text: cleanText([
      `任务：${row.title}`,
      row.description ? `说明：${row.description}` : '',
      row.tags ? `标签：${row.tags}` : '',
      `优先级：${row.priority}`,
      `状态：${row.status}`,
      `当前进度：${row.progress}%`,
      row.due_date ? `截止日期：${row.due_date}` : '',
      row.updated_at ? `更新时间：${row.updated_at}` : '',
    ].filter(Boolean).join('\n')),
    metadata: {
      documentId: `task:${row.id}`,
      entityType: 'task',
      entityId: String(row.id),
      taskId: Number(row.id),
      title: row.title,
      status: row.status,
      priority: row.priority,
      progress: Number(row.progress || 0),
      dueDate: row.due_date || null,
      searchMode: 'keyword',
    },
  };
}

function logNode(row, score = 0.42) {
  return {
    id: `log:${row.id}`,
    score,
    text: cleanText([
      `任务：${row.task_title}`,
      `工作日志：${row.content}`,
      `日期：${row.log_date}`,
      `阶段：${row.stage}`,
      `进度快照：${row.progress_snapshot}%`,
      `耗时：${row.hours} 小时`,
      row.next_step ? `下一步：${row.next_step}` : '',
    ].filter(Boolean).join('\n')),
    metadata: {
      documentId: `log:${row.id}`,
      entityType: 'log',
      entityId: String(row.id),
      taskId: Number(row.task_id),
      title: row.task_title,
      logDate: row.log_date,
      content: row.content,
      stage: row.stage,
      progressSnapshot: Number(row.progress_snapshot || 0),
      hours: Number(row.hours || 0),
      nextStep: row.next_step || '',
      searchMode: 'keyword',
    },
  };
}

function noteNode(row, score = 0.4) {
  return {
    id: `note:${row.id}`,
    score,
    text: cleanText([
      `笔记：${row.title}`,
      row.category ? `分类：${row.category}` : '',
      row.task_title ? `关联任务：${row.task_title}` : '独立笔记',
      row.content,
    ].filter(Boolean).join('\n')),
    metadata: {
      documentId: `note:${row.id}`,
      entityType: 'note',
      entityId: String(row.id),
      taskId: row.task_id ? Number(row.task_id) : null,
      title: row.title,
      category: row.category,
      searchMode: 'keyword',
    },
  };
}

function attachmentNode(row, entityType, ownerIdKey, score = 0.35) {
  const urlBase = attachmentUrlBase(entityType);
  const isImage = isImageMimeType(row.mime_type);
  return {
    id: `${entityType}:${row.id}`,
    score,
    text: cleanText([
      `附件：${row.original_name}`,
      row.note ? `备注：${row.note}` : '',
      row.task_title ? `关联任务：${row.task_title}` : '',
      row.owner_title ? `所属记录：${row.owner_title}` : '',
      `文件类型：${row.mime_type}`,
      row.cached_text ? `文件内容：${row.cached_text}` : '',
    ].filter(Boolean).join('\n')),
    metadata: {
      documentId: `${entityType}:${row.id}`,
      entityType,
      entityId: String(row.id),
      taskId: row.task_id ? Number(row.task_id) : null,
      title: row.task_title || row.owner_title || row.original_name,
      fileName: row.original_name,
      mimeType: row.mime_type || 'application/octet-stream',
      isImage,
      previewUrl: urlBase && isImage ? `${urlBase}/${row.id}/preview` : null,
      downloadUrl: urlBase ? `${urlBase}/${row.id}/download` : null,
      copyText: row.original_name,
      ownerId: row[ownerIdKey] ? Number(row[ownerIdKey]) : null,
      searchMode: 'keyword',
    },
  };
}

async function keywordHits(question, { taskId = null, limit = 8 } = {}) {
  const terms = keywordSearchTerms(question);
  if (!terms.length) return [];
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedLimit = normalizeLimit(limit, 8, 20);
  const hits = [];

  const taskLike = likeClause(['title', 'description', 'tags'], terms);
  const taskParams = [...taskLike.params];
  let taskWhere = `deleted_at IS NULL AND ${taskLike.sql}`;
  if (normalizedTaskId) {
    taskWhere = `id = ? AND ${taskWhere}`;
    taskParams.unshift(normalizedTaskId);
  }
  const [taskRows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE ${taskWhere}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    [...taskParams, normalizedLimit],
  );
  hits.push(...taskRows.map((row) => {
    const matchedFields = matchedFieldsFor(terms, {
      '任务标题': row.title,
      '任务说明': row.description,
      '任务标签': row.tags,
    });
    return withMatchedFields(taskNode(row), matchedFields, matchedFields.includes('任务标题') ? 0.9 : 0.68);
  }));

  const logLike = likeClause(['l.content', 'l.next_step', 't.title'], terms);
  const logParams = [...logLike.params];
  let logTaskFilter = '';
  if (normalizedTaskId) {
    logTaskFilter = 'AND l.task_id = ?';
    logParams.push(normalizedTaskId);
  }
  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND ${logLike.sql} ${logTaskFilter}
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT ?
    `,
    [...logParams, normalizedLimit],
  );
  hits.push(...logRows.map((row) => {
    const matchedFields = matchedFieldsFor(terms, {
      '任务标题': row.task_title,
      '日志内容': row.content,
      '下一步': row.next_step,
    });
    return withMatchedFields(logNode(row), matchedFields, matchedFields.includes('日志内容') ? 0.82 : 0.66);
  }));

  const noteLike = likeClause(['n.title', 'n.content', 'n.category', 't.title'], terms);
  const noteParams = [...noteLike.params];
  let noteTaskFilter = '';
  if (normalizedTaskId) {
    noteTaskFilter = 'AND n.task_id = ?';
    noteParams.push(normalizedTaskId);
  }
  const [noteRows] = await getPool().query(
    `
      SELECT n.*, t.title AS task_title
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL) AND ${noteLike.sql} ${noteTaskFilter}
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT ?
    `,
    [...noteParams, normalizedLimit],
  );
  hits.push(...noteRows.map((row) => {
    const matchedFields = matchedFieldsFor(terms, {
      '笔记标题': row.title,
      '笔记内容': row.content,
      '笔记分类': row.category,
      '关联任务': row.task_title,
    });
    return withMatchedFields(noteNode(row), matchedFields, matchedFields.includes('笔记标题') ? 0.84 : 0.64);
  }));

  const attachmentLike = likeClause(['a.original_name', 'a.note', 'c.text', 't.title'], terms);
  const attachmentParams = [...attachmentLike.params];
  const attachmentTaskFilter = normalizedTaskId ? 'AND a.task_id = ?' : '';
  if (normalizedTaskId) attachmentParams.push(normalizedTaskId);
  const [taskAttachmentRows] = await getPool().query(
    `
      SELECT a.*, t.title AS task_title, t.title AS owner_title, c.text AS cached_text
      FROM task_attachments a
      JOIN tasks t ON t.id = a.task_id
      LEFT JOIN attachment_text_cache c
        ON c.attachment_kind = 'task' AND c.attachment_id = a.id
      WHERE a.deleted_at IS NULL AND t.deleted_at IS NULL AND ${attachmentLike.sql} ${attachmentTaskFilter}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `,
    [...attachmentParams, normalizedLimit],
  );
  hits.push(...taskAttachmentRows.map((row) => withMatchedFields(
    attachmentNode(row, 'task_attachment', 'task_id'),
    matchedFieldsFor(terms, {
      '文件名': row.original_name,
      '附件备注': row.note,
      '附件文字': row.cached_text,
      '关联任务': row.task_title,
    }),
    0.72,
  )));

  const logAttachmentLike = likeClause(['a.original_name', 'a.note', 'c.text', 't.title', 'l.content'], terms);
  const logAttachmentParams = [...logAttachmentLike.params];
  const logAttachmentTaskFilter = normalizedTaskId ? 'AND l.task_id = ?' : '';
  if (normalizedTaskId) logAttachmentParams.push(normalizedTaskId);
  const [logAttachmentRows] = await getPool().query(
    `
      SELECT
        a.*,
        l.task_id,
        t.title AS task_title,
        l.content AS owner_title,
        c.text AS cached_text
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      JOIN tasks t ON t.id = l.task_id
      LEFT JOIN attachment_text_cache c
        ON c.attachment_kind = 'log' AND c.attachment_id = a.id
      WHERE a.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND ${logAttachmentLike.sql} ${logAttachmentTaskFilter}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `,
    [...logAttachmentParams, normalizedLimit],
  );
  hits.push(...logAttachmentRows.map((row) => withMatchedFields(
    attachmentNode(row, 'log_attachment', 'log_id'),
    matchedFieldsFor(terms, {
      '文件名': row.original_name,
      '附件备注': row.note,
      '附件文字': row.cached_text,
      '日志内容': row.owner_title,
      '关联任务': row.task_title,
    }),
    0.7,
  )));

  const noteAttachmentLike = likeClause(['a.original_name', 'a.note', 'c.text', 'n.title', 'n.content', 't.title'], terms);
  const noteAttachmentParams = [...noteAttachmentLike.params];
  const noteAttachmentTaskFilter = normalizedTaskId ? 'AND n.task_id = ?' : '';
  if (normalizedTaskId) noteAttachmentParams.push(normalizedTaskId);
  const [noteAttachmentRows] = await getPool().query(
    `
      SELECT
        a.*,
        n.task_id,
        t.title AS task_title,
        n.title AS owner_title,
        c.text AS cached_text
      FROM note_attachments a
      JOIN task_notes n ON n.id = a.note_id
      LEFT JOIN tasks t ON t.id = n.task_id
      LEFT JOIN attachment_text_cache c
        ON c.attachment_kind = 'note' AND c.attachment_id = a.id
      WHERE a.deleted_at IS NULL AND n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL) AND ${noteAttachmentLike.sql} ${noteAttachmentTaskFilter}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `,
    [...noteAttachmentParams, normalizedLimit],
  );
  hits.push(...noteAttachmentRows.map((row) => withMatchedFields(
    attachmentNode(row, 'note_attachment', 'note_id'),
    matchedFieldsFor(terms, {
      '文件名': row.original_name,
      '附件备注': row.note,
      '附件文字': row.cached_text,
      '笔记标题': row.owner_title,
      '关联任务': row.task_title,
    }),
    0.7,
  )));

  return hits.slice(0, normalizedLimit);
}

async function recentHits({ taskId = null, limit = 8 } = {}) {
  const normalizedTaskId = normalizeTaskId(taskId);
  const normalizedLimit = normalizeLimit(limit, 8, 20);
  const hits = [];

  if (normalizedTaskId) {
    const [taskRows] = await getPool().query('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [normalizedTaskId]);
    hits.push(...taskRows.map((row) => taskNode(row, 0.3)));
  } else {
    const [taskRows] = await getPool().query(
      `
        SELECT *
        FROM tasks
        WHERE deleted_at IS NULL
        ORDER BY FIELD(status, 'in_progress', 'todo', 'done'), updated_at DESC, id DESC
        LIMIT ?
      `,
      [Math.max(3, Math.ceil(normalizedLimit / 2))],
    );
    hits.push(...taskRows.map((row) => taskNode(row, 0.3)));
  }

  const logParams = [];
  const logTaskFilter = normalizedTaskId ? 'AND l.task_id = ?' : '';
  if (normalizedTaskId) logParams.push(normalizedTaskId);
  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL ${logTaskFilter}
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT ?
    `,
    [...logParams, Math.max(2, Math.floor(normalizedLimit / 3))],
  );
  hits.push(...logRows.map((row) => logNode(row, 0.28)));

  const noteParams = [];
  const noteTaskFilter = normalizedTaskId ? 'AND n.task_id = ?' : '';
  if (normalizedTaskId) noteParams.push(normalizedTaskId);
  const [noteRows] = await getPool().query(
    `
      SELECT n.*, t.title AS task_title
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.deleted_at IS NULL AND (n.task_id IS NULL OR t.deleted_at IS NULL) ${noteTaskFilter}
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT ?
    `,
    [...noteParams, Math.max(2, Math.floor(normalizedLimit / 3))],
  );
  hits.push(...noteRows.map((row) => noteNode(row, 0.26)));

  return hits.slice(0, normalizedLimit);
}

async function incompleteTaskHits(options = {}) {
  const normalizedTaskId = normalizeTaskId(options.taskId);
  const params = [];
  const where = ["status <> 'done'", 'deleted_at IS NULL'];
  if (normalizedTaskId) {
    where.push('id = ?');
    params.push(normalizedTaskId);
  }

  const [rows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE ${where.join(' AND ')}
      ORDER BY FIELD(status, 'in_progress', 'todo'), due_date IS NULL, due_date ASC, sort_order ASC, updated_at DESC
      LIMIT 20
    `,
    params,
  );
  return rows.map((row) => withSourceReason(taskNode(row, 0.95), '未完成任务'));
}

async function answerIncompleteTasks(question, options = {}) {
  if (!isIncompleteTaskQuestion(question)) return null;

  const hits = await incompleteTaskHits(options);
  const sources = hits.map(toSource);
  if (!hits.length) {
    return {
      answer: '<section class="ai-fact-panel"><h3>数据库事实</h3><p>当前任务台没有未完成任务。</p></section>',
      sources: [],
      grounded: true,
      intent: 'incomplete_tasks',
      facts: [],
      suggestions: [],
      actionRequests: [],
    };
  }

  const statusLabel = {
    todo: '待办',
    in_progress: '进行中',
    done: '已完成',
  };
  const priorityLabel = {
    low: '低',
    medium: '中',
    high: '高',
  };
  const statusCounts = hits.reduce((counts, hit) => {
    const status = hit.metadata?.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const averageProgress = Math.round(
    hits.reduce((sum, hit) => sum + Number(hit.metadata?.progress || 0), 0) / hits.length,
  );
  const metrics = [
    ['未完成任务', hits.length],
    ['进行中', statusCounts.in_progress || 0],
    ['待办', statusCounts.todo || 0],
    ['平均进度', `${averageProgress}%`],
  ].map(([label, value]) => (
    `<section class="ai-metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></section>`
  )).join('');

  const cards = hits.map((hit, index) => {
    const metadata = hit.metadata || {};
    const status = metadata.status;
    const priority = metadata.priority;
    const progress = Math.max(0, Math.min(100, Number(metadata.progress || 0)));
    const dueDate = metadata.dueDate;
    const title = metadata.title || `任务 #${metadata.entityId}`;
    return [
      '<section class="ai-task-panel-card">',
      '<header>',
      `<span class="ai-task-index">${index + 1}</span>`,
      `<strong>${escapeHtml(title)}</strong>`,
      `<em>[${index + 1}]</em>`,
      '</header>',
      '<dl class="ai-task-meta">',
      `<dt>状态</dt><dd><span class="ai-badge status-${escapeHtml(status || 'unknown')}">${escapeHtml(statusLabel[status] || status || '未知')}</span></dd>`,
      `<dt>优先级</dt><dd>${escapeHtml(priorityLabel[priority] || priority || '未设置')}</dd>`,
      `<dt>进度</dt><dd><progress value="${progress}" max="100">${progress}%</progress><span>${progress}%</span></dd>`,
      dueDate ? `<dt>截止</dt><dd>${escapeHtml(dueDate)}</dd>` : '',
      '</dl>',
      '</section>',
    ].filter(Boolean).join('');
  }).join('');

  return {
    answer: [
      '<section class="ai-fact-panel">',
      '<h3>数据库事实</h3>',
      `<p>你当前还有 <strong>${hits.length}</strong> 个未完成任务，需要继续跟进。</p>`,
      `<section class="ai-metric-grid">${metrics}</section>`,
      '</section>',
      `<section class="ai-task-grid">${cards}</section>`,
    ].join(''),
    sources,
    grounded: true,
    intent: 'incomplete_tasks',
    facts: hits.map((hit) => ({
      type: 'task',
      id: Number(hit.metadata.entityId),
      title: hit.metadata.title,
      status: hit.metadata.status,
      progress: hit.metadata.progress,
    })),
    suggestions: [],
    actionRequests: [],
  };
}

const statusLabels = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
};

const priorityLabels = {
  low: '低',
  medium: '中',
  high: '高',
};

function taskMetricsHtml(items, { includeTotal = true } = {}) {
  const counts = items.reduce((result, item) => {
    const status = item.metadata?.status || 'unknown';
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const averageProgress = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.metadata?.progress || 0), 0) / items.length)
    : 0;
  const metrics = [
    includeTotal ? ['全部任务', items.length] : null,
    ['进行中', counts.in_progress || 0],
    ['待办', counts.todo || 0],
    ['平均进度', `${averageProgress}%`],
  ].filter(Boolean);
  return metrics.map(([label, value]) => (
    `<section class="ai-metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></section>`
  )).join('');
}

function taskCardsHtml(items) {
  return items.map((hit, index) => {
    const metadata = hit.metadata || {};
    const progress = Math.max(0, Math.min(100, Number(metadata.progress || 0)));
    return [
      '<section class="ai-task-panel-card">',
      '<header>',
      `<span class="ai-task-index">${index + 1}</span>`,
      `<strong>${escapeHtml(metadata.title || `任务 #${metadata.entityId}`)}</strong>`,
      `<em>[${index + 1}]</em>`,
      '</header>',
      '<dl class="ai-task-meta">',
      `<dt>状态</dt><dd><span class="ai-badge status-${escapeHtml(metadata.status || 'unknown')}">${escapeHtml(statusLabels[metadata.status] || '未知')}</span></dd>`,
      `<dt>优先级</dt><dd>${escapeHtml(priorityLabels[metadata.priority] || '未设置')}</dd>`,
      `<dt>进度</dt><dd><progress value="${progress}" max="100">${progress}%</progress><span>${progress}%</span></dd>`,
      metadata.dueDate ? `<dt>截止日期</dt><dd>${escapeHtml(metadata.dueDate)}</dd>` : '',
      '</dl>',
      '</section>',
    ].filter(Boolean).join('');
  }).join('');
}

async function answerTaskOverview(question, options = {}) {
  if (!isTaskOverviewQuestion(question)) return null;
  const taskId = normalizeTaskId(options.taskId);
  const params = [];
  const taskFilter = taskId ? 'AND id = ?' : '';
  if (taskId) params.push(taskId);
  const [rows] = await getPool().query(
    `
      SELECT *
      FROM tasks
      WHERE deleted_at IS NULL ${taskFilter}
      ORDER BY FIELD(status, 'in_progress', 'todo', 'done'), sort_order ASC, updated_at DESC
      LIMIT 50
    `,
    params,
  );
  const hits = rows.map((row) => withSourceReason(
    withMatchedFields(taskNode(row, 0.98), ['任务状态', '任务进度'], 0.98),
    '任务总览',
  ));
  if (!hits.length) {
    return {
      answer: '<section class="ai-fact-panel"><h3>数据库事实</h3><p>当前任务台还没有任务。</p></section>',
      sources: [],
      grounded: true,
      intent: 'task_overview',
      facts: [],
      suggestions: [],
      actionRequests: [],
    };
  }
  const doneCount = hits.filter((hit) => hit.metadata.status === 'done').length;
  return {
    answer: [
      '<section class="ai-fact-panel">',
      '<h3>数据库事实</h3>',
      `<p>当前共有 <strong>${hits.length}</strong> 个任务，其中已完成 <strong>${doneCount}</strong> 个。</p>`,
      `<section class="ai-metric-grid">${taskMetricsHtml(hits)}</section>`,
      '</section>',
      `<section class="ai-task-grid">${taskCardsHtml(hits)}</section>`,
    ].join(''),
    sources: hits.map(toSource),
    grounded: true,
    intent: 'task_overview',
    facts: hits.map((hit) => ({
      type: 'task',
      id: Number(hit.metadata.entityId),
      title: hit.metadata.title,
      status: hit.metadata.status,
      progress: hit.metadata.progress,
    })),
    suggestions: [],
    actionRequests: [],
  };
}

async function logPeriodHits(intent, options = {}) {
  const taskId = normalizeTaskId(options.taskId);
  const params = [];
  const taskFilter = taskId ? 'AND l.task_id = ?' : '';
  if (taskId) params.push(taskId);
  const dateFilter = intent === 'log_today'
    ? 'l.log_date = CURDATE()'
    : 'YEARWEEK(l.log_date, 1) = YEARWEEK(CURDATE(), 1)';
  const [rows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND ${dateFilter} ${taskFilter}
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT 100
    `,
    params,
  );
  return rows.map((row) => withSourceReason(
    withMatchedFields(logNode(row, 0.96), ['日志日期', '日志内容'], 0.96),
    intent === 'log_today' ? '今日日志' : '本周日志',
  ));
}

async function answerLogPeriod(question, options = {}) {
  const intent = isTodayLogQuestion(question) ? 'log_today' : isWeekLogQuestion(question) ? 'log_week' : null;
  if (!intent) return null;
  const hits = await logPeriodHits(intent, options);
  const periodLabel = intent === 'log_today' ? '今天' : '本周';
  if (!hits.length) {
    return {
      answer: `<section class="ai-fact-panel"><h3>数据库事实</h3><p>${periodLabel}还没有工作日志记录。</p></section>`,
      sources: [],
      grounded: true,
      intent,
      facts: [],
      suggestions: [],
      actionRequests: [],
    };
  }
  const totalHours = hits.reduce((sum, hit) => sum + Number(hit.metadata?.hours || 0), 0);
  const taskCount = new Set(hits.map((hit) => hit.metadata?.taskId).filter(Boolean)).size;
  const rows = hits.map((hit, index) => {
    const metadata = hit.metadata || {};
    return [
      '<tr>',
      `<td>${index + 1}</td>`,
      `<td>${escapeHtml(metadata.logDate || '')}</td>`,
      `<td>${escapeHtml(metadata.title || '')}</td>`,
      `<td>${escapeHtml(metadata.content || hit.text)}</td>`,
      `<td>${escapeHtml(Number(metadata.hours || 0))} 小时</td>`,
      `<td>[${index + 1}]</td>`,
      '</tr>',
    ].join('');
  }).join('');
  return {
    answer: [
      '<section class="ai-fact-panel">',
      '<h3>数据库事实</h3>',
      `<p>${periodLabel}记录了 <strong>${hits.length}</strong> 条日志，涉及 <strong>${taskCount}</strong> 个任务，总耗时 <strong>${totalHours.toFixed(2)}</strong> 小时。</p>`,
      '<section class="ai-metric-grid">',
      `<section class="ai-metric-card"><span>日志条数</span><strong>${hits.length}</strong></section>`,
      `<section class="ai-metric-card"><span>涉及任务</span><strong>${taskCount}</strong></section>`,
      `<section class="ai-metric-card"><span>总耗时</span><strong>${totalHours.toFixed(2)}h</strong></section>`,
      '</section>',
      '</section>',
      '<table><thead><tr><th>#</th><th>日期</th><th>任务</th><th>工作内容</th><th>耗时</th><th>来源</th></tr></thead>',
      `<tbody>${rows}</tbody></table>`,
    ].join(''),
    sources: hits.map(toSource),
    grounded: true,
    intent,
    facts: hits.map((hit) => ({
      type: 'log',
      id: Number(hit.metadata.entityId),
      taskId: hit.metadata.taskId,
      date: hit.metadata.logDate,
      hours: Number(hit.metadata.hours || 0),
    })),
    suggestions: [],
    actionRequests: [],
  };
}

function taskTitleMatchScore(row, question) {
  const title = compactText(row.title);
  const text = compactText(question);
  if (!title || !text.includes(title)) return 0;
  return 1000 + title.length;
}

async function resolveQuestionTask(question, taskId = null) {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (normalizedTaskId) {
    const [[row]] = await getPool().query(
      'SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL',
      [normalizedTaskId],
    );
    return row || null;
  }
  const [rows] = await getPool().query(
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 200',
  );
  return rows
    .map((row) => ({ row, score: taskTitleMatchScore(row, question) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.row || null;
}

async function taskDetailContext(question, options = {}) {
  const task = await resolveQuestionTask(question, options.taskId);
  if (!task) return null;
  const taskHit = withSourceReason(
    withMatchedFields(taskNode(task, 1), ['任务标题', '任务状态', '任务进度'], 1),
    '任务标题匹配',
  );
  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.task_id = ? AND l.deleted_at IS NULL
      ORDER BY l.log_date DESC, l.id DESC
      LIMIT 8
    `,
    [task.id],
  );
  const [noteRows] = await getPool().query(
    `
      SELECT n.*, t.title AS task_title
      FROM task_notes n
      JOIN tasks t ON t.id = n.task_id
      WHERE n.task_id = ? AND n.deleted_at IS NULL
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT 5
    `,
    [task.id],
  );
  const [attachmentRows] = await getPool().query(
    `
      SELECT a.*, t.title AS task_title, t.title AS owner_title, c.text AS cached_text
      FROM task_attachments a
      JOIN tasks t ON t.id = a.task_id
      LEFT JOIN attachment_text_cache c
        ON c.attachment_kind = 'task' AND c.attachment_id = a.id
      WHERE a.task_id = ? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 6
    `,
    [task.id],
  );
  const logs = logRows.map((row) => withSourceReason(
    withMatchedFields(logNode(row, 0.9), ['关联任务', '日志内容'], 0.9),
    '该任务的最近日志',
  ));
  const notes = noteRows.map((row) => withSourceReason(
    withMatchedFields(noteNode(row, 0.78), ['关联任务'], 0.78),
    '关联任务笔记',
  ));
  const attachments = attachmentRows.map((row) => withSourceReason(
    withMatchedFields(attachmentNode(row, 'task_attachment', 'task_id', 0.76), ['关联任务'], 0.76),
    '任务附件',
  ));
  return { task, taskHit, logs, notes, attachments };
}

async function answerTaskProgress(question, options = {}) {
  const intent = classifyAiQueryIntent(question);
  if (/下一步|建议|复盘|分析|风险|计划|提取|应该|怎么做/.test(String(question || ''))) return null;
  if (intent !== 'task_progress' && intent !== 'task_note' && !options.taskId) return null;
  const detail = await taskDetailContext(question, options);
  if (!detail) return null;
  const { task, taskHit, logs, notes, attachments } = detail;
  const hits = [taskHit, ...logs, ...notes, ...attachments];
  const latestLog = logs[0]?.metadata;
  const nextSteps = uniqueValues(logs.map((hit) => hit.metadata?.nextStep).filter(Boolean));
  const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
  const logItems = logs.slice(0, 4).map((hit, index) => (
    `<li><strong>${escapeHtml(hit.metadata.logDate || '')}</strong> ${escapeHtml(hit.metadata.content || '')} <em>[${index + 2}]</em></li>`
  )).join('');
  return {
    answer: [
      '<section class="ai-fact-panel">',
      '<h3>数据库事实</h3>',
      `<p><strong>${escapeHtml(task.title)}</strong> 当前为“${escapeHtml(statusLabels[task.status] || task.status)}”，进度 <strong>${progress}%</strong>。[1]</p>`,
      '<dl>',
      `<dt>优先级</dt><dd>${escapeHtml(priorityLabels[task.priority] || task.priority || '未设置')}</dd>`,
      `<dt>截止日期</dt><dd>${escapeHtml(task.due_date || '未设置')}</dd>`,
      `<dt>任务说明</dt><dd>${escapeHtml(task.description || '未填写')}</dd>`,
      `<dt>日志数量</dt><dd>${logs.length}</dd>`,
      `<dt>任务笔记</dt><dd>${notes.length}</dd>`,
      `<dt>任务附件</dt><dd>${attachments.length}</dd>`,
      '</dl>',
      `<p><progress value="${progress}" max="100">${progress}%</progress></p>`,
      '</section>',
      logItems ? `<section class="ai-data-section"><h3>最近日志</h3><ul>${logItems}</ul></section>` : '',
      nextSteps.length ? `<section class="ai-data-section"><h3>数据库中的下一步</h3><ul>${nextSteps.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '',
      !latestLog ? '<section class="ai-data-section"><p>这个任务暂时没有工作日志。</p></section>' : '',
    ].filter(Boolean).join(''),
    sources: hits.map(toSource),
    grounded: true,
    intent: 'task_progress',
    facts: [{
      type: 'task_detail',
      id: Number(task.id),
      title: task.title,
      status: task.status,
      progress,
      logCount: logs.length,
      noteCount: notes.length,
      attachmentCount: attachments.length,
    }],
    suggestions: [],
    actionRequests: [],
  };
}

async function answerAttachmentQuestion(question, options = {}) {
  if (classifyAiQueryIntent(question) !== 'attachment_search') return null;
  let hits = (await keywordHits(question, { ...options, limit: 10 }))
    .filter((hit) => hitEntityType(hit).endsWith('_attachment'));
  if (!hits.length) {
    const taskId = normalizeTaskId(options.taskId);
    const params = [];
    const taskFilter = taskId ? 'AND t.id = ?' : '';
    if (taskId) params.push(taskId);
    const [rows] = await getPool().query(
      `
        SELECT a.*, t.title AS task_title, t.title AS owner_title, c.text AS cached_text
        FROM task_attachments a
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN attachment_text_cache c
          ON c.attachment_kind = 'task' AND c.attachment_id = a.id
        WHERE a.deleted_at IS NULL AND t.deleted_at IS NULL ${taskFilter}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 8
      `,
      params,
    );
    hits = rows.map((row) => withMatchedFields(
      attachmentNode(row, 'task_attachment', 'task_id', 0.55),
      ['最近任务附件'],
      0.55,
    ));
  }
  if (!hits.length) return null;
  const relevantHits = dedupeHits(hits).slice(0, 8).map((hit) => withSourceReason(hit, '附件名称或识别文字匹配'));
  const cards = relevantHits.map((hit, index) => {
    const metadata = hit.metadata || {};
    const content = cleanText(hit.text.replace(/^附件：[^ ]+\s*/, '')).slice(0, 420);
    return [
      '<section class="ai-file-panel">',
      `<h3>${escapeHtml(metadata.fileName || metadata.title || `附件 ${index + 1}`)}</h3>`,
      `<p>${escapeHtml(content || '数据库中没有可用的附件文字。')}</p>`,
      `<small>[${index + 1}]</small>`,
      '</section>',
    ].join('');
  }).join('');
  return {
    answer: `<section class="ai-fact-panel"><h3>数据库事实</h3><p>找到 <strong>${relevantHits.length}</strong> 个相关附件。</p></section>${cards}`,
    sources: relevantHits.map(toSource),
    grounded: true,
    intent: 'attachment_search',
    facts: relevantHits.map((hit) => ({
      type: 'attachment',
      id: Number(hit.metadata.entityId),
      fileName: hit.metadata.fileName,
      parser: hit.metadata.parser || null,
    })),
    suggestions: [],
    actionRequests: [],
  };
}

async function answerDeterministicQuestion(question, options = {}) {
  return (await answerIncompleteTasks(question, options))
    || (await answerTaskOverview(question, options))
    || (await answerLogPeriod(question, options))
    || (await answerTaskProgress(question, options))
    || (await answerAttachmentQuestion(question, options));
}

function hitEntityType(hit) {
  return String(hit?.metadata?.entityType || '').trim();
}

function hitTaskId(hit) {
  const value = hit?.metadata?.taskId;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function withSourceReason(hit, reason) {
  return {
    ...hit,
    metadata: {
      ...(hit.metadata || {}),
      reason,
    },
  };
}

function defaultSourceReason(entityType) {
  if (entityType === 'task') return '任务匹配';
  if (entityType === 'log') return '任务日志匹配';
  if (entityType === 'task_attachment') return '任务附件匹配';
  if (entityType === 'log_attachment') return '日志附件匹配';
  if (entityType === 'note') return '笔记匹配';
  if (entityType === 'note_attachment') return '笔记附件匹配';
  return '相关资料';
}

function dedupeHits(hits) {
  const seen = new Set();
  const result = [];
  for (const hit of hits) {
    const key = String(hit?.metadata?.documentId || hit?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

function hasStrongKeywordMatch(hit, keywords) {
  if (!keywords.length) return false;
  const haystack = compactText([
    hit?.text,
    hit?.metadata?.title,
    hit?.metadata?.category,
    hit?.metadata?.fileName,
  ].filter(Boolean).join(' '));
  return keywords.some((keyword) => keyword.length >= 2 && haystack.includes(compactText(keyword)));
}

function filterHitsForIntent(hits, question, intent = classifyAiQueryIntent(question)) {
  const dedupedHits = dedupeHits(hits);
  if (isNoteLikeIntent(intent)) {
    return dedupedHits
      .filter((hit) => noteSourceTypes.has(hitEntityType(hit)))
      .map((hit) => withSourceReason(hit, defaultSourceReason(hitEntityType(hit))));
  }

  if (!isTaskLikeIntent(intent)) {
    return dedupedHits.map((hit) => withSourceReason(hit, defaultSourceReason(hitEntityType(hit))));
  }

  const strongKeywords = extractStrongKeywords(question);
  const matchedTaskIds = new Set(
    dedupedHits
      .filter((hit) => taskSourceTypes.has(hitEntityType(hit)))
      .map(hitTaskId)
      .filter(Boolean),
  );

  return dedupedHits
    .map((hit) => {
      const entityType = hitEntityType(hit);
      if (taskSourceTypes.has(entityType)) {
        return withSourceReason(hit, defaultSourceReason(entityType));
      }
      if (!noteSourceTypes.has(entityType)) return null;

      const taskId = hitTaskId(hit);
      if (taskId && matchedTaskIds.has(taskId)) {
        return withSourceReason(hit, entityType === 'note' ? '关联任务笔记' : '关联任务笔记附件');
      }
      if (hasStrongKeywordMatch(hit, strongKeywords)) {
        return withSourceReason(hit, entityType === 'note' ? '笔记强匹配' : '笔记附件强匹配');
      }
      return null;
    })
    .filter(Boolean);
}

async function retrieveWorkspaceHits(question, options = {}) {
  const intent = options.intent || classifyAiQueryIntent(question);
  const limit = normalizeLimit(options.limit, 8, 20);
  const keywordResults = filterHitsForIntent(await keywordHits(question, { ...options, limit }), question, intent);
  let semanticResults = [];
  try {
    semanticResults = filterHitsForIntent(
      await retrieveRelevantNodes(question, { ...options, limit }),
      question,
      intent,
    ).map((hit) => withSourceReason(hit, hit.metadata?.reason || '语义内容匹配'));
  } catch {
    // Semantic search is optional; MySQL remains the primary source of truth.
  }

  const combined = dedupeHits([...keywordResults, ...semanticResults]).slice(0, limit);
  if (combined.length) return combined;
  if (isTaskLikeIntent(intent)) return [];
  if (isNoteLikeIntent(intent)) {
    return filterHitsForIntent(await recentHits({ ...options, limit }), question, intent);
  }
  if (intent !== 'general') return [];
  return filterHitsForIntent(await recentHits({ ...options, limit }), question, intent);
}

async function createAnswerContext(question, options = {}) {
  const intent = options.intent || classifyAiQueryIntent(question);
  const hits = await retrieveWorkspaceHits(question, { ...options, intent, limit: normalizeLimit(options.limit, 6, 12) });
  const additionalContext = String(options.additionalContext || '').trim();
  const databaseContext = hits
    .map((hit, index) => `[${index + 1}] ${hit.text.slice(0, 1800)}`)
    .join('\n\n');
  return {
    intent,
    hits,
    sources: hits.map(toSource),
    context: [
      databaseContext,
      additionalContext ? `[微信临时资料]\n${additionalContext.slice(0, 12000)}` : '',
    ].filter(Boolean).join('\n\n'),
    hasAdditionalContext: Boolean(additionalContext),
  };
}

function buildAnswerMessages(question, context, history = [], intent = 'general') {
  return [
    { role: 'system', content: workspaceAssistantPrompt },
    ...normalizeChatHistory(history),
    {
      role: 'user',
      content: `问题意图：${intent}\n当前问题：${question}\n\n任务台数据库资料：\n${context}\n\n请先给出“数据库事实”；如果问题需要判断、规划或下一步，再单独给出“AI 建议”。`,
    },
  ];
}

function parseOpenAiStreamEvent(block, onDelta) {
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  for (const data of dataLines) {
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data);
    const choice = payload.choices?.[0] || {};
    const delta = choice.delta?.content ?? choice.message?.content ?? choice.text ?? '';
    if (delta) onDelta(delta);
  }
}

async function readOpenAiStream(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      if (block.trim()) parseOpenAiStreamEvent(block, onDelta);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) parseOpenAiStreamEvent(buffer, onDelta);
}

export async function searchWorkspace(question, options = {}) {
  const intent = options.intent || classifyAiQueryIntent(question);
  const deterministic = await answerDeterministicQuestion(question, { ...options, intent });
  if (deterministic) return deterministic.sources;
  const hits = await retrieveWorkspaceHits(question, { ...options, intent });
  return hits.map(toSource);
}

export async function answerWorkspace(question, options = {}) {
  const deterministic = options.additionalContext
    ? null
    : await answerDeterministicQuestion(question, options);
  if (deterministic) return deterministic;

  const { hits, sources, context, intent, hasAdditionalContext } = await createAnswerContext(question, options);
  if (!hits.length && !hasAdditionalContext) {
    return {
      answer: isTaskLikeIntent(intent) ? noTaskContextAnswer : noWorkspaceContextAnswer,
      sources: [],
      grounded: false,
      intent,
      facts: [],
      suggestions: [],
      actionRequests: [],
    };
  }

  const response = await getChatModel().chat({
    messages: buildAnswerMessages(question, context, options.messages, intent),
  });
  const answer = messageToText(response.message.content) || emptyModelAnswer;
  return {
    answer,
    sources,
    grounded: Boolean(hits.length || hasAdditionalContext),
    intent,
    facts: sources.map((source) => ({
      type: source.entityType,
      id: source.entityId,
      reason: source.reason,
      matchedFields: source.matchedFields,
    })),
    suggestions: [],
    actionRequests: [],
  };
}

export async function streamAnswerWorkspace(question, options = {}, handlers = {}) {
  const deterministic = options.additionalContext
    ? null
    : await answerDeterministicQuestion(question, options);
  if (deterministic) {
    handlers.onIntent?.(deterministic.intent);
    handlers.onSources?.(deterministic.sources);
    handlers.onDelta?.(deterministic.answer);
    handlers.onDone?.({
      grounded: deterministic.grounded,
      intent: deterministic.intent,
      facts: deterministic.facts,
      suggestions: deterministic.suggestions,
      actionRequests: deterministic.actionRequests,
    });
    return deterministic;
  }

  const { hits, sources, context, intent, hasAdditionalContext } = await createAnswerContext(question, options);
  handlers.onIntent?.(intent);
  handlers.onSources?.(sources);

  if (!hits.length && !hasAdditionalContext) {
    const answer = isTaskLikeIntent(intent) ? noTaskContextAnswer : noWorkspaceContextAnswer;
    handlers.onDelta?.(answer);
    handlers.onDone?.({ grounded: false, intent, facts: [], suggestions: [], actionRequests: [] });
    return { answer, sources: [], grounded: false, intent, facts: [], suggestions: [], actionRequests: [] };
  }

  const payload = {
    model: config.ai.litellm.chatModel,
    temperature: 0.2,
    stream: true,
    messages: buildAnswerMessages(question, context, options.messages, intent),
  };

  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }

  let answer = '';
  try {
    const response = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.litellm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(errorText || `LiteLLM stream failed with status ${response.status}.`);
    }

    await readOpenAiStream(response.body, (delta) => {
      answer += delta;
      handlers.onDelta?.(delta);
    });
  } catch (error) {
    if (answer || error.name === 'AbortError') throw error;
    const fallback = await answerWorkspace(question, options);
    handlers.onSources?.(fallback.sources);
    handlers.onDelta?.(fallback.answer);
    handlers.onDone?.({
      grounded: fallback.grounded,
      intent: fallback.intent,
      facts: fallback.facts,
      suggestions: fallback.suggestions,
      actionRequests: fallback.actionRequests,
      fallback: true,
    });
    return fallback;
  }

  if (!answer.trim()) {
    answer = emptyModelAnswer;
    handlers.onDelta?.(answer);
  }
  const facts = sources.map((source) => ({
    type: source.entityType,
    id: source.entityId,
    reason: source.reason,
    matchedFields: source.matchedFields,
  }));
  const grounded = Boolean(hits.length || hasAdditionalContext);
  handlers.onDone?.({ grounded, intent, facts, suggestions: [], actionRequests: [] });
  return { answer, sources, grounded, intent, facts, suggestions: [], actionRequests: [] };
}
