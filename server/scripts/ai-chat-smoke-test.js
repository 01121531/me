import assert from 'node:assert/strict';
import { planAiActionRequest } from '../ai/action-planner.js';
import { answerWorkspace, classifyAiQueryIntent } from '../ai/search.js';
import { closePool, ensureDatabase, getPool } from '../db.js';

const marker = `__ai_chat_smoke_${Date.now()}__`;
let taskId;
let logId;
let taskNoteId;
let independentNoteId;
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

  assert.equal(classifyAiQueryIntent('我还有哪些任务没有完成？'), 'incomplete_tasks');
  assert.equal(classifyAiQueryIntent('今天做了什么？'), 'log_today');
  assert.equal(classifyAiQueryIntent('请问我有哪些任务？'), 'task_overview');
  assert.equal(classifyAiQueryIntent(`把${marker}改成已完成`), 'action');

  const incomplete = await answerWorkspace('我还有哪些任务没有完成？');
  assert.equal(incomplete.grounded, true);
  assert.equal(incomplete.intent, 'incomplete_tasks');
  assert.ok(incomplete.sources.some((source) => source.taskId === taskId));
  assert.ok(incomplete.sources.every((source) => source.entityType === 'task'));

  const today = await answerWorkspace('今天做了什么？');
  assert.equal(today.grounded, true);
  assert.equal(today.intent, 'log_today');
  assert.ok(today.sources.some((source) => Number(source.entityId) === logId));
  assert.match(today.answer, /1\.50/);

  const progress = await answerWorkspace(`${marker}进度怎么样？`);
  assert.equal(progress.intent, 'task_progress');
  assert.ok(progress.sources.some((source) => source.entityType === 'task' && source.taskId === taskId));
  assert.ok(progress.sources.some((source) => source.entityType === 'log' && Number(source.entityId) === logId));
  assert.ok(progress.sources.some((source) => source.entityType === 'note' && Number(source.entityId) === taskNoteId));
  assert.ok(!progress.sources.some((source) => source.entityType === 'note' && Number(source.entityId) === independentNoteId));

  const actionPlan = await planAiActionRequest(`帮我把${marker}改成已完成`, {
    requestedBy: 'ai-chat-smoke',
  });
  assert.equal(actionPlan.intent, 'action_update_task');
  assert.equal(actionPlan.actionRequests.length, 1);
  actionId = Number(actionPlan.actionRequests[0].id);
  assert.equal(actionPlan.actionRequests[0].source, 'ai_chat');
  assert.equal(actionPlan.actionRequests[0].status, 'pending');

  const [[unchangedTask]] = await db.query('SELECT status, progress FROM tasks WHERE id = ?', [taskId]);
  assert.equal(unchangedTask.status, 'in_progress');
  assert.equal(Number(unchangedTask.progress), 35);

  console.log('AI chat smoke test passed: database answers, relevant sources, and approval-only actions work.');
} finally {
  const db = getPool();
  if (actionId) await db.query('DELETE FROM mcp_action_requests WHERE id = ?', [actionId]);
  if (taskNoteId) await db.query('DELETE FROM task_notes WHERE id = ?', [taskNoteId]);
  if (independentNoteId) await db.query('DELETE FROM task_notes WHERE id = ?', [independentNoteId]);
  if (logId) await db.query('DELETE FROM work_logs WHERE id = ?', [logId]);
  if (taskId) await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  await closePool();
}
