import assert from 'node:assert/strict';
import http from 'node:http';

const modelCalls = [];
const modelServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const prompt = String(payload.messages?.at(-1)?.content || '');
  modelCalls.push({ prompt, stream: Boolean(payload.stream) });
  const detail = prompt.includes('1.50') ? '数据库记录耗时 1.50 小时。' : '已读取本次数据库查询结果。';
  const answer = `<section class="ai-fact-panel"><h3>数据库事实</h3><p>模型回答：${detail}</p></section>`;

  if (payload.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    for (const delta of [answer.slice(0, 36), answer.slice(36)]) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 'chatcmpl-ai-smoke',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: payload.model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
});

await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
process.env.LITELLM_BASE_URL = `http://127.0.0.1:${modelPort}/v1`;
process.env.LITELLM_API_KEY = 'ai-smoke-key';
process.env.LITELLM_CHAT_MODEL = 'ai-smoke-model';
process.env.AI_INDEXING_ENABLED = 'false';

const [{ planAiActionRequest }, { answerWorkspace, classifyAiQueryIntent, streamAnswerWorkspace }, { closePool, ensureDatabase, getPool }] = await Promise.all([
  import('../ai/action-planner.js'),
  import('../ai/search.js'),
  import('../db.js'),
]);

const marker = `__ai_chat_smoke_${Date.now()}__`;
let taskId;
let logId;
let taskNoteId;
let independentNoteId;
let taskAttachmentId;
let noteAttachmentId;
let actionId;

