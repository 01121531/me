import { config } from '../config.js';
import { getTask } from '../mcp/read-tools.js';
import { PRIORITIES, toDateOrNull, toNullableText, toPriority } from '../validators.js';

function chatCompletionsUrl() {
  const baseUrl = String(config.ai.litellm.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('LiteLLM requires LITELLM_BASE_URL.');
  return `${baseUrl}/chat/completions`;
}

function parseModelJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const candidate = firstBrace >= 0 && lastBrace > firstBrace
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;
  return JSON.parse(candidate);
}

function compactText(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildSuggestionMessages(taskContext, limit) {
  const context = {
    task: taskContext.task,
    recentLogs: (taskContext.recentLogs || []).map((log) => ({
      logDate: log.logDate,
      stage: log.stage,
      content: compactText(log.content, 900),
      nextStep: compactText(log.nextStep, 500),
      hours: log.hours,
      progressSnapshot: log.progressSnapshot,
    })),
    notes: (taskContext.notes || []).map((note) => ({
      title: note.title,
      category: note.category,
      content: compactText(note.content, 900),
    })),
    taskAttachments: (taskContext.taskAttachments || []).map((attachment) => ({
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
      note: attachment.note,
      textStatus: attachment.textStatus,
      textChars: attachment.textChars,
    })),
  };

  return [
    {
      role: 'system',
      content: [
        '你是个人助理任务台的任务规划助手。',
        '只能根据提供的任务、日志、笔记和附件元信息提出“需要新建任务”的建议。',
        '不要编造事实；资料不足时返回空 suggestions 数组。',
        '只输出 JSON，不要 Markdown，不要 HTML。',
        `最多返回 ${limit} 条建议。`,
        'JSON 格式：{"suggestions":[{"title":"任务标题","description":"说明","priority":"low|medium|high","dueDate":"YYYY-MM-DD 或空字符串","tags":["标签"]}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `请根据以下任务资料，提出适合新建为后续任务的建议：\n${JSON.stringify(context, null, 2)}`,
    },
  ];
}

function normalizeSuggestion(item, index) {
  const title = toNullableText(item?.title);
  if (!title) return null;
  const priority = PRIORITIES.includes(item?.priority) ? item.priority : toPriority(item?.priority, 'medium');
  const tags = Array.isArray(item?.tags)
    ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8)
    : String(item?.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
  return {
    id: `suggestion-${index + 1}`,
    title: title.slice(0, 160),
    description: toNullableText(item?.description)?.slice(0, 3000) || '',
    priority,
    dueDate: toDateOrNull(item?.dueDate) || '',
    status: 'todo',
    progress: 0,
    tags,
  };
}

export async function suggestTasksFromTask(taskId, { limit = 5 } = {}) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }
  const normalizedLimit = Math.max(1, Math.min(8, Number(limit) || 5));
  const taskContext = await getTask(taskId);
  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.1,
      messages: buildSuggestionMessages(taskContext, normalizedLimit),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `LiteLLM request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content || '';
  const parsed = parseModelJson(text);
  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .map(normalizeSuggestion)
    .filter(Boolean)
    .slice(0, normalizedLimit);
  return { taskId: Number(taskId), suggestions };
}
