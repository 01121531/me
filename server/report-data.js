import { getPool } from './db.js';
import { mapLog, mapTask, toDateOrNull, toToday } from './validators.js';

export async function getReportData({ from, to } = {}) {
  const fromDate = toDateOrNull(from) || toToday();
  const toDate = toDateOrNull(to) || fromDate;

  const [logRows] = await getPool().query(
    `
      SELECT l.*, t.title AS task_title, t.status AS task_status, t.priority AS task_priority
      FROM work_logs l
      JOIN tasks t ON t.id = l.task_id
      WHERE l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.log_date BETWEEN ? AND ?
      ORDER BY l.log_date DESC, l.id DESC
    `,
    [fromDate, toDate],
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
    [fromDate, toDate],
  );

  const logs = logRows.map(mapLog);
  const totalHours = logs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const taskMap = new Map();
  for (const log of logs) {
    const item = taskMap.get(log.taskId) || {
      taskId: log.taskId,
      title: log.taskTitle,
      hours: 0,
      entries: 0,
    };
    item.hours += Number(log.hours || 0);
    item.entries += 1;
    taskMap.set(log.taskId, item);
  }

  return {
    from: fromDate,
    to: toDate,
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
