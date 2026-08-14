import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { getPool } from '../../../../../server/db.js';
import {
  activeStorageProvider,
  persistUploadedFile,
  removeStoredAttachment,
} from '../../../../../server/storage.js';
import { scheduleIndexJob } from '../../../../../server/indexing.js';
import { queueResourceProcessing, processResourceVersion } from '../../../../../apps/worker/src/resource-processing.js';
import { normalizedTaxonomyKey, normalizeTaxonomyName } from '../../../../../packages/domain/src/taxonomy.js';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function numericId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function identifierWhere(alias, value) {
  const number = numericId(value);
  return number
    ? { sql: `${alias}.id = ?`, param: number }
    : { sql: `${alias}.public_id = ?`, param: String(value || '') };
}

async function defaultWorkspaceId(connection = getPool()) {
  const [[workspace]] = await connection.query(
    'SELECT id FROM workspaces WHERE is_default = 1 ORDER BY id LIMIT 1',
  );
  if (!workspace) throw httpError('默认工作区不存在。', 500);
  return Number(workspace.id);
}

async function resolveFolder(connection, value, workspaceId, { allowNull = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowNull) return null;
    throw httpError('目录不存在。', 404);
  }
  const where = identifierWhere('f', value);
  const [[folder]] = await connection.query(
    `SELECT f.* FROM folders f WHERE ${where.sql} AND f.workspace_id = ? AND f.deleted_at IS NULL LIMIT 1`,
    [where.param, workspaceId],
  );
  if (!folder) throw httpError('目录不存在。', 404);
  return folder;
}

async function resolveTagIds(connection, values, workspaceId) {
  if (!Array.isArray(values)) return null;
  const ids = [];
  for (const value of values) {
    const where = identifierWhere('t', value);
    const [[tag]] = await connection.query(
      `SELECT t.id FROM tags t WHERE ${where.sql} AND t.workspace_id = ? AND t.deleted_at IS NULL LIMIT 1`,
      [where.param, workspaceId],
    );
    if (!tag) throw httpError(`标签 ${value} 不存在。`, 404);
    ids.push(Number(tag.id));
  }
  return [...new Set(ids)];
}

async function setResourceTags(connection, resourceId, tagIds) {
  if (tagIds === null) return;
  await connection.query('DELETE FROM resource_tags WHERE resource_id = ?', [resourceId]);
  for (const tagId of tagIds) {
    await connection.query(
      "INSERT INTO resource_tags (resource_id, tag_id, source) VALUES (?, ?, 'manual')",
      [resourceId, tagId],
    );
  }
}

function mapVersion(row) {
  if (!row?.version_id && !row?.id) return null;
  const id = Number(row.version_id || row.id);
  const publicId = row.version_public_id || row.public_id;
  const resourcePublicId = row.resource_public_id;
  const base = resourcePublicId && publicId
    ? `/api/v1/resources/${resourcePublicId}/versions/${publicId}`
    : null;
  return {
    id,
    publicId,
    versionNo: Number(row.version_no || 0),
    originalName: row.original_name || null,
    mimeType: row.mime_type || null,
    fileSize: Number(row.file_size || 0),
    checksumSha256: row.checksum_sha256 || null,
    sourceUrl: row.source_url || null,
    createdAt: row.version_created_at || row.created_at || null,
    downloadUrl: row.storage_key && base ? `${base}/download` : null,
    previewUrl: row.storage_key && base ? `${base}/preview` : null,
  };
}

