import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { closePool, ensureDatabase, getPool } from '../db.js';
import { createTaskBoardMcpServer } from '../mcp/server.js';

const title = `__mcp_read_smoke_${Date.now()}__`;
let taskId;
let logId;
let noteId;
let attachmentId;
let client;
let server;

async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined);
  return result.structuredContent;
}

try {
  await ensureDatabase();
  const db = getPool();

  const [taskResult] = await db.query(
    `
      INSERT INTO tasks (title, description, priority, due_date, progress, status, tags, sort_order)
      VALUES (?, ?, 'high', CURDATE(), 42, 'in_progress', 'mcp,smoke', 9999)
    `,
    [title, 'MCP read smoke task'],
  );
  taskId = taskResult.insertId;

  const [logResult] = await db.query(
    `
      INSERT INTO work_logs (task_id, stage, log_date, content, hours, progress_snapshot, next_step)
      VALUES (?, 'in_progress', CURDATE(), ?, 1.5, 42, ?)
    `,
    [taskId, 'MCP timeline smoke log', 'Verify OpenClaw read tools'],
  );
  logId = logResult.insertId;

  const [noteResult] = await db.query(
    `
      INSERT INTO task_notes (task_id, title, category, content, sort_order)
      VALUES (?, ?, 'mcp-smoke', ?, 0)
    `,
    [taskId, `${title} note`, 'MCP searchable note content'],
  );
  noteId = noteResult.insertId;

  const [attachmentResult] = await db.query(
    `
      INSERT INTO task_attachments
        (task_id, original_name, stored_name, relative_path, storage_provider, storage_key, mime_type, file_size, note)
      VALUES (?, 'mcp-smoke.txt', 'mcp-smoke.txt', 'uploads/task-attachments/smoke/mcp-smoke.txt', 'local', 'task-attachments/smoke/mcp-smoke.txt', 'text/plain', 12, 'MCP smoke attachment')
    `,
    [taskId],
  );
  attachmentId = attachmentResult.insertId;

  server = createTaskBoardMcpServer();
  client = new Client({ name: 'mcp-read-smoke', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const tools = await client.listTools();
  for (const name of ['list_tasks', 'get_task', 'get_task_timeline', 'search_notes', 'generate_report', 'list_attachments', 'search_workspace']) {
    assert.ok(tools.tools.some((tool) => tool.name === name), `Missing MCP tool: ${name}`);
  }

  const task = await callTool('get_task', { taskId });
  assert.equal(task.task.id, Number(taskId));
  assert.equal(task.counts.logs, 1);
  assert.equal(task.taskAttachments.length, 1);

  const timeline = await callTool('get_task_timeline', { taskId, search: 'timeline' });
  assert.equal(timeline.summary.count, 1);
  assert.equal(timeline.summary.totalHours, 1.5);

  const notes = await callTool('search_notes', { taskId, query: 'searchable' });
  assert.equal(notes.count, 1);
  assert.equal(notes.notes[0].id, Number(noteId));

  const attachments = await callTool('list_attachments', { taskId, kind: 'task' });
  assert.equal(attachments.count, 1);
  assert.equal(attachments.attachments[0].id, Number(attachmentId));

  const search = await callTool('search_workspace', { query: title, mode: 'keyword' });
  assert.ok(search.sources.some((source) => source.entityType === 'task' && source.entityId === Number(taskId)));

  console.log('MCP read smoke test passed: tools list, task, timeline, notes, attachments, and keyword search work.');
} finally {
  await client?.close();
  await server?.close();
  const db = getPool();
  if (attachmentId) await db.query('DELETE FROM task_attachments WHERE id = ?', [attachmentId]);
  if (noteId) await db.query('DELETE FROM task_notes WHERE id = ?', [noteId]);
  if (logId) await db.query('DELETE FROM work_logs WHERE id = ?', [logId]);
  if (taskId) await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  await closePool();
}
