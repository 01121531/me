import { config } from '../config.js';
import { STATUSES, toNullableText, toProgress } from '../validators.js';

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
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(candidate);
}

function compactText(value, max = 6000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractTextFromRichDoc(doc) {
  const parts = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (node.type === 'fileAttachment' && node.attrs?.name) parts.push(`附件：${node.attrs.name}`);
    (node.content || []).forEach(visit);
    if (['paragraph', 'heading', 'fileAttachment'].includes(node.type)) parts.push('\n');
  };
  visit(doc);
  return parts.join(' ').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function notePlainText(note) {
  if (note.content_json) {
    try {
      const doc = typeof note.content_json === 'string' ? JSON.parse(note.content_json) : note.content_json;
      const text = extractTextFromRichDoc(doc);
      if (text) return text;
    } catch {
      // Fall back to plain content.
    }
  }
  return String(note.content || '').trim();
}

function progressForStatus(status, progress) {
  if (status === 'done') return 100;
  if (status === 'todo') return 0;
  return Math.max(0, Math.min(99, Number(progress || 0)));
}

function buildMessages({ task, note }) {
  const context = {
    task: {
      title: task.title,
      description: compactText(task.description, 1200),
      status: task.status,
      priority: task.priority,
      progress: progressForStatus(task.status, task.progress),
      dueDate: task.due_date || task.dueDate || '',
      tags: task.tags || '',
    },
    note: {
      title: note.title || '未命名笔记',
      category: note.category || '',
      content: compactText(notePlainText(note), 9000),
      updatedAt: note.updated_at || note.updatedAt || '',
    },
  };

  return [
    {
      role: 'system',
      content: [
        '你是个人助理任务台的工作日志草稿助手。',
        '你只根据提供的任务和单条笔记生成一条“待用户确认”的日志草稿，不要保存日志，不要创建任务。',
        '不要新增事实、联系人、金额、进度、日期或结论；如果笔记内容不足，保守总结。',
        '输出 JSON，不要 Markdown，不要 HTML，不要解释。',
        'JSON 格式：{"content":"工作内容","hours":0.25,"nextStep":"下一步计划或空字符串","stage":"todo|in_progress|done","progressSnapshot":0}',
        'content 要像真实工作日志，包含来源笔记标题和可执行/已完成内容，控制在 600 字以内。',
        'hours 只能是 0、0.25、0.5、1、1.5、2、3、4 之一；无法判断时用 0.25。',
        'stage 默认使用任务当前状态；progressSnapshot 默认使用任务当前进度。',
        'nextStep 只在笔记中有明确后续动作时填写，否则留空。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(context, null, 2),
    },
  ];
}

function normalizeDraft(parsed, task, note) {
  const content = toNullableText(parsed?.content)
    || `来源笔记：${note.title || '未命名笔记'}\n\n${compactText(notePlainText(note), 600)}`;
  const allowedHours = new Set([0, 0.25, 0.5, 1, 1.5, 2, 3, 4]);
  const rawHours = Number(parsed?.hours);
  const hours = allowedHours.has(rawHours) ? rawHours : 0.25;
  const stage = STATUSES.includes(parsed?.stage) ? parsed.stage : task.status;
  const progressSnapshot = toProgress(
    parsed?.progressSnapshot,
    progressForStatus(task.status, task.progress),
  );

  return {
    content: content.slice(0, 3000),
    hours,
    nextStep: (toNullableText(parsed?.nextStep) || '').slice(0, 1200),
    stage,
    progressSnapshot,
  };
}

export async function generateLogDraftFromNote({ task, note }) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }
  if (!notePlainText(note)) {
    throw new Error('笔记内容不能为空。');
  }

  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.1,
      messages: buildMessages({ task, note }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `LiteLLM request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content || '';
  return normalizeDraft(parseModelJson(text), task, note);
}
