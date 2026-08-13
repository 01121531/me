import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { approveActionRequest } from '../action-requests.js';
import { closePool, ensureDatabase, getPool } from '../db.js';
import { createTaskBoardMcpServer } from '../mcp/server.js';

const title = `__mcp_action_smoke_${Date.now()}__`;
let taskId;
let logId;
let noteId;
let client;
let server;
const actionIds = [];

async function callTool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined);
  return result.structuredContent;
}

async function requestAndApprove(name, args) {
  const request = await callTool(name, args);
  assert.equal(request.status, 'pending');
  actionIds.push(request.id);
  const applied = await approveActionRequest(request.id, { decidedBy: 'smoke-test' });
  assert.equal(applied.status, 'applied', applied.errorMessage);
  return applied;
}

try {
  await ensureDatabase();
  const db = getPool();

  server = createTaskBoardMcpServer();
  client = new Client({ name: 'mcp-action-smoke', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const createdTaskAction = await requestAndApprove('request_create_task', {
    title,
    description: 'Created through MCP approval smoke test',
    priority: 'high',
    status: 'in_progress',
    progress: 35,
    tags: ['mcp', 'approval'],
  });
  taskId = createdTaskAction.result.id;

  const [[createdTask]] = await db.query('SELECT status, progress, tags FROM tasks WHERE id = ?', [taskId]);
  assert.equal(createdTask.status, 'in_progress');
  assert.equal(Number(createdTask.progress), 35);
  assert.match(createdTask.tags, /approval/);

  const updatedTaskAction = await requestAndApprove('request_update_task', {
    taskId,
    status: 'done',
    progress: 40,
  });
  assert.equal(updatedTaskAction.result.status, 'done');
  assert.equal(updatedTaskAction.result.progress, 100);

  const logAction = await requestAndApprove('request_create_log', {
    taskId,
    content: 'MCP approval smoke log',
    hours: 2,
    progressSnapshot: 80,
    stage: 'done',
  });
  logId = logAction.result.id;
  assert.equal(logAction.result.progressSnapshot, 80);

  const noteAction = await requestAndApprove('request_create_note', {
    taskId,
    title: `${title} note`,
    category: 'mcp-approval',
    content: 'MCP approval smoke note',
  });
  noteId = noteAction.result.id;

  const updatedNoteAction = await requestAndApprove('request_update_note', {
    noteId,
    content: 'MCP approval smoke note updated',
  });
  assert.match(updatedNoteAction.result.content, /updated/);

  console.log('MCP action smoke test passed: request, approve, and apply task/log/note changes work.');
} finally {
  await client?.close();
  await server?.close();
  const db = getPool();
  if (noteId) await db.query('DELETE FROM task_notes WHERE id = ?', [noteId]);
  if (logId) await db.query('DELETE FROM work_logs WHERE id = ?', [logId]);
  if (taskId) await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  if (actionIds.length) {
    await db.query(
      `DELETE FROM mcp_action_requests WHERE id IN (${actionIds.map(() => '?').join(',')})`,
      actionIds,
    );
  }
  await closePool();
}
