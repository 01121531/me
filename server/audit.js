import crypto from 'crypto';
import { getPool } from './db.js';
import { publishWorkspaceEvent } from './events.js';
import { scheduleIndexJob } from './indexing.js';

const mutatingMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const sensitiveKeys = new Set(['password', 'token', 'authorization', 'secret', 'accessToken', 'refreshToken']);

function sanitizePayload(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return value ?? null;
  if (typeof value === 'string') {
    return value.length > 600 ? `${value.slice(0, 600)}...` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeys.has(key) ? '[redacted]' : sanitizePayload(item, depth + 1),
    ]));
  }
  return value;
}

function inferTarget(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const numericId = [...parts].reverse().find((part) => /^\d+$/.test(part));
  const type = parts.find((part) => [
    'tasks',
    'logs',
    'notes',
    'attachments',
    'note-attachments',
    'task-attachments',
    'action-requests',
  ].includes(part));
  return { targetType: type || null, targetId: numericId || null };
}

export function observeApiWrites(req, res, next) {
  if (!mutatingMethods.has(req.method) || req.path.startsWith('/auth/') || req.path.startsWith('/ai/')) {
    next();
    return;
  }

  const requestId = req.get('x-request-id') || crypto.randomUUID();
  const action = `${req.method} ${req.path}`;
  const actor = req.auth || { type: 'local', id: null };
  const payload = sanitizePayload({
    body: req.body,
    files: (req.files || []).map((file) => ({ name: file.originalname, size: file.size, type: file.mimetype })),
  });

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const { targetType, targetId } = res.locals.auditTarget || inferTarget(req.path);
    publishWorkspaceEvent({ requestId, action, targetType, targetId });
    scheduleIndexJob({
      targetType,
      targetId,
      operation: req.method === 'DELETE' ? 'delete' : 'upsert',
      reason: action,
    });
    getPool().query(
      `
        INSERT INTO audit_events
          (request_id, actor_type, actor_id, action, target_type, target_id, request_payload, result_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requestId,
        actor.type || 'local',
        actor.id || null,
        action,
        targetType,
        targetId,
        JSON.stringify(payload),
        res.statusCode,
      ],
    ).catch((error) => {
      console.error('Failed to write audit event:', error.message);
    });
  });

  next();
}