function mapResource(row) {
  const latestVersion = row.version_id ? mapVersion(row) : null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    workspaceId: Number(row.workspace_id),
    folderId: row.folder_id ? Number(row.folder_id) : null,
    folderPublicId: row.folder_public_id || null,
    folderName: row.folder_name || null,
    kind: row.kind,
    title: row.title,
    description: row.description || '',
    descriptionSource: row.description_source || (row.description ? 'manual' : 'none'),
    status: row.status,
    aiVisibility: row.ai_visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versionCount: Number(row.version_count || (latestVersion ? 1 : 0)),
    latestVersion,
    content: row.content_status ? {
      status: row.content_status,
      parser: row.parser || null,
      summary: row.summary || '',
      autoDescription: row.auto_description || '',
      keywords: parseJson(row.keywords_json, []),
      descriptionStatus: row.description_status || 'pending',
      descriptionModel: row.description_model || null,
      descriptionError: row.description_error || '',
      textChars: Number(row.text_chars || 0),
      pageCount: row.page_count === null ? null : Number(row.page_count),
      truncated: Boolean(row.truncated),
      error: row.error_message || '',
      suggestedTags: parseJson(row.suggested_tags_json, []),
    } : null,
    tags: [],
    relations: [],
  };
}

const resourceSelect = `
  SELECT
    r.*,
    r.public_id AS resource_public_id,
    f.public_id AS folder_public_id,
    f.name AS folder_name,
    v.id AS version_id,
    v.public_id AS version_public_id,
    v.version_no,
    v.original_name,
    v.mime_type,
    v.file_size,
    v.storage_key,
    v.checksum_sha256,
    v.source_url,
    v.created_at AS version_created_at,
    c.status AS content_status,
    c.parser,
    c.summary,
    c.auto_description,
    c.keywords_json,
    c.description_status,
    c.description_model,
    c.description_error,
    c.suggested_tags_json,
    c.text_chars,
    c.page_count,
    c.truncated,
    c.error_message,
    (SELECT COUNT(*) FROM resource_versions all_versions WHERE all_versions.resource_id = r.id) AS version_count
  FROM resources r
  LEFT JOIN folders f ON f.id = r.folder_id AND f.deleted_at IS NULL
  LEFT JOIN resource_versions v
    ON v.resource_id = r.id
   AND v.version_no = (SELECT MAX(latest.version_no) FROM resource_versions latest WHERE latest.resource_id = r.id)
  LEFT JOIN resource_contents c ON c.version_id = v.id
`;

async function hydrateResources(connection, resources) {
  if (!resources.length) return resources;
  const ids = resources.map((item) => item.id);
  const placeholders = ids.map(() => '?').join(',');
  const [tags] = await connection.query(
    `
      SELECT rt.resource_id, t.id, t.public_id, t.name, t.color
      FROM resource_tags rt
      JOIN tags t ON t.id = rt.tag_id AND t.deleted_at IS NULL
      WHERE rt.resource_id IN (${placeholders})
      ORDER BY t.sort_order, t.name
    `,
    ids,
  );
  const [relations] = await connection.query(
    `
      SELECT resource_id, id, target_type, target_id, relation_type, created_at,
        CASE target_type
          WHEN 'task' THEN (SELECT title FROM tasks WHERE id = target_id AND deleted_at IS NULL)
          WHEN 'note' THEN (SELECT title FROM task_notes WHERE id = target_id AND deleted_at IS NULL)
          WHEN 'log' THEN (
            SELECT CONCAT(task.title, ' · ', DATE_FORMAT(log.log_date, '%Y-%m-%d'))
            FROM work_logs log JOIN tasks task ON task.id = log.task_id
            WHERE log.id = target_id AND log.deleted_at IS NULL AND task.deleted_at IS NULL
          )
        END AS target_label,
        CASE target_type
          WHEN 'task' THEN target_id
          WHEN 'note' THEN (SELECT task_id FROM task_notes WHERE id = target_id AND deleted_at IS NULL)
          WHEN 'log' THEN (SELECT task_id FROM work_logs WHERE id = target_id AND deleted_at IS NULL)
        END AS task_id
      FROM resource_relations
      WHERE resource_id IN (${placeholders})
      ORDER BY created_at, id
    `,
    ids,
  );
  const byId = new Map(resources.map((item) => [item.id, item]));
  for (const tag of tags) {
    byId.get(Number(tag.resource_id))?.tags.push({
      id: Number(tag.id),
      publicId: tag.public_id,
      name: tag.name,
      color: tag.color || null,
    });
  }
  for (const relation of relations) {
    byId.get(Number(relation.resource_id))?.relations.push({
      id: Number(relation.id),
      targetType: relation.target_type,
      targetId: Number(relation.target_id),
      relationType: relation.relation_type,
      label: relation.target_label || `#${relation.target_id}`,
      taskId: relation.task_id ? Number(relation.task_id) : null,
      createdAt: relation.created_at,
    });
  }
  return resources;
}

