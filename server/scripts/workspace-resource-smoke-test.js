import fs from 'node:fs/promises';
import path from 'node:path';
import { closePool, ensureDatabase, getPool } from '../db.js';
import { config } from '../config.js';
import { removeStoredAttachment } from '../storage.js';
import {
  addResourceRelation,
  addFileVersion,
  createFileResource,
  createFolder,
  createResource,
  createTag,
  getResource,
  listResourceVersions,
  searchWorkspaceV1,
  updateResource,
} from '../../apps/api/src/modules/resources/service.js';
import { inspectSensitiveText, redactSensitiveText } from '../../packages/domain/src/redaction.js';
import { planAiActionRequest } from '../ai/action-planner.js';
import { rejectActionRequest } from '../action-requests.js';
import { generateResourceDescription } from '../../apps/worker/src/resource-processing.js';

const stamp = Date.now();
const title = `__workspace_resource_smoke_${stamp}__`;
const tempRoot = path.join(config.storage.localRoot, '.smoke');
const createdResourceIds = [];
let taskId;
let folderId;
let tagId;
let actionRequestId;
let secondTaskId;
let legacyNoteId;
const originalResourceDescriptionEnabled = config.ai.resourceDescription.enabled;
config.ai.resourceDescription.enabled = false;

async function uploadFixture(name, suffix = '') {
  const body = Buffer.from(`resource smoke ${stamp}${suffix}`);
  const filePath = path.join(tempRoot, `${stamp}-${name}`);
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.writeFile(filePath, body);
  return {
    path: filePath,
    filename: `${stamp}-${name}`,
    originalname: name,
    mimetype: 'text/plain',
    size: body.length,
  };
}

