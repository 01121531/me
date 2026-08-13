import { config } from '../config.js';
import { getReportData } from '../report-data.js';

const reportTypes = new Set(['daily', 'weekly', 'stage']);

function chatCompletionsUrl() {
  const baseUrl = String(config.ai.litellm.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('LiteLLM requires LITELLM_BASE_URL.');
  return `${baseUrl}/chat/completions`;
}

function normalizeReportType(value) {
  return reportTypes.has(value) ? value : 'daily';
}

function compactText(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function reportTypeLabel(type) {
  if (type === 'weekly') return '周报';
  if (type === 'stage') return '阶段总结';
  return '日报';
}

function buildReportPayload(report) {
  return {
    from: report.from,
    to: report.to,
    totalHours: report.totalHours,
    byTask: report.byTask,
    logs: report.logs.slice(0, 80).map((log) => ({
      taskTitle: log.taskTitle,
      logDate: log.logDate,
      stage: log.stage,
      content: compactText(log.content, 900),
      hours: log.hours,
      progressSnapshot: log.progressSnapshot,
      nextStep: compactText(log.nextStep, 500),
    })),
    activeTasks: report.activeTasks.slice(0, 60).map((task) => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      progress: task.progress,
      dueDate: task.dueDate,
      tags: task.tags,
    })),
    completedTasks: report.completedTasks.slice(0, 60).map((task) => ({
      title: task.title,
      priority: task.priority,
      progress: task.progress,
      updatedAt: task.updatedAt,
    })),
    nextSteps: report.nextSteps.slice(0, 40).map((log) => ({
      taskTitle: log.taskTitle,
      logDate: log.logDate,
      nextStep: compactText(log.nextStep, 500),
    })),
  };
}

function buildMessages(report, type) {
  const label = reportTypeLabel(type);
  return [
    {
      role: 'system',
      content: [
        '你是个人助理任务台的工作汇报助手。',
        '只能根据提供的报告数据生成总结；不要编造任务、日期、耗时、进度或下一步。',
        '输出可嵌入页面的安全 HTML 片段，不要完整 html/head/body。',
        '不要输出 Markdown，不要使用 script、style、iframe、form、input、button 或事件属性。',
        '可使用 section、h3、h4、p、strong、em、ul、ol、li、table、thead、tbody、tr、th、td、dl、dt、dd、blockquote、code、pre、br。',
        '建议结构：概览数据面板、完成内容、重点任务、风险/阻塞、下一步计划。',
        '如果没有日志或资料不足，请明确说明，不要补全虚构内容。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `请生成${label}，时间范围 ${report.from} 至 ${report.to}。\n报告数据：\n${JSON.stringify(buildReportPayload(report), null, 2)}`,
    },
  ];
}

export async function summarizeReportWithAi({ from, to, type = 'daily' } = {}) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }
  const report = await getReportData({ from, to });
  const normalizedType = normalizeReportType(type);
  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.2,
      messages: buildMessages(report, normalizedType),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `LiteLLM request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const html = String(payload.choices?.[0]?.message?.content || '').trim();
  if (!html) throw new Error('AI 没有返回可用总结。');

  return {
    type: normalizedType,
    from: report.from,
    to: report.to,
    html,
    metrics: {
      logs: report.logs.length,
      totalHours: report.totalHours,
      tasks: report.byTask.length,
      completedTasks: report.completedTasks.length,
      nextSteps: report.nextSteps.length,
    },
  };
}