async function findResource(connection, value, { includeDeleted = false } = {}) {
  const where = identifierWhere('r', value);
  const [rows] = await connection.query(
    `${resourceSelect} WHERE ${where.sql} ${includeDeleted ? '' : 'AND r.deleted_at IS NULL'} LIMIT 1`,
    [where.param],
  );
  if (!rows.length) return null;
  const [resource] = await hydrateResources(connection, rows.map(mapResource));
  return resource;
}

export async function listFolders() {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const [rows] = await db.query(
    `
      SELECT f.*,
        (SELECT COUNT(*) FROM resources r WHERE r.folder_id = f.id AND r.deleted_at IS NULL) AS resource_count
      FROM folders f
      WHERE f.workspace_id = ? AND f.deleted_at IS NULL
      ORDER BY f.parent_id IS NOT NULL, f.parent_id, f.sort_order, f.name
    `,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    publicId: row.public_id,
    parentId: row.parent_id ? Number(row.parent_id) : null,
    name: row.name,
    sortOrder: Number(row.sort_order),
    resourceCount: Number(row.resource_count),
  }));
}

export async function createFolder(input) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const parent = await resolveFolder(db, input.parentId, workspaceId);
  const name = normalizeTaxonomyName(input.name, 120);
  const [[duplicate]] = await db.query(
    `SELECT id FROM folders WHERE workspace_id = ? AND parent_id <=> ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL`,
    [workspaceId, parent?.id || null, name],
  );
  if (duplicate) throw httpError('同一目录下已经存在这个名称。', 409);
  const publicId = crypto.randomUUID();
  const [result] = await db.query(
    'INSERT INTO folders (public_id, workspace_id, parent_id, name) VALUES (?, ?, ?, ?)',
    [publicId, workspaceId, parent?.id || null, name],
  );
  return { id: Number(result.insertId), publicId, parentId: parent ? Number(parent.id) : null, name, sortOrder: 0, resourceCount: 0 };
}

async function assertFolderMoveIsAcyclic(db, folderId, parentId) {
  let current = parentId;
  const visited = new Set();
  while (current) {
    if (Number(current) === Number(folderId)) throw httpError('目录不能移动到自身或其子目录。');
    if (visited.has(Number(current))) throw httpError('目录结构存在循环。');
    visited.add(Number(current));
    const [[row]] = await db.query('SELECT parent_id FROM folders WHERE id = ? AND deleted_at IS NULL', [current]);
    current = row?.parent_id ? Number(row.parent_id) : null;
  }
}

export async function updateFolder(value, input) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const folder = await resolveFolder(db, value, workspaceId, { allowNull: false });
  const parent = input.parentId === undefined
    ? undefined
    : await resolveFolder(db, input.parentId, workspaceId);
  if (parent !== undefined) await assertFolderMoveIsAcyclic(db, folder.id, parent?.id || null);
  const name = input.name === undefined ? folder.name : normalizeTaxonomyName(input.name, 120);
  const parentId = parent === undefined ? folder.parent_id : parent?.id || null;
  const [[duplicate]] = await db.query(
    `SELECT id FROM folders WHERE workspace_id = ? AND parent_id <=> ? AND LOWER(name) = LOWER(?) AND id <> ? AND deleted_at IS NULL`,
    [workspaceId, parentId, name, folder.id],
  );
  if (duplicate) throw httpError('同一目录下已经存在这个名称。', 409);
  await db.query(
    'UPDATE folders SET name = ?, parent_id = ?, sort_order = ? WHERE id = ?',
    [name, parentId, input.sortOrder ?? folder.sort_order, folder.id],
  );
  return (await listFolders()).find((item) => item.id === Number(folder.id));
}

