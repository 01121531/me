import crypto from 'crypto';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { getPool } from '../db.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const weixinTempRoot = path.join(projectRoot, '.deploy', 'weixin-temp');

function safeFileName(value) {
  const cleaned = String(value || '微信附件')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || '微信附件').slice(0, 220);
}

function assertPathInsideTempRoot(filePath) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(weixinTempRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('微信临时附件路径不合法。');
  }
  return absolute;
}

export function temporaryMediaPath(row) {
  return assertPathInsideTempRoot(row.stored_path);
}

export async function saveTemporaryMedia({
  accountId,
  peerId,
  originalName,
  mimeType = 'application/octet-stream',
  buffer,
}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('微信附件内容为空。');
  if (buffer.length > config.weixin.maxMediaBytes) {
    throw new Error(`微信附件超过 ${Math.round(config.weixin.maxMediaBytes / 1024 / 1024)}MB 限制。`);
  }

  const id = crypto.randomUUID();
  const fileName = safeFileName(originalName);
  const filePath = path.join(weixinTempRoot, `${id}-${fileName}`);
  const expiresAt = new Date(Date.now() + config.weixin.tempTtlHours * 60 * 60 * 1000);
  await fsp.mkdir(weixinTempRoot, { recursive: true });
  await fsp.writeFile(filePath, buffer, { mode: 0o600 });

  try {
    await getPool().query(
      `
        INSERT INTO weixin_temp_media
          (id, account_id, peer_id, original_name, stored_path, mime_type, file_size, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(accountId || '').slice(0, 191),
        String(peerId || '').slice(0, 191),
        fileName,
        filePath,
        String(mimeType || 'application/octet-stream').slice(0, 120),
        buffer.length,
        expiresAt,
      ],
    );
  } catch (error) {
    await fsp.unlink(filePath).catch(() => {});
    throw error;
  }

  return getTemporaryMedia(id);
}

export async function getTemporaryMedia(id, { includeUnavailable = false } = {}) {
  const where = includeUnavailable
    ? 'id = ?'
    : "id = ? AND status = 'temporary' AND expires_at > CURRENT_TIMESTAMP";
  const [rows] = await getPool().query(`SELECT * FROM weixin_temp_media WHERE ${where} LIMIT 1`, [String(id)]);
  return rows[0] || null;
}

export async function updateTemporaryMediaText(id, extractedText) {
  await getPool().query(
    `UPDATE weixin_temp_media SET extracted_text = ? WHERE id = ? AND status = 'temporary'`,
    [String(extractedText || '').slice(0, config.ai.attachmentParsing.maxChars), String(id)],
  );
  return getTemporaryMedia(id);
}

export async function listRecentTemporaryMedia(accountId, peerId, { limit = 5 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  const [rows] = await getPool().query(
    `
      SELECT *
      FROM weixin_temp_media
      WHERE account_id = ? AND peer_id = ?
        AND status = 'temporary' AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [String(accountId), String(peerId), normalizedLimit],
  );
  return rows;
}

export async function markTemporaryMediaSaved(connection, id) {
  await connection.query(
    "UPDATE weixin_temp_media SET status = 'saved' WHERE id = ? AND status = 'temporary'",
    [String(id)],
  );
}

export async function cleanupExpiredTemporaryMedia() {
  const [rows] = await getPool().query(
    `
      SELECT m.*
      FROM weixin_temp_media m
      WHERE m.status = 'temporary' AND m.expires_at <= CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM mcp_action_requests a
          WHERE a.status = 'pending'
            AND JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.tempMediaId')) = m.id
        )
      LIMIT 200
    `,
  );
  for (const row of rows) {
    await fsp.unlink(temporaryMediaPath(row)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await getPool().query("UPDATE weixin_temp_media SET status = 'expired' WHERE id = ?", [row.id]);
  }
  return rows.length;
}

export async function removeAllTemporaryMedia() {
  const [rows] = await getPool().query("SELECT * FROM weixin_temp_media WHERE status = 'temporary'");
  for (const row of rows) {
    await fsp.unlink(temporaryMediaPath(row)).catch(() => {});
  }
  await getPool().query("UPDATE weixin_temp_media SET status = 'expired' WHERE status = 'temporary'");
}

export { safeFileName as sanitizeWeixinFileName };
