import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../../../../../server/config.js';
import { publishWorkspaceEvent } from '../../../../../server/events.js';
import { sendStoredAttachment } from '../../../../../server/storage.js';
import {
  folderCreateSchema,
  folderUpdateSchema,
  parseContract,
  resourceCreateSchema,
  resourceRelationSchema,
  resourceUpdateSchema,
  tagCreateSchema,
  tagUpdateSchema,
} from '../../../../../packages/contracts/src/workspace.js';
import {
  addFileVersion,
  addResourceRelation,
  createFileResource,
  createFolder,
  createResource,
  createTag,
  deleteFolder,
  deleteResource,
  deleteResourceRelation,
  deleteTag,
  getEntityTags,
  getResource,
  getResourceVersion,
  listFolders,
  listResources,
  listResourceVersions,
  listTags,
  reprocessResource,
  searchWorkspaceV1,
  setEntityTags,
  updateFolder,
  updateResource,
  updateTag,
} from './service.js';

const allowedExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.pdf', '.doc', '.docx',
  '.xls', '.xlsx', '.csv', '.zip', '.rar', '.7z', '.tar', '.gz', '.txt', '.md',
]);

function cleanFileName(name) {
  const raw = String(name || 'resource');
  const recovered = Buffer.from(raw, 'latin1').toString('utf8');
  const candidate = recovered !== raw && !recovered.includes('\uFFFD') ? recovered : raw;
  return candidate.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim() || 'resource';
}