export async function deleteFolder(value) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const folder = await resolveFolder(db, value, workspaceId, { allowNull: false });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('UPDATE resources SET folder_id = NULL WHERE folder_id = ?', [folder.id]);
    await connection.query('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND deleted_at IS NULL', [folder.parent_id, folder.id]);
    await connection.query(
      "UPDATE folders SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = '用户删除目录' WHERE id = ?",
      [folder.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listTags() {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const [rows] = await db.query(
    `
      SELECT t.*,
        (SELECT COUNT(*) FROM task_tags tt WHERE tt.tag_id = t.id) AS task_count,
        (SELECT COUNT(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count,
        (SELECT COUNT(*) FROM resource_tags rt WHERE rt.tag_id = t.id) AS resource_count
      FROM tags t
      WHERE t.workspace_id = ? AND t.deleted_at IS NULL
      ORDER BY (task_count + note_count + resource_count) DESC, t.sort_order, t.name
    `,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: Number(row.id), publicId: row.public_id, name: row.name, color: row.color || null,
    counts: {
      tasks: Number(row.task_count), notes: Number(row.note_count), resources: Number(row.resource_count),
      total: Number(row.task_count) + Number(row.note_count) + Number(row.resource_count),
    },
  }));
}

export async function createTag(input) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const name = normalizeTaxonomyName(input.name);
  const key = normalizedTaxonomyKey(name);
  const [[existing]] = await db.query(
    'SELECT * FROM tags WHERE workspace_id = ? AND normalized_name = ? LIMIT 1',
    [workspaceId, key],
  );
  if (existing && !existing.deleted_at) throw httpError('这个标签已经存在。', 409);
  if (existing) {
    await db.query('UPDATE tags SET name = ?, color = ?, deleted_at = NULL WHERE id = ?', [name, input.color || null, existing.id]);
    return (await listTags()).find((item) => item.id === Number(existing.id));
  }
  const publicId = crypto.randomUUID();
  const [result] = await db.query(
    'INSERT INTO tags (public_id, workspace_id, name, normalized_name, color) VALUES (?, ?, ?, ?, ?)',
    [publicId, workspaceId, name, key, input.color || null],
  );
  return (await listTags()).find((item) => item.id === Number(result.insertId));
}

export async function updateTag(value, input) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const where = identifierWhere('t', value);
  const [[tag]] = await db.query(
    `SELECT t.* FROM tags t WHERE ${where.sql} AND t.workspace_id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [where.param, workspaceId],
  );
  if (!tag) throw httpError('标签不存在。', 404);
  const name = input.name === undefined ? tag.name : normalizeTaxonomyName(input.name);
  const key = normalizedTaxonomyKey(name);
  const [[duplicate]] = await db.query(
    'SELECT id FROM tags WHERE workspace_id = ? AND normalized_name = ? AND id <> ? AND deleted_at IS NULL',
    [workspaceId, key, tag.id],
  );
  if (duplicate) throw httpError('这个标签已经存在。', 409);
  await db.query('UPDATE tags SET name = ?, normalized_name = ?, color = ? WHERE id = ?', [name, key, input.color === undefined ? tag.color : input.color, tag.id]);
  return (await listTags()).find((item) => item.id === Number(tag.id));
}

export async function deleteTag(value) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const where = identifierWhere('t', value);
  const [[tag]] = await db.query(
    `SELECT t.id FROM tags t WHERE ${where.sql} AND t.workspace_id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [where.param, workspaceId],
  );
  if (!tag) throw httpError('标签不存在。', 404);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const table of ['task_tags', 'note_tags', 'resource_tags']) {
      await connection.query(`DELETE FROM ${table} WHERE tag_id = ?`, [tag.id]);
    }
    await connection.query('UPDATE tags SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [tag.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listResources(filters = {}) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const where = ['r.workspace_id = ?', 'r.deleted_at IS NULL'];
  const params = [workspaceId];
  if (filters.kind && ['file', 'link', 'text'].includes(filters.kind)) {
    where.push('r.kind = ?'); params.push(filters.kind);
  }
  if (filters.status && ['draft', 'processing', 'ready', 'failed'].includes(filters.status)) {
    where.push('r.status = ?'); params.push(filters.status);
  }
  if (filters.folderId === 'root') {
    where.push('r.folder_id IS NULL');
  } else if (filters.folderId) {
    const folder = await resolveFolder(db, filters.folderId, workspaceId, { allowNull: false });
    where.push('r.folder_id = ?'); params.push(folder.id);
  }
  if (filters.search) {
    const search = `%${String(filters.search).trim()}%`;
    where.push(`(r.title LIKE ? OR r.description LIKE ? OR EXISTS (
      SELECT 1 FROM resource_versions sv JOIN resource_contents sc ON sc.version_id = sv.id
      WHERE sv.resource_id = r.id AND (sc.extracted_text LIKE ? OR sc.summary LIKE ? OR sc.auto_description LIKE ?)
    ))`);
    params.push(search, search, search, search, search);
  }
  if (filters.tagId) {
    const tagIds = await resolveTagIds(db, [filters.tagId], workspaceId);
    where.push('EXISTS (SELECT 1 FROM resource_tags rt WHERE rt.resource_id = r.id AND rt.tag_id = ?)');
    params.push(tagIds[0]);
  }
  if (filters.targetType && filters.targetId && ['task', 'log', 'note'].includes(filters.targetType)) {
    where.push('EXISTS (SELECT 1 FROM resource_relations rr WHERE rr.resource_id = r.id AND rr.target_type = ? AND rr.target_id = ?)');
    params.push(filters.targetType, Number(filters.targetId));
  }
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 80)));
  const [rows] = await db.query(
    `${resourceSelect} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`,
    [...params, limit],
  );
  return hydrateResources(db, rows.map(mapResource));
}

