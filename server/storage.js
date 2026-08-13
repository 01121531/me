import { createReadStream, promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from './config.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let s3Client;

function storageKey(kind, ownerId, storedName) {
  return `${kind}/${ownerId}/${storedName}`;
}

function legacyLocalPath(attachment) {
  const relativePath = String(attachment.relative_path || '');
  const absolute = path.resolve(projectRoot, relativePath);
  const legacyRoot = path.resolve(projectRoot, 'uploads');
  if (!absolute.startsWith(legacyRoot)) {
    throw new Error('Invalid attachment path.');
  }
  return absolute;
}

function localPathForAttachment(attachment) {
  if (attachment.storage_key) {
    const absolute = path.resolve(config.storage.localRoot, attachment.storage_key);
    if (!absolute.startsWith(config.storage.localRoot)) {
      throw new Error('Invalid attachment storage key.');
    }
    return absolute;
  }
  return legacyLocalPath(attachment);
}

function contentDisposition(filename, disposition) {
  const safeFallback = String(filename || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  return `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename || 'attachment')}`;
}

function isS3Storage() {
  return config.storage.driver === 's3';
}

export function activeStorageProvider() {
  return isS3Storage() ? 's3' : 'local';
}

function getS3Client() {
  if (!isS3Storage()) return null;
  if (s3Client) return s3Client;

  const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle } = config.storage.s3;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 storage requires S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
  }

  s3Client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
}

export async function initializeStorage() {
  if (!isS3Storage()) {
    await fsp.mkdir(config.storage.localRoot, { recursive: true });
    return;
  }

  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.s3.bucket }));
  } catch (error) {
    const code = error?.name || error?.Code;
    if (!['NotFound', 'NoSuchBucket', 'NotFoundError'].includes(code)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: config.storage.s3.bucket }));
  }
}

export async function persistUploadedFile(file, kind, ownerId) {
  const key = storageKey(kind, ownerId, file.filename);
  if (!isS3Storage()) {
    const destination = path.resolve(config.storage.localRoot, key);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    if (path.resolve(file.path) !== destination) {
      await fsp.rename(file.path, destination);
    }
    return key;
  }

  const client = getS3Client();
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.storage.s3.bucket,
      Key: key,
      Body: createReadStream(file.path),
      ContentType: file.mimetype || 'application/octet-stream',
      ContentLength: file.size,
    }));
  } finally {
    await fsp.unlink(file.path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return key;
}

export async function removeStoredAttachment(attachment) {
  if (attachment.storage_provider !== 's3' || !attachment.storage_key) {
    await fsp.unlink(localPathForAttachment(attachment)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return;
  }

  await getS3Client().send(new DeleteObjectCommand({
    Bucket: config.storage.s3.bucket,
    Key: attachment.storage_key,
  }));
}

async function streamToBuffer(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error(`Attachment exceeds the ${maxBytes} byte parsing limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readStoredAttachment(attachment, maxBytes) {
  if (attachment.storage_provider !== 's3' || !attachment.storage_key) {
    const filePath = localPathForAttachment(attachment);
    const stats = await fsp.stat(filePath);
    if (stats.size > maxBytes) {
      throw new Error(`Attachment exceeds the ${maxBytes} byte parsing limit.`);
    }
    return fsp.readFile(filePath);
  }

  const object = await getS3Client().send(new GetObjectCommand({
    Bucket: config.storage.s3.bucket,
    Key: attachment.storage_key,
  }));
  if (object.ContentLength && object.ContentLength > maxBytes) {
    throw new Error(`Attachment exceeds the ${maxBytes} byte parsing limit.`);
  }
  return streamToBuffer(object.Body, maxBytes);
}

export async function sendStoredAttachment(res, attachment, { disposition = 'inline' } = {}) {
  res.type(attachment.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(attachment.original_name, disposition));

  if (attachment.storage_provider !== 's3' || !attachment.storage_key) {
    res.sendFile(localPathForAttachment(attachment));
    return;
  }

  const object = await getS3Client().send(new GetObjectCommand({
    Bucket: config.storage.s3.bucket,
    Key: attachment.storage_key,
  }));
  if (object.ContentLength) res.setHeader('Content-Length', object.ContentLength);
  object.Body.on('error', (error) => res.destroy(error));
  object.Body.pipe(res);
}
