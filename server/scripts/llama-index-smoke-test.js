import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const points = new Map();
let collectionCreated = false;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, result, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ result, status: 'ok', time: 0 }));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const qdrant = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ title: 'qdrant', version: '1.18.0' }));
    return;
  }
  if (req.method === 'GET' && url.pathname.endsWith('/exists')) {
    sendJson(res, { exists: collectionCreated });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/collections/')) {
    if (!collectionCreated) {
      sendJson(res, { message: 'Missing collection' }, 404);
      return;
    }
    sendJson(res, { status: 'green' });
    return;
  }
  if (req.method === 'PUT' && /^\/collections\/[^/]+$/.test(url.pathname)) {
    collectionCreated = true;
    sendJson(res, true);
    return;
  }
  if (req.method === 'PUT' && url.pathname.endsWith('/points')) {
    const body = await readJson(req);
    body.points.forEach((point) => points.set(point.id, point));
    sendJson(res, { operation_id: 1, status: 'completed' });
    return;
  }
  if (req.method === 'PUT' && url.pathname.endsWith('/index')) {
    sendJson(res, { operation_id: 1, status: 'completed' });
    return;
  }
  if (req.method === 'POST' && url.pathname.endsWith('/points/query')) {
    const body = await readJson(req);
    const taskId = body.filter?.must?.flatMap((filter) => filter.must || [filter])
      .find((filter) => filter.key === 'taskId')?.range?.gte;
    const matching = [...points.values()]
      .filter((point) => taskId === undefined || Number(point.payload.taskId) === Number(taskId))
      .map((point) => ({ id: point.id, payload: point.payload, score: 0.91 }));
    sendJson(res, { points: matching });
    return;
  }
  sendJson(res, { message: `Unhandled ${req.method} ${url.pathname}` }, 404);
});

const litellm = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const body = await readJson(req);
  if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
    assert.equal(body.model, 'embeddings-primary');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }], model: body.model, object: 'list', usage: { prompt_tokens: 1, total_tokens: 1 } }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '索引任务已经准备好。[1]' }, finish_reason: 'stop', index: 0 }] }));
    return;
  }
  sendJson(res, { message: `Unhandled ${req.method} ${url.pathname}` }, 404);
});

const qdrantPort = await listen(qdrant);
const litellmPort = await listen(litellm);
process.env.AI_INDEXING_ENABLED = 'true';
process.env.QDRANT_URL = `http://127.0.0.1:${qdrantPort}`;
process.env.QDRANT_COLLECTION = 'smoke_collection';
process.env.LITELLM_BASE_URL = `http://127.0.0.1:${litellmPort}/v1`;
process.env.LITELLM_API_KEY = 'smoke-key';
process.env.LITELLM_EMBEDDING_MODEL = 'embeddings-primary';
process.env.LITELLM_CHAT_MODEL = 'chat-primary';

try {
  const { upsertDocumentVector, retrieveRelevantNodes } = await import('../ai/vector-store.js');
  const { answerWorkspace } = await import('../ai/search.js');
  const document = {
    documentId: 'task:smoke',
    entityType: 'task',
    entityId: 'smoke',
    rootTaskId: 7,
    text: 'LlamaIndex 通过 LiteLLM 为任务台建立语义索引。',
    metadata: { title: '索引冒烟任务', taskId: 7, status: 'in_progress' },
  };

  await upsertDocumentVector(document);
  const nodes = await retrieveRelevantNodes('索引状态', { taskId: 7 });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].metadata.entityType, 'task');
  assert.match(nodes[0].text, /LlamaIndex/);

  const answer = await answerWorkspace('索引是否准备好？', { taskId: 7 });
  assert.equal(answer.grounded, true);
  assert.equal(answer.sources.length, 1);
  assert.match(answer.answer, /索引任务/);
  console.log('LlamaIndex smoke test passed: LiteLLM embedding, Qdrant retrieval, and sourced answer work.');
} finally {
  await Promise.all([close(qdrant), close(litellm)]);
}
