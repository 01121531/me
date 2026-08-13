import crypto from 'crypto';
import { MetadataMode, TextNode } from 'llamaindex';
import { OpenAIEmbedding } from '@llamaindex/openai';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';

let qdrantClient;
let embeddingModel;
let vectorStore;
let collectionReady = false;

function pointId(documentId) {
  const hex = crypto.createHash('sha256').update(documentId).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function assertAiIndexingConfiguration() {
  if (!config.ai.indexingEnabled) {
    throw new Error('AI indexing is disabled. Set AI_INDEXING_ENABLED=true before running the worker.');
  }
  if (!config.ai.litellm.baseUrl || !config.ai.litellm.apiKey || !config.ai.litellm.embeddingModel) {
    throw new Error('LiteLLM requires LITELLM_BASE_URL, LITELLM_API_KEY, and LITELLM_EMBEDDING_MODEL.');
  }
  if (!config.ai.qdrant.url) {
    throw new Error('Qdrant requires QDRANT_URL.');
  }
}

function getQdrantClient() {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: config.ai.qdrant.url,
      apiKey: config.ai.qdrant.apiKey || undefined,
      timeout: 30000,
    });
  }
  return qdrantClient;
}

export function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = new OpenAIEmbedding({
      model: config.ai.litellm.embeddingModel,
      apiKey: config.ai.litellm.apiKey,
      baseURL: config.ai.litellm.baseUrl,
      maxRetries: 2,
      timeout: 30000,
    });
  }
  return embeddingModel;
}

export function getVectorStore() {
  if (!vectorStore) {
    vectorStore = new QdrantVectorStore({
      collectionName: config.ai.qdrant.collection,
      client: getQdrantClient(),
      embedModel: getEmbeddingModel(),
    });
  }
  return vectorStore;
}

async function collectionExists() {
  const exists = await getQdrantClient().collectionExists(config.ai.qdrant.collection);
  return Boolean(exists.exists);
}

async function ensurePayloadIndexes(collectionWasMissing) {
  if (collectionReady || !collectionWasMissing) {
    collectionReady = true;
    return;
  }
  await Promise.all([
    getQdrantClient().createPayloadIndex(config.ai.qdrant.collection, { field_name: 'entityType', field_schema: 'keyword' }),
    getQdrantClient().createPayloadIndex(config.ai.qdrant.collection, { field_name: 'taskId', field_schema: 'integer' }),
    getQdrantClient().createPayloadIndex(config.ai.qdrant.collection, { field_name: 'status', field_schema: 'keyword' }),
    getQdrantClient().createPayloadIndex(config.ai.qdrant.collection, { field_name: 'category', field_schema: 'keyword' }),
  ]);
  collectionReady = true;
}

export async function upsertDocumentVector(document) {
  assertAiIndexingConfiguration();
  const store = getVectorStore();
  const collectionWasMissing = !(await collectionExists());
  const node = new TextNode({
    id_: pointId(document.documentId),
    text: document.text,
    metadata: {
      documentId: document.documentId,
      entityType: document.entityType,
      entityId: document.entityId,
      taskId: document.rootTaskId,
      ...document.metadata,
    },
  });
  node.embedding = await getEmbeddingModel().getTextEmbedding(document.text.slice(0, 24000));
  await store.add([node]);
  await ensurePayloadIndexes(collectionWasMissing);
}

export async function deleteDocumentVector(entityType, entityId) {
  assertAiIndexingConfiguration();
  if (!(await collectionExists())) return;
  await getQdrantClient().delete(config.ai.qdrant.collection, {
    wait: true,
    points: [pointId(`${entityType}:${entityId}`)],
  });
}

export async function deleteTaskVectors(taskId) {
  assertAiIndexingConfiguration();
  if (!(await collectionExists())) return;
  await getQdrantClient().delete(config.ai.qdrant.collection, {
    wait: true,
    filter: {
      should: [
        { key: 'documentId', match: { value: `task:${taskId}` } },
        { key: 'taskId', match: { value: Number(taskId) } },
      ],
    },
  });
}

export async function retrieveRelevantNodes(query, { taskId = null, limit = 8 } = {}) {
  assertAiIndexingConfiguration();
  if (!(await collectionExists())) return [];
  const result = await getVectorStore().query({
    queryEmbedding: await getEmbeddingModel().getTextEmbedding(query.slice(0, 12000)),
    queryStr: query,
    similarityTopK: Math.max(1, Math.min(20, Number(limit) || 8)),
    mode: 'default',
    filters: taskId
      ? { filters: [{ key: 'taskId', value: Number(taskId), operator: '==' }] }
      : undefined,
  });
  return (result.nodes || []).map((node, index) => ({
    id: result.ids[index],
    score: Number(result.similarities[index] || 0),
    text: node.getContent(MetadataMode.NONE),
    metadata: node.metadata,
  }));
}