const stagingRoot = path.join(config.storage.localRoot, '.staging', 'resources');
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdir(stagingRoot, { recursive: true }, (error) => callback(error, stagingRoot));
    },
    filename(_req, file, callback) {
      callback(null, `${Date.now()}-${crypto.randomUUID()}-${cleanFileName(file.originalname)}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, callback) {
    if (!allowedExtensions.has(path.extname(file.originalname).toLowerCase())) {
      callback(new Error('仅支持图片、PDF、Word、Excel、文本和常见压缩包。'));
      return;
    }
    callback(null, true);
  },
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function changed(type, id, operation = 'update') {
  publishWorkspaceEvent({ targetType: type, targetId: String(id || ''), operation });
}

function parseUploadMetadata(body) {
  let tagIds = [];
  try {
    tagIds = body.tagIds ? JSON.parse(body.tagIds) : [];
  } catch {
    const error = new Error('tagIds 必须是 JSON 数组。');
    error.statusCode = 400;
    throw error;
  }
  return {
    title: String(body.title || '').trim() || undefined,
    description: String(body.description || '').trim() || null,
    folderId: body.folderId || null,
    aiVisibility: ['inherit', 'allow', 'deny'].includes(body.aiVisibility) ? body.aiVisibility : 'inherit',
    tagIds,
  };
}

export function installWorkspaceV1Routes(app) {
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.1.0',
      info: { title: 'Assistant Workspace API', version: '1.0.0' },
      paths: {
        '/api/v1/resources': { get: { summary: '资料列表' }, post: { summary: '创建链接或文本资料' } },
        '/api/v1/resources/upload': { post: { summary: '上传文件资料' } },
        '/api/v1/folders': { get: { summary: '目录列表' }, post: { summary: '创建目录' } },
        '/api/v1/tags': { get: { summary: '标签列表' }, post: { summary: '创建标签' } },
        '/api/v1/search': { get: { summary: '统一搜索' } },
      },
    });
  });

  app.get('/api/v1/folders', asyncRoute(async (_req, res) => res.json({ folders: await listFolders() })));
  app.post('/api/v1/folders', asyncRoute(async (req, res) => {
    const folder = await createFolder(parseContract(folderCreateSchema, req.body));
    changed('folders', folder.id, 'create');
    res.status(201).json(folder);
  }));
  app.patch('/api/v1/folders/:id', asyncRoute(async (req, res) => {
    const folder = await updateFolder(req.params.id, parseContract(folderUpdateSchema, req.body));
    changed('folders', folder.id);
    res.json(folder);
  }));
  app.delete('/api/v1/folders/:id', asyncRoute(async (req, res) => {
    await deleteFolder(req.params.id);
    changed('folders', req.params.id, 'delete');
    res.status(204).end();
  }));

  app.get('/api/v1/tags', asyncRoute(async (_req, res) => res.json({ tags: await listTags() })));
  app.post('/api/v1/tags', asyncRoute(async (req, res) => {
    const tag = await createTag(parseContract(tagCreateSchema, req.body));
    changed('tags', tag.id, 'create');
    res.status(201).json(tag);
  }));
  app.patch('/api/v1/tags/:id', asyncRoute(async (req, res) => {
    const tag = await updateTag(req.params.id, parseContract(tagUpdateSchema, req.body));
    changed('tags', tag.id);
    res.json(tag);
  }));
  app.delete('/api/v1/tags/:id', asyncRoute(async (req, res) => {
    await deleteTag(req.params.id);
    changed('tags', req.params.id, 'delete');
    res.status(204).end();
  }));
  app.get('/api/v1/entities/:type/:id/tags', asyncRoute(async (req, res) => {
    res.json({ tags: await getEntityTags(req.params.type, req.params.id) });
  }));
  app.put('/api/v1/entities/:type/:id/tags', asyncRoute(async (req, res) => {
    if (!Array.isArray(req.body.tagIds)) {
      const error = new Error('tagIds 必须是数组。');
      error.statusCode = 400;
      throw error;
    }
    const tags = await setEntityTags(req.params.type, req.params.id, req.body.tagIds);
    changed(req.params.type, req.params.id);
    res.json({ tags });
  }));

  app.get('/api/v1/resources', asyncRoute(async (req, res) => {
    const resources = await listResources(req.query);
    res.json({ resources, count: resources.length });
  }));
  app.post('/api/v1/resources', asyncRoute(async (req, res) => {
    const resource = await createResource(parseContract(resourceCreateSchema, req.body));
    changed('resources', resource.id, 'create');
    res.status(201).json(resource);
  }));
  app.post('/api/v1/resources/upload', upload.array('files', 10), asyncRoute(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      const error = new Error('请选择要上传的文件。');
      error.statusCode = 400;
      throw error;
    }
    const metadata = parseUploadMetadata(req.body || {});
    const results = [];
    for (const file of files) {
      file.originalname = cleanFileName(file.originalname);
      results.push(await createFileResource(file, {
        ...metadata,
        title: files.length === 1 ? metadata.title : undefined,
      }));
    }
    results.forEach((item) => changed('resources', item.resource.id, 'create'));
    res.status(201).json({ items: results });
  }));
  app.get('/api/v1/resources/:id', asyncRoute(async (req, res) => res.json(await getResource(req.params.id))));
  app.patch('/api/v1/resources/:id', asyncRoute(async (req, res) => {
    const resource = await updateResource(req.params.id, parseContract(resourceUpdateSchema, req.body));
    changed('resources', resource.id);
    res.json(resource);
  }));
  app.delete('/api/v1/resources/:id', asyncRoute(async (req, res) => {
    await deleteResource(req.params.id, req.body?.reason);
    changed('resources', req.params.id, 'delete');
    res.status(204).end();
  }));
  app.get('/api/v1/resources/:id/versions', asyncRoute(async (req, res) => {
    res.json({ versions: await listResourceVersions(req.params.id) });
  }));
  app.post('/api/v1/resources/:id/versions', upload.single('file'), asyncRoute(async (req, res) => {
    if (!req.file) {
      const error = new Error('请选择新版本文件。');
      error.statusCode = 400;
      throw error;
    }
    req.file.originalname = cleanFileName(req.file.originalname);
    const resource = await addFileVersion(req.params.id, req.file);
    changed('resources', resource.id);
    res.status(201).json(resource);
  }));
  app.post('/api/v1/resources/:id/relations', asyncRoute(async (req, res) => {
    const resource = await addResourceRelation(req.params.id, parseContract(resourceRelationSchema, req.body));
    changed('resources', resource.id);
    res.status(201).json(resource);
  }));
  app.delete('/api/v1/resources/:id/relations/:relationId', asyncRoute(async (req, res) => {
    const resource = await deleteResourceRelation(req.params.id, req.params.relationId);
    changed('resources', resource.id);
    res.json(resource);
  }));
  app.post('/api/v1/resources/:id/reprocess', asyncRoute(async (req, res) => {
    const resource = await reprocessResource(req.params.id);
    changed('resources', resource.id);
    res.status(202).json(resource);
  }));
  app.get('/api/v1/resources/:id/versions/:versionId/preview', asyncRoute(async (req, res) => {
    const { version } = await getResourceVersion(req.params.id, req.params.versionId);
    if (!version.storage_key) {
      const error = new Error('该资料版本没有可预览文件。');
      error.statusCode = 404;
      throw error;
    }
    await sendStoredAttachment(res, version, { disposition: 'inline' });
  }));
  app.get('/api/v1/resources/:id/versions/:versionId/download', asyncRoute(async (req, res) => {
    const { version } = await getResourceVersion(req.params.id, req.params.versionId);
    if (!version.storage_key) {
      const error = new Error('该资料版本没有可下载文件。');
      error.statusCode = 404;
      throw error;
    }
    await sendStoredAttachment(res, version, { disposition: 'attachment' });
  }));
  app.get('/api/v1/search', asyncRoute(async (req, res) => {
    res.json(await searchWorkspaceV1(req.query.q, req.query.limit));
  }));
}
