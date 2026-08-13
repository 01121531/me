import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { createActionRequest } from '../action-requests.js';
import { config } from '../config.js';
import {
  generateReport,
  getTask,
  getTaskTimeline,
  listAttachments,
  listTasks,
  searchNotes,
  searchWorkspaceRecords,
} from './read-tools.js';

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const writeToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const optionalLimit = z.coerce.number().int().positive().max(200).optional();
const taskIdSchema = z.coerce.number().int().positive();
const optionalText = z.string().min(1).optional();
const optionalTags = z.union([z.string(), z.array(z.string())]).optional();

function toolResult(data) {
  return {
    structuredContent: data,
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function actionRequestResult(toolName, actionType, payload) {
  return toolResult(await createActionRequest({
    toolName,
    actionType,
    payload,
    requestedBy: 'openclaw',
    source: 'mcp',
  }));
}

export function createTaskBoardMcpServer() {
  const server = new McpServer({
    name: 'assistant-task-board',
    version: '1.0.0',
  });

  server.registerTool('list_tasks', {
    title: 'List Tasks',
    description: 'List task cards with optional status, priority, tag, keyword, and due date filters.',
    inputSchema: {
      status: z.enum(['todo', 'in_progress', 'done']).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      tag: z.string().min(1).optional(),
      search: z.string().min(1).optional(),
      dueFrom: optionalDate,
      dueTo: optionalDate,
      limit: optionalLimit,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await listTasks(args)));

  server.registerTool('get_task', {
    title: 'Get Task',
    description: 'Read one task with recent logs, notes, task attachments, and counts.',
    inputSchema: {
      taskId: taskIdSchema,
    },
    annotations: toolAnnotations,
  }, async ({ taskId }) => toolResult(await getTask(taskId)));

  server.registerTool('get_task_timeline', {
    title: 'Get Task Timeline',
    description: 'Read a task work-log timeline with search, date range, and stage filters.',
    inputSchema: {
      taskId: taskIdSchema,
      search: z.string().min(1).optional(),
      from: optionalDate,
      to: optionalDate,
      stage: z.enum(['todo', 'in_progress', 'done']).optional(),
      limit: optionalLimit,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await getTaskTimeline(args)));

  server.registerTool('search_notes', {
    title: 'Search Notes',
    description: 'Search independent notes or task notes by title, content, category, or attachment note.',
    inputSchema: {
      query: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      taskId: taskIdSchema.optional(),
      scope: z.enum(['all', 'independent', 'task']).optional(),
      limit: optionalLimit,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await searchNotes(args)));

  server.registerTool('generate_report', {
    title: 'Generate Report',
    description: 'Generate a daily or weekly report for a date range, including logs, active tasks, completed tasks, hours, and next steps.',
    inputSchema: {
      from: optionalDate,
      to: optionalDate,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await generateReport(args)));

  server.registerTool('list_attachments', {
    title: 'List Attachments',
    description: 'List task, log, and note attachment metadata with preview/download API paths.',
    inputSchema: {
      kind: z.enum(['all', 'task', 'log', 'note']).optional(),
      taskId: taskIdSchema.optional(),
      logId: taskIdSchema.optional(),
      noteId: taskIdSchema.optional(),
      limit: optionalLimit,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await listAttachments(args)));

  server.registerTool('search_workspace', {
    title: 'Search Workspace',
    description: 'Search across tasks, logs, notes, and indexed attachments. Uses semantic search when AI indexing is available, otherwise keyword search.',
    inputSchema: {
      query: z.string().min(1),
      taskId: taskIdSchema.optional(),
      mode: z.enum(['semantic', 'keyword']).optional(),
      limit: optionalLimit,
    },
    annotations: toolAnnotations,
  }, async (args) => toolResult(await searchWorkspaceRecords(args)));

  server.registerTool('request_create_task', {
    title: 'Request Create Task',
    description: 'Create a pending approval request to add a new task. The task is not changed until approved in the web app.',
    inputSchema: {
      title: z.string().min(1),
      description: optionalText,
      priority: z.enum(['low', 'medium', 'high']).optional(),
      dueDate: optionalDate,
      progress: z.coerce.number().min(0).max(100).optional(),
      status: z.enum(['todo', 'in_progress', 'done']).optional(),
      tags: optionalTags,
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_create_task', 'create_task', args));

  server.registerTool('request_update_task', {
    title: 'Request Update Task',
    description: 'Create a pending approval request to update task fields, status, or progress.',
    inputSchema: {
      taskId: taskIdSchema,
      title: optionalText,
      description: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      dueDate: optionalDate,
      progress: z.coerce.number().min(0).max(100).optional(),
      status: z.enum(['todo', 'in_progress', 'done']).optional(),
      tags: optionalTags,
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_update_task', 'update_task', args));

  server.registerTool('request_create_log', {
    title: 'Request Create Log',
    description: 'Create a pending approval request to add a work log to a task.',
    inputSchema: {
      taskId: taskIdSchema,
      content: z.string().min(1),
      hours: z.coerce.number().min(0).max(999.99).optional(),
      progressSnapshot: z.coerce.number().min(0).max(100).optional(),
      stage: z.enum(['todo', 'in_progress', 'done']).optional(),
      logDate: optionalDate,
      nextStep: z.string().optional(),
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_create_log', 'create_log', args));

  server.registerTool('request_update_log', {
    title: 'Request Update Log',
    description: 'Create a pending approval request to edit a work log. The progress value is a historical snapshot only.',
    inputSchema: {
      logId: taskIdSchema,
      content: optionalText,
      hours: z.coerce.number().min(0).max(999.99).optional(),
      progressSnapshot: z.coerce.number().min(0).max(100).optional(),
      stage: z.enum(['todo', 'in_progress', 'done']).optional(),
      logDate: optionalDate,
      nextStep: z.string().optional(),
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_update_log', 'update_log', args));

  server.registerTool('request_create_note', {
    title: 'Request Create Note',
    description: 'Create a pending approval request to add an independent note or a task note.',
    inputSchema: {
      taskId: taskIdSchema.optional(),
      title: optionalText,
      category: optionalText,
      content: z.string().min(1),
      contentJson: z.any().optional(),
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_create_note', 'create_note', args));

  server.registerTool('request_update_note', {
    title: 'Request Update Note',
    description: 'Create a pending approval request to edit a note or move it between independent and task-linked notes.',
    inputSchema: {
      noteId: taskIdSchema,
      taskId: z.union([taskIdSchema, z.null()]).optional(),
      title: optionalText,
      category: z.string().optional(),
      content: optionalText,
      contentJson: z.any().optional(),
    },
    annotations: writeToolAnnotations,
  }, async (args) => actionRequestResult('request_update_note', 'update_note', args));

  return server;
}

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isMcpAuthorized(req) {
  const authorization = req.get('authorization') || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const headerToken = req.get('x-mcp-token') || '';
  return tokenMatches(bearerToken, config.mcp.token) || tokenMatches(headerToken, config.mcp.token);
}

function sendMcpError(res, status, code, message) {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

export function installMcpServer(app) {
  app.all('/mcp', async (req, res) => {
    if (!config.mcp.enabled) {
      sendMcpError(res, 404, -32004, 'MCP endpoint is disabled.');
      return;
    }
    if (!isMcpAuthorized(req)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendMcpError(res, 401, -32001, 'MCP bearer token is required.');
      return;
    }
    if (req.method !== 'POST') {
      sendMcpError(res, 405, -32000, 'Method not allowed.');
      return;
    }

    const server = createTaskBoardMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', close);
    } catch (error) {
      await close();
      console.error('MCP request failed:', error);
      if (!res.headersSent) {
        sendMcpError(res, 500, -32603, 'Internal MCP server error.');
      }
    }
  });
}
