import { closePool, ensureDatabase, getPool } from '../db.js';

const title = `__smoke_test_${Date.now()}__`;
let taskId;
let logId;

try {
  await ensureDatabase();
  const db = getPool();

  const [taskResult] = await db.query(
    `
      INSERT INTO tasks (title, description, priority, due_date, progress, status, tags, sort_order)
      VALUES (?, ?, 'high', CURDATE(), 10, 'todo', 'smoke', 9999)
    `,
    [title, 'smoke test task'],
  );
  taskId = taskResult.insertId;

  await db.query('UPDATE tasks SET status = ?, progress = ? WHERE id = ?', ['in_progress', 45, taskId]);
  await db.query('UPDATE tasks SET status = ?, sort_order = ? WHERE id = ?', ['done', 2, taskId]);

  const [logResult] = await db.query(
    `
      INSERT INTO work_logs (task_id, log_date, content, hours, progress_snapshot, next_step)
      VALUES (?, CURDATE(), ?, 1.25, 45, ?)
    `,
    [taskId, '完成接口冒烟验证', '打开页面验证看板'],
  );
  logId = logResult.insertId;

  const [[reportRow]] = await db.query(
    `
      SELECT COUNT(*) AS entries, COALESCE(SUM(hours), 0) AS hours
      FROM work_logs
      WHERE task_id = ?
    `,
    [taskId],
  );

  if (Number(reportRow.entries) !== 1 || Number(reportRow.hours) !== 1.25) {
    throw new Error('Smoke test report aggregation failed.');
  }

  await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  taskId = undefined;
  logId = undefined;

  console.log('Smoke test passed: database CRUD, status update, log insert, and aggregation work.');
} finally {
  const db = getPool();
  if (logId) {
    await db.query('DELETE FROM work_logs WHERE id = ?', [logId]);
  }
  if (taskId) {
    await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  }
  await closePool();
}