export async function getResource(value) {
  const resource = await findResource(getPool(), value);
  if (!resource) throw httpError('资料不存在。', 404);
  return resource;
}

async function createResourceBase(connection, input, workspaceId, status) {
  const folder = await resolveFolder(connection, input.folderId, workspaceId);
  const tagIds = await resolveTagIds(connection, input.tagIds || [], workspaceId);
  const publicId = crypto.randomUUID();
  const [result] = await connection.query(
    `INSERT INTO resources
      (public_id, workspace_id, folder_id, kind, title, description, description_source, status, ai_visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      workspaceId,
      folder?.id || null,
      input.kind,
      input.title,
      input.description || null,
      input.description ? 'manual' : 'none',
      status,
      input.aiVisibility || 'inherit',
    ],
  );
  await setResourceTags(connection, result.insertId, tagIds);
  return { id: Number(result.insertId), publicId };
}

export async function createResource(input) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const connection = await db.getConnection();
  let resource;
  let versionId;
  try {
    await connection.beginTransaction();
    resource = await createResourceBase(connection, input, workspaceId, input.kind === 'text' ? 'ready' : 'processing');
    const [versionResult] = await connection.query(
      `INSERT INTO resource_versions
        (public_id, resource_id, version_no, source_url)
       VALUES (?, ?, 1, ?)`,
      [crypto.randomUUID(), resource.id, input.kind === 'link' ? input.url : null],
    );
    versionId = Number(versionResult.insertId);
    const text = input.kind === 'text' ? String(input.content || '').trim() : null;
    await connection.query(
      `INSERT INTO resource_contents
        (version_id, status, parser, extracted_text, summary, text_chars, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        input.kind === 'text' ? 'completed' : 'pending',
        input.kind === 'text' ? 'text' : null,
        text,
        text ? text.replace(/\s+/g, ' ').slice(0, 360) : null,
        text?.length || 0,
        text ? crypto.createHash('sha256').update(text).digest('hex') : null,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (input.kind === 'link') await queueResourceProcessing(resource.id, versionId);
  else scheduleIndexJob({ targetType: 'resources', targetId: resource.id, operation: 'upsert', reason: 'text resource created' });
  return getResource(resource.id);
}

async function sha256File(filePath) {
  const buffer = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function createFileResource(file, input = {}) {
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const checksum = await sha256File(file.path);
  const [duplicates] = await db.query(
    `
      SELECT r.id, r.public_id, r.title
      FROM resource_versions v
      JOIN resources r ON r.id = v.resource_id
      WHERE v.checksum_sha256 = ? AND r.deleted_at IS NULL
      ORDER BY r.updated_at DESC LIMIT 5
    `,
    [checksum],
  );
  const publicId = crypto.randomUUID();
  const key = await persistUploadedFile(file, 'resources', publicId);
  const provider = activeStorageProvider();
  const connection = await db.getConnection();
  let resourceId;
  let versionId;
  try {
    await connection.beginTransaction();
    const resource = await createResourceBase(connection, {
      kind: 'file',
      title: input.title || file.originalname,
      description: input.description,
      folderId: input.folderId,
      aiVisibility: input.aiVisibility,
      tagIds: input.tagIds || [],
    }, workspaceId, 'processing');
    resourceId = resource.id;
    await connection.query('UPDATE resources SET public_id = ? WHERE id = ?', [publicId, resourceId]);
    const [versionResult] = await connection.query(
      `INSERT INTO resource_versions
        (public_id, resource_id, version_no, original_name, stored_name, relative_path,
         storage_provider, storage_key, mime_type, file_size, checksum_sha256)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(), resourceId, file.originalname, file.filename,
        provider === 'local' ? `uploads/${key}` : key, provider, key,
        file.mimetype || 'application/octet-stream', file.size, checksum,
      ],
    );
    versionId = Number(versionResult.insertId);
    await connection.query('INSERT INTO resource_contents (version_id, status) VALUES (?, ?)', [versionId, 'pending']);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await removeStoredAttachment({ storage_provider: provider, storage_key: key, relative_path: `uploads/${key}` }).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  await queueResourceProcessing(resourceId, versionId);
  return { resource: await getResource(resourceId), duplicates: duplicates.map((row) => ({ id: Number(row.id), publicId: row.public_id, title: row.title })) };
}

export async function updateResource(value, input) {
  const db = getPool();
  const existing = await findResource(db, value);
  if (!existing) throw httpError('资料不存在。', 404);
  const workspaceId = existing.workspaceId;
  const folder = input.folderId === undefined ? undefined : await resolveFolder(db, input.folderId, workspaceId);
  const tagIds = input.tagIds === undefined ? null : await resolveTagIds(db, input.tagIds, workspaceId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const nextDescription = input.description === undefined ? existing.description || null : input.description || null;
    const nextDescriptionSource = input.description === undefined
      ? existing.descriptionSource
      : (String(input.description || '').trim() ? 'manual' : 'none');
    await connection.query(
      `UPDATE resources
       SET title = ?, description = ?, description_source = ?, folder_id = ?, ai_visibility = ?
       WHERE id = ?`,
      [
        input.title ?? existing.title,
        nextDescription,
        nextDescriptionSource,
        folder === undefined ? existing.folderId : folder?.id || null,
        input.aiVisibility ?? existing.aiVisibility,
        existing.id,
      ],
    );
    await setResourceTags(connection, existing.id, tagIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  scheduleIndexJob({ targetType: 'resources', targetId: existing.id, operation: 'upsert', reason: 'resource metadata updated' });
  return getResource(existing.id);
}

export async function deleteResource(value, reason = '') {
  const resource = await getResource(value);
  await getPool().query(
    'UPDATE resources SET deleted_at = CURRENT_TIMESTAMP, deleted_reason = ? WHERE id = ?',
    [String(reason || '用户删除资料').slice(0, 255), resource.id],
  );
  scheduleIndexJob({ targetType: 'resources', targetId: resource.id, operation: 'delete', reason: 'resource moved to trash' });
}

async function validateRelationTarget(connection, type, id) {
  const table = { task: 'tasks', log: 'work_logs', note: 'notes' }[type];
  const [[target]] = await connection.query(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [id]);
  if (!target) throw httpError('关联目标不存在。', 404);
}

export async function addResourceRelation(value, input) {
  const db = getPool();
  const resource = await getResource(value);
  await validateRelationTarget(db, input.targetType, input.targetId);
  await db.query(
    `INSERT INTO resource_relations (resource_id, target_type, target_id, relation_type)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE relation_type = VALUES(relation_type)`,
    [resource.id, input.targetType, input.targetId, input.relationType || 'reference'],
  );
  scheduleIndexJob({ targetType: 'resources', targetId: resource.id, operation: 'upsert', reason: 'resource relation added' });
  return getResource(resource.id);
}

export async function deleteResourceRelation(value, relationId) {
  const resource = await getResource(value);
  const [result] = await getPool().query('DELETE FROM resource_relations WHERE id = ? AND resource_id = ?', [relationId, resource.id]);
  if (!result.affectedRows) throw httpError('资料关联不存在。', 404);
  scheduleIndexJob({ targetType: 'resources', targetId: resource.id, operation: 'upsert', reason: 'resource relation removed' });
  return getResource(resource.id);
}

export async function listResourceVersions(value) {
  const resource = await getResource(value);
  const [rows] = await getPool().query(
    `SELECT v.*, v.id AS version_id, v.public_id AS version_public_id,
       v.created_at AS version_created_at, ? AS resource_public_id,
       c.status AS content_status, c.parser, c.text_chars, c.error_message
     FROM resource_versions v LEFT JOIN resource_contents c ON c.version_id = v.id
     WHERE v.resource_id = ? ORDER BY v.version_no DESC`,
    [resource.publicId, resource.id],
  );
  return rows.map((row) => ({ ...mapVersion(row), contentStatus: row.content_status, parser: row.parser, textChars: Number(row.text_chars || 0), error: row.error_message || '' }));
}

export async function addFileVersion(value, file) {
  const db = getPool();
  const resource = await getResource(value);
  if (resource.kind !== 'file') throw httpError('只有文件资料可以上传文件版本。');
  const checksum = await sha256File(file.path);
  const [[same]] = await db.query(
    'SELECT id FROM resource_versions WHERE resource_id = ? AND checksum_sha256 = ? LIMIT 1',
    [resource.id, checksum],
  );
  if (same) throw httpError('该文件内容已经存在于此资料的版本历史中。', 409);
  const key = await persistUploadedFile(file, 'resources', resource.publicId);
  const provider = activeStorageProvider();
  const connection = await db.getConnection();
  let versionId;
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.query('SELECT COALESCE(MAX(version_no), 0) AS version_no FROM resource_versions WHERE resource_id = ? FOR UPDATE', [resource.id]);
    const [result] = await connection.query(
      `INSERT INTO resource_versions
        (public_id, resource_id, version_no, original_name, stored_name, relative_path,
         storage_provider, storage_key, mime_type, file_size, checksum_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), resource.id, Number(current.version_no) + 1, file.originalname, file.filename,
        provider === 'local' ? `uploads/${key}` : key, provider, key, file.mimetype, file.size, checksum],
    );
    versionId = Number(result.insertId);
    await connection.query('INSERT INTO resource_contents (version_id, status) VALUES (?, ?)', [versionId, 'pending']);
    await connection.query("UPDATE resources SET status = 'processing' WHERE id = ?", [resource.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await removeStoredAttachment({ storage_provider: provider, storage_key: key, relative_path: `uploads/${key}` }).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  await queueResourceProcessing(resource.id, versionId);
  return getResource(resource.id);
}

export async function getResourceVersion(resourceValue, versionValue) {
  const resource = await getResource(resourceValue);
  const where = identifierWhere('v', versionValue);
  const [[version]] = await getPool().query(
    `SELECT v.* FROM resource_versions v WHERE ${where.sql} AND v.resource_id = ? LIMIT 1`,
    [where.param, resource.id],
  );
  if (!version) throw httpError('资料版本不存在。', 404);
  return { resource, version };
}

export async function reprocessResource(value) {
  const resource = await getResource(value);
  if (!resource.latestVersion) throw httpError('资料没有可处理的版本。');
  await queueResourceProcessing(resource.id, resource.latestVersion.id);
  return { ...resource, status: 'processing' };
}

export async function processResourceNow(value) {
  const resource = await getResource(value);
  if (!resource.latestVersion) throw httpError('资料没有可处理的版本。');
  await processResourceVersion(resource.latestVersion.id);
  return getResource(resource.id);
}

function entityTagDescriptor(type) {
  return {
    task: { table: 'task_tags', ownerKey: 'task_id', ownerTable: 'tasks' },
    note: { table: 'note_tags', ownerKey: 'note_id', ownerTable: 'notes' },
    resource: { table: 'resource_tags', ownerKey: 'resource_id', ownerTable: 'resources' },
  }[type] || null;
}

export async function getEntityTags(type, entityId) {
  const descriptor = entityTagDescriptor(type);
  if (!descriptor) throw httpError('不支持的标签目标类型。');
  const id = numericId(entityId);
  if (!id) throw httpError('目标 ID 无效。');
  const [[owner]] = await getPool().query(
    `SELECT id FROM ${descriptor.ownerTable} WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!owner) throw httpError('标签目标不存在。', 404);
  const [rows] = await getPool().query(
    `SELECT t.id, t.public_id, t.name, t.color
     FROM ${descriptor.table} et JOIN tags t ON t.id = et.tag_id
     WHERE et.${descriptor.ownerKey} = ? AND t.deleted_at IS NULL
     ORDER BY t.sort_order, t.name`,
    [id],
  );
  return rows.map((row) => ({ id: Number(row.id), publicId: row.public_id, name: row.name, color: row.color || null }));
}

export async function setEntityTags(type, entityId, values) {
  const descriptor = entityTagDescriptor(type);
  if (!descriptor) throw httpError('不支持的标签目标类型。');
  const id = numericId(entityId);
  if (!id) throw httpError('目标 ID 无效。');
  const db = getPool();
  const workspaceId = await defaultWorkspaceId(db);
  const [[owner]] = await db.query(
    `SELECT id FROM ${descriptor.ownerTable} WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!owner) throw httpError('标签目标不存在。', 404);
  const tagIds = await resolveTagIds(db, values, workspaceId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM ${descriptor.table} WHERE ${descriptor.ownerKey} = ?`, [id]);
    for (const tagId of tagIds) {
      await connection.query(
        `INSERT INTO ${descriptor.table} (${descriptor.ownerKey}, tag_id, source) VALUES (?, ?, 'manual')`,
        [id, tagId],
      );
    }
    const [tagRows] = tagIds.length
      ? await connection.query(`SELECT name FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')}) ORDER BY name`, tagIds)
      : [[]];
    if (type === 'task') {
      await connection.query('UPDATE tasks SET tags = ? WHERE id = ?', [tagRows.map((row) => row.name).join(', ') || null, id]);
    } else if (type === 'note') {
      await connection.query('UPDATE task_notes SET category = ? WHERE id = ?', [tagRows[0]?.name || null, id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getEntityTags(type, id);
}

export async function searchWorkspaceV1(query, limit = 30) {
  const db = getPool();
  const term = String(query || '').trim();
  if (!term) throw httpError('请输入搜索关键词。');
  const like = `%${term}%`;
  const rowLimit = Math.max(1, Math.min(100, Number(limit || 30)));
  const [tasks] = await db.query(
    `SELECT id, title, description, status, updated_at FROM tasks
     WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)
     ORDER BY updated_at DESC LIMIT ?`,
    [like, like, like, rowLimit],
  );
  const [notes] = await db.query(
    `SELECT id, public_id, title, content, updated_at FROM notes
     WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?)
     ORDER BY updated_at DESC LIMIT ?`,
    [like, like, rowLimit],
  );
  const resources = await listResources({ search: term, limit: rowLimit });
  return {
    query: term,
    tasks: tasks.map((row) => ({ id: Number(row.id), title: row.title, excerpt: row.description || '', status: row.status, updatedAt: row.updated_at })),
    notes: notes.map((row) => ({ id: Number(row.id), publicId: row.public_id, title: row.title, excerpt: String(row.content || '').slice(0, 360), updatedAt: row.updated_at })),
    resources,
  };
}
