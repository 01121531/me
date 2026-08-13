import { config } from '../config.js';
import { getTask } from '../mcp/read-tools.js';

function chatCompletionsUrl() {
  const baseUrl = String(config.ai.litellm.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('LiteLLM requires LITELLM_BASE_URL.');
  return `${baseUrl}/chat/completions`;
}

function compactText(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function summarizeAttachments(attachments = []) {
  return attachments.slice(0, 12).map((attachment) => ({
    fileName: attachment.originalName,
    mimeType: attachment.mimeType,
    note: compactText(attachment.note, 300),
    textStatus: attachment.textStatus,
    textChars: attachment.textChars,
    textTruncated: attachment.textTruncated,
  }));
}

function buildTaskPayload(taskContext) {
  return {
    task: {
      id: taskContext.task.id,
      title: taskContext.task.title,
      description: compactText(taskContext.task.description, 1600),
      status: taskContext.task.status,
      priority: taskContext.task.priority,
      progress: taskContext.task.progress,
      dueDate: taskContext.task.dueDate,
      tags: taskContext.task.tags,
      createdAt: taskContext.task.createdAt,
      updatedAt: taskContext.task.updatedAt,
    },
    counts: taskContext.counts,
    recentLogs: (taskContext.recentLogs || []).map((log) => ({
      logDate: log.logDate,
      stage: log.stage,
      content: compactText(log.content, 1000),
      nextStep: compactText(log.nextStep, 700),
      hours: log.hours,
      progressSnapshot: log.progressSnapshot,
      attachments: summarizeAttachments(log.attachments),
    })),
    notes: (taskContext.notes || []).map((note) => ({
      title: note.title,
      category: note.category,
      content: compactText(note.content, 1000),
      updatedAt: note.updatedAt,
      attachments: summarizeAttachments(note.attachments),
    })),
    taskAttachments: summarizeAttachments(taskContext.taskAttachments),
  };
}

function buildMessages(taskContext) {
  return [
    {
      role: 'system',
      content: [
        '你是个人助理任务台的任务复盘助手。',
        '只能根据提供的任务、日志、笔记和附件元信息做总结，不要编造任务、进度、日期、耗时、附件内容或下一步。',
        '输出可嵌入页面的安全 HTML 片段，不要完整 html/head/body。',
        '不要输出 Markdown，不要使用 script、style、iframe、form、input、button 或事件属性。',
        '可使用 section、h3、h4、p、strong、em、ul、ol、li、table、thead、tbody、tr、th、td、dl、dt、dd、blockquote、code、pre、br、progress。',
        '允许使用这些 class：ai-summary-panel、ai-metric-grid、ai-metric-card、ai-task-grid、ai-task-panel-card、ai-task-meta、ai-badge、status-todo、status-in_progress、status-done、status-unknown。',
        '建议结构：任务总览数据面板、当前进展、关键日志、笔记要点、附件情况、风险/阻塞、下一步建议。',
        '进度条必须写 max="100" 和 value="当前数字"。',
        '如果资料不足，请明确说明缺少什么，不要补全虚构内容。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `请根据以下单个任务资料，生成完整进展总结：\n${JSON.stringify(buildTaskPayload(taskContext), null, 2)}`,
    },
  ];
}

export async function summarizeTaskWithAi(taskId) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }

  const taskContext = await getTask(taskId);
  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.2,
      messages: buildMessages(taskContext),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `LiteLLM request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const html = String(payload.choices?.[0]?.message?.content || '').trim();
  if (!html) throw new Error('AI 没有返回可用任务总结。');

  return {
    taskId: Number(taskId),
    html,
    metrics: {
      status: taskContext.task.status,
      progress: taskContext.task.progress,
      logs: taskContext.counts.logs,
      notes: taskContext.counts.notes,
      taskAttachments: taskContext.counts.taskAttachments,
    },
  };
}