try {
  await ensureDatabase();
  const db = getPool();
  const folder = await createFolder({ name: title, parentId: null });
  folderId = folder.id;
  const tag = await createTag({ name: `${title}_tag`, color: '#0f766e' });
  tagId = tag.id;

  const textResource = await createResource({
    kind: 'text',
    title,
    description: 'Workspace resource smoke test',
    content: 'The unified resource search should find this exact sentence.',
    folderId,
    tagIds: [tagId],
    aiVisibility: 'allow',
  });
  createdResourceIds.push(textResource.id);
  const updated = await updateResource(textResource.publicId, { description: 'Updated metadata', aiVisibility: 'deny' });
  if (updated.description !== 'Updated metadata' || updated.aiVisibility !== 'deny') {
    throw new Error('Resource metadata update failed.');
  }

  const [taskResult] = await db.query(
    "INSERT INTO tasks (title, description, priority, progress, status, sort_order) VALUES (?, '', 'medium', 0, 'todo', 9999)",
    [title],
  );
  taskId = Number(taskResult.insertId);
  const [secondTaskResult] = await db.query(
    "INSERT INTO tasks (title, description, priority, progress, status, sort_order) VALUES (?, '', 'medium', 0, 'todo', 9999)",
    [`${title}_second`],
  );
  secondTaskId = Number(secondTaskResult.insertId);
  const [legacyNoteResult] = await db.query(
    `INSERT INTO task_notes (task_id, title, category, content, ai_visibility)
     VALUES (?, ?, 'smoke', 'transactional dual write', 'deny')`,
    [taskId, `${title}_note`],
  );
  legacyNoteId = Number(legacyNoteResult.insertId);
  const [[mirroredNote]] = await db.query('SELECT ai_visibility FROM notes WHERE id = ?', [legacyNoteId]);
  const [[primaryLink]] = await db.query(
    'SELECT is_primary FROM note_task_links WHERE note_id = ? AND task_id = ?',
    [legacyNoteId, taskId],
  );
  if (!mirroredNote || mirroredNote.ai_visibility !== 'deny' || Number(primaryLink?.is_primary) !== 1) {
    throw new Error('Legacy note transactional dual write failed.');
  }
  await db.query(
    'INSERT INTO note_task_links (note_id, task_id, is_primary) VALUES (?, ?, 0)',
    [legacyNoteId, secondTaskId],
  );
  await db.query('UPDATE task_notes SET task_id = NULL WHERE id = ?', [legacyNoteId]);
  const [[linkCounts]] = await db.query(
    `SELECT
       SUM(task_id = ? AND is_primary = 1) AS old_primary,
       SUM(task_id = ? AND is_primary = 0) AS manual_link
     FROM note_task_links WHERE note_id = ?`,
    [taskId, secondTaskId, legacyNoteId],
  );
  if (Number(linkCounts.old_primary || 0) !== 0 || Number(linkCounts.manual_link || 0) !== 1) {
    throw new Error('Unified note links were not preserved during legacy update.');
  }
  const related = await addResourceRelation(textResource.id, { targetType: 'task', targetId: taskId, relationType: 'reference' });
  if (!related.relations.some((item) => item.targetType === 'task' && item.targetId === taskId)) {
    throw new Error('Resource relation failed.');
  }

  const firstFile = await createFileResource(await uploadFixture('first.txt'), { folderId, tagIds: [tagId] });
  createdResourceIds.push(firstFile.resource.id);
  const duplicateFile = await createFileResource(await uploadFixture('second.txt'), { folderId, tagIds: [tagId] });
  createdResourceIds.push(duplicateFile.resource.id);
  if (!duplicateFile.duplicates.some((item) => item.id === firstFile.resource.id)) {
    throw new Error('Duplicate file detection failed.');
  }

  await addFileVersion(firstFile.resource.publicId, await uploadFixture('third.txt', '-version-2'));
  const versions = await listResourceVersions(firstFile.resource.publicId);
  if (versions.length !== 2 || versions[0].versionNo !== 2) throw new Error('Resource version listing failed.');
  const loaded = await getResource(textResource.publicId);
  if (!loaded.tags.some((item) => item.id === tagId)) throw new Error('Resource tags were not persisted.');
  const search = await searchWorkspaceV1('unified resource search', 20);
  if (!search.resources.some((item) => item.id === textResource.id)) {
    throw new Error('Unified resource search failed.');
  }

  const secret = '密码: demo-secret-123 API_KEY=sk-test-secret-value';
  if (!inspectSensitiveText(secret).sensitive || redactSensitiveText(secret).includes('demo-secret-123')) {
    throw new Error('Sensitive text redaction failed.');
  }
  const previousDescriptionConfig = {
    enabled: config.ai.resourceDescription.enabled,
    baseUrl: config.ai.litellm.baseUrl,
    apiKey: config.ai.litellm.apiKey,
    chatModel: config.ai.litellm.chatModel,
  };
  config.ai.resourceDescription.enabled = true;
  config.ai.litellm.baseUrl = 'https://model.example/v1';
  config.ai.litellm.apiKey = 'smoke-key';
  config.ai.litellm.chatModel = 'smoke-model';
  let descriptionResult;
  try {
    descriptionResult = await generateResourceDescription(
      {
        original_name: 'customer-contract.pdf',
        resource_title: 'Customer contract',
        mime_type: 'application/pdf',
        kind: 'file',
        parser: 'pdf',
        ai_visibility: 'allow',
      },
      '合同编号 HT-2026，甲方为示例公司。API_KEY=sk-test-secret-value',
      {
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          const prompt = body.messages.map((message) => String(message.content || '')).join('\n');
          if (prompt.includes('sk-test-secret-value')) throw new Error('Description prompt was not redacted.');
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: '示例公司合同资料。',
              description: '该文件记录示例公司的合同信息，包含合同编号等可检索字段。',
              keywords: ['示例公司', '合同', 'HT-2026'],
            }) } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      },
    );
  } finally {
    config.ai.resourceDescription.enabled = previousDescriptionConfig.enabled;
    config.ai.litellm.baseUrl = previousDescriptionConfig.baseUrl;
    config.ai.litellm.apiKey = previousDescriptionConfig.apiKey;
    config.ai.litellm.chatModel = previousDescriptionConfig.chatModel;
  }
  if (!descriptionResult.description.includes('示例公司') || !descriptionResult.keywords.includes('合同')) {
    throw new Error('Automatic resource description generation failed.');
  }
  const planned = await planAiActionRequest(
    `创建文本资料：标题：${title}_agent，内容：该内容必须经过审批后才能保存`,
    { requestedBy: 'workspace-smoke', source: 'ai_chat' },
  );
  actionRequestId = planned?.actionRequests?.[0]?.id;
  if (!actionRequestId || planned.actionRequests[0].actionType !== 'create_resource') {
    throw new Error('AI resource action planning failed.');
  }
  const [[notCreated]] = await db.query('SELECT COUNT(*) AS count FROM resources WHERE title = ?', [`${title}_agent`]);
  if (Number(notCreated.count) !== 0) throw new Error('AI action bypassed approval.');
  await rejectActionRequest(actionRequestId, { decidedBy: 'workspace-smoke', reason: 'smoke cleanup' });
  console.log('Workspace resource smoke test passed.');
} finally {
  config.ai.resourceDescription.enabled = originalResourceDescriptionEnabled;
  const db = getPool();
  if (createdResourceIds.length) {
    const placeholders = createdResourceIds.map(() => '?').join(',');
    const [versions] = await db.query(
      `SELECT storage_provider, storage_key, relative_path FROM resource_versions WHERE resource_id IN (${placeholders})`,
      createdResourceIds,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const version of versions) await removeStoredAttachment(version).catch(() => {});
    await db.query(`DELETE FROM resources WHERE id IN (${placeholders})`, createdResourceIds);
  }
  if (legacyNoteId) await db.query('DELETE FROM task_notes WHERE id = ?', [legacyNoteId]);
  if (taskId) await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
  if (secondTaskId) await db.query('DELETE FROM tasks WHERE id = ?', [secondTaskId]);
  if (tagId) await db.query('DELETE FROM tags WHERE id = ?', [tagId]);
  if (folderId) await db.query('DELETE FROM folders WHERE id = ?', [folderId]);
  if (actionRequestId) await db.query('DELETE FROM mcp_action_requests WHERE id = ?', [actionRequestId]);
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  await closePool();
}