try {
  await ensureDatabase();
  const db = getPool();
  const [taskResult] = await db.query(
    `
      INSERT INTO tasks (title, description, priority, progress, status, tags, sort_order)
      VALUES (?, ?, 'high', 35, 'in_progress', 'ai-smoke', 9999)
    `,
    [marker, '验证 AI 对话以数据库为准'],
  );
  taskId = Number(taskResult.insertId);

  const [logResult] = await db.query(
    `
      INSERT INTO work_logs (task_id, stage, log_date, content, hours, progress_snapshot, next_step)
      VALUES (?, 'in_progress', CURDATE(), ?, 1.5, 35, ?)
    `,
    [taskId, `${marker} 今日数据库日志`, '继续验证审批流程'],
  );
  logId = Number(logResult.insertId);

  const [taskNoteResult] = await db.query(
    `
      INSERT INTO task_notes (task_id, title, category, content)
      VALUES (?, ?, 'ai-smoke', ?)
    `,
    [taskId, `${marker} 关联笔记`, '只应出现在对应任务的进度回答中'],
  );
  taskNoteId = Number(taskNoteResult.insertId);
  const [independentNoteResult] = await db.query(
    `
      INSERT INTO task_notes (task_id, title, category, content)
      VALUES (NULL, ?, 'ai-smoke', ?)
    `,
    [`${marker} 独立笔记`, '不能混入任务进度来源'],
  );
  independentNoteId = Number(independentNoteResult.insertId);

  const [taskAttachmentResult] = await db.query(
    `
      INSERT INTO task_attachments
        (task_id, original_name, stored_name, relative_path, mime_type, file_size, note)
      VALUES (?, ?, ?, ?, 'application/pdf', 128, 'AI 附件清单测试')
    `,
    [taskId, `${marker}-资料.pdf`, `${marker}-task.pdf`, `uploads/task-attachments/${marker}-task.pdf`],
  );
  taskAttachmentId = Number(taskAttachmentResult.insertId);
  await db.query(
    `
      INSERT INTO attachment_text_cache
        (attachment_kind, attachment_id, status, parser, text, text_chars)
      VALUES ('task', ?, 'completed', 'pdf', ?, ?)
    `,
    [taskAttachmentId, `${marker} PDF 正文`, `${marker} PDF 正文`.length],
  );

  const [noteAttachmentResult] = await db.query(
    `
      INSERT INTO note_attachments
        (note_id, original_name, stored_name, relative_path, mime_type, file_size, note)
      VALUES (?, ?, ?, ?, 'image/jpeg', 64, 'AI 图片清单测试')
    `,
    [independentNoteId, `${marker}-图片.jpg`, `${marker}-note.jpg`, `uploads/note-attachments/${marker}-note.jpg`],
  );
  noteAttachmentId = Number(noteAttachmentResult.insertId);

  assert.equal(classifyAiQueryIntent('我还有哪些任务没有完成？'), 'incomplete_tasks');
  assert.equal(classifyAiQueryIntent('今天做了什么？'), 'log_today');
  assert.equal(classifyAiQueryIntent('请问我有哪些任务？'), 'task_overview');
  assert.equal(classifyAiQueryIntent(`把${marker}改成已完成`), 'action');

  const incomplete = await answerWorkspace('我还有哪些任务没有完成？');
  assert.equal(incomplete.grounded, true);
  assert.equal(incomplete.generatedByModel, true);
  assert.equal(incomplete.intent, 'incomplete_tasks');
  assert.match(incomplete.answer, /模型回答/);
  assert.ok(incomplete.sources.some((source) => source.taskId === taskId));
  assert.ok(incomplete.sources.every((source) => source.entityType === 'task'));

  const today = await answerWorkspace('今天做了什么？');
  assert.equal(today.grounded, true);
  assert.equal(today.generatedByModel, true);
  assert.equal(today.intent, 'log_today');
  assert.ok(today.sources.some((source) => Number(source.entityId) === logId));
  assert.match(today.answer, /1\.50/);

  const progress = await answerWorkspace(`${marker}进度怎么样？`);
  assert.equal(progress.generatedByModel, true);
  assert.equal(progress.intent, 'task_progress');
  assert.ok(progress.sources.some((source) => source.entityType === 'task' && source.taskId === taskId));
  assert.ok(progress.sources.some((source) => source.entityType === 'log' && Number(source.entityId) === logId));
  assert.ok(progress.sources.some((source) => source.entityType === 'note' && Number(source.entityId) === taskNoteId));
  assert.ok(!progress.sources.some((source) => source.entityType === 'note' && Number(source.entityId) === independentNoteId));

  const inventory = await answerWorkspace('全部的附件');
  assert.equal(inventory.intent, 'attachment_search');
  assert.ok(inventory.sources.some((source) => source.entityType === 'task_attachment' && Number(source.entityId) === taskAttachmentId));
  assert.ok(inventory.sources.some((source) => source.entityType === 'note_attachment' && Number(source.entityId) === noteAttachmentId));
  assert.ok(inventory.sources.every((source) => source.entityType.endsWith('_attachment')));

  const pdfReply = await answerWorkspace('你给我发一个 PDF');
  assert.ok(pdfReply.sources.some((source) => Number(source.entityId) === taskAttachmentId));
  assert.ok(pdfReply.sources.every((source) => source.mimeType === 'application/pdf' || /\.pdf$/i.test(source.fileName || '')));

  const missingNote = await answerWorkspace(`${marker}-不存在的关键词相关笔记`);
  assert.equal(missingNote.intent, 'note_search');
  assert.equal(missingNote.sources.length, 0);

  const actionPlan = await planAiActionRequest(`帮我把${marker}改成已完成`, {
    requestedBy: 'ai-chat-smoke',
  });
  assert.equal(actionPlan.intent, 'action_update_task');
  assert.equal(actionPlan.actionRequests.length, 1);
  actionId = Number(actionPlan.actionRequests[0].id);
  const actionAnswer = await answerWorkspace(`帮我把${marker}改成已完成`, { actionPlan });
  assert.equal(actionAnswer.generatedByModel, true);
  assert.equal(actionAnswer.actionRequests.length, 1);
  assert.match(actionAnswer.answer, /模型回答/);

  let streamedAnswer = '';
  const streamed = await streamAnswerWorkspace('我还有哪些任务没有完成？', {}, {
    onDelta: (delta) => { streamedAnswer += delta; },
  });
  assert.equal(streamed.generatedByModel, true);
  assert.match(streamedAnswer, /模型回答/);

  const [[unchangedTask]] = await db.query('SELECT status, progress FROM tasks WHERE id = ?', [taskId]);
  assert.equal(unchangedTask.status, 'in_progress');
  assert.equal(Number(unchangedTask.progress), 35);

  assert.equal(modelCalls.length, 8);
  assert.ok(modelCalls.every((call) => call.prompt.includes('本次任务台数据库查询结果')));
  assert.equal(modelCalls.filter((call) => call.stream).length, 1);

  console.log('AI chat smoke test passed: every answer uses the model with database context and approval-only actions.');
} finally {
  const db = getPool();
  if (actionId) await db.query('DELETE FROM mcp_action_requests WHERE id = ?', [actionId]);
  if (taskAttachmentId) await db.query("DELETE FROM attachment_text_cache WHERE attachment_kind = 'task' AND attachment_id = ?", [taskAttachmentId]);
  if (noteAttachmentId) await db.query('DELETE FROM note_attachments WHERE id = ?', [noteAttachmentId]);
  if (taskAttachmentId) await db.query('DELETE FROM task_attachments WHERE id = ?', [taskAttachmentId]);
  if (taskNoteId) await db.query('DELETE FROM task_notes WHERE id = ?', [taskNoteId]);
  if (independentNoteId) await db.query('DELETE FROM task_notes WHERE id = ?', [independentNoteId]);
  if (logId) await db.query('DELETE FROM work_logs WHERE id = ?', [logId]);
  if (taskId) await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  await closePool();
  await new Promise((resolve) => modelServer.close(resolve));
}
