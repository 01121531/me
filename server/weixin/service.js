import crypto from 'crypto';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { answerWorkspace } from '../ai/search.js';
import { planAiActionRequest } from '../ai/action-planner.js';
import { extractTemporaryAttachmentText } from '../ai/attachment-cache.js';
import { createActionRequest } from '../action-requests.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { readStoredAttachment } from '../storage.js';
import {
  cleanupExpiredTemporaryMedia,
  listRecentTemporaryMedia,
  removeAllTemporaryMedia,
  saveTemporaryMedia,
  updateTemporaryMediaText,
  weixinTempRoot,
} from './temp-media.js';
import {
  WEIXIN_ITEM_TYPES,
  downloadWeixinMediaItem,
  getWeixinUpdates,
  normalizeBaseUrl,
  notifyWeixinStart,
  notifyWeixinStop,
  pollWeixinQrLogin,
  sendWeixinMedia,
  sendWeixinText,
  startWeixinQrLogin,
} from './protocol.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deployRoot = path.join(projectRoot, '.deploy');
const credentialPath = path.join(deployRoot, 'weixin-channel.enc.json');
const credentialKeyPath = path.join(deployRoot, 'weixin-channel.key');
const outboundRoot = path.join(deployRoot, 'weixin-outbound');
const clients = new Set();
const loginTtlMs = 5 * 60 * 1000;
const cleanupIntervalMs = 60 * 60 * 1000;
const logLimit = 40;

let credentials = null;
let loginSession = null;
let loginController = null;
let monitorController = null;
let cleanupTimer = null;
let credentialWrite = Promise.resolve();
let runtime = {
  status: 'disconnected',
  connected: false,
  phase: 'idle',
  accountId: '',
  qrDataUrl: '',
  qrExpiresAt: null,
  needsVerifyCode: false,
  lastInboundAt: null,
  lastOutboundAt: null,
  lastPollAt: null,
  connectedAt: null,
  error: '',
  logs: [],
};

function nowIso() {
  return new Date().toISOString();
}

function publicState() {
  return {
    ...runtime,
    logs: runtime.logs.slice(-logLimit),
    temporaryMediaTtlHours: config.weixin.tempTtlHours,
    maxMediaMb: Math.round(config.weixin.maxMediaBytes / 1024 / 1024),
    privateChatOnly: true,
    canSendResources: Boolean(
      runtime.connected
      && credentials?.token
      && credentials?.replyPeerId
      && credentials?.replyContextToken,
    ),
  };
}

function writeSse(res, event, payload) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function publishState(event = 'weixin.state') {
  const state = publicState();
  for (const client of clients) {
    if (!writeSse(client.res, event, { state, at: nowIso() })) {
      clearInterval(client.heartbeat);
      clients.delete(client);
    }
  }
}

function patchState(patch, event = 'weixin.state') {
  runtime = { ...runtime, ...patch };
  publishState(event);
}

function appendLog(message) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
  if (!line.trim()) return;
  runtime.logs = [...runtime.logs, line].slice(-logLimit);
  publishState('weixin.log');
}

async function ensureCredentialKey() {
  await fsp.mkdir(deployRoot, { recursive: true });
  try {
    const key = await fsp.readFile(credentialKeyPath);
    if (key.length === 32) return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(32);
  await fsp.writeFile(credentialKeyPath, key, { mode: 0o600, flag: 'wx' });
  return key;
}

async function encryptCredentials(value) {
  const key = await ensureCredentialKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

async function decryptCredentials(payload) {
  const key = await ensureCredentialKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function loadCredentials() {
  try {
    return decryptCredentials(JSON.parse(await fsp.readFile(credentialPath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    appendLog(`微信凭证读取失败：${error.message}`);
    return null;
  }
}

function queueCredentialSave() {
  const snapshot = credentials ? { ...credentials } : null;
  credentialWrite = credentialWrite.then(async () => {
    await fsp.mkdir(deployRoot, { recursive: true });
    if (!snapshot) {
      await fsp.unlink(credentialPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return;
    }
    const encrypted = await encryptCredentials(snapshot);
    const temporaryPath = `${credentialPath}.${process.pid}.tmp`;
    await fsp.writeFile(temporaryPath, JSON.stringify(encrypted), { mode: 0o600 });
    await fsp.rename(temporaryPath, credentialPath);
  }).catch((error) => appendLog(`微信状态保存失败：${error.message}`));
  return credentialWrite;
}

function rememberReplyContext(peerId, contextToken) {
  const normalizedPeerId = String(peerId || '').trim();
  const normalizedContextToken = String(contextToken || '').trim();
  if (!credentials || !normalizedPeerId || !normalizedContextToken) return;
  if (
    credentials.replyPeerId === normalizedPeerId
    && credentials.replyContextToken === normalizedContextToken
  ) return;
  credentials = {
    ...credentials,
    replyPeerId: normalizedPeerId,
    replyContextToken: normalizedContextToken,
  };
  queueCredentialSave();
  publishState();
}

function abortLogin() {
  loginController?.abort();
  loginController = null;
  loginSession = null;
}

async function stopMonitor({ notify = false } = {}) {
  monitorController?.abort();
  monitorController = null;
  if (notify && credentials?.token) {
    await notifyWeixinStop(credentials).catch(() => {});
  }
}

function normalizeHistoryContent(value) {
  return String(value || '').slice(0, 10000);
}

function conversationLocalKey(accountId, peerId) {
  const hash = crypto.createHash('sha256').update(`${accountId}:${peerId}`).digest('hex').slice(0, 56);
  return `weixin:${hash}`;
}

async function ensureConversation(accountId, peerId) {
  const localKey = conversationLocalKey(accountId, peerId);
  const [rows] = await getPool().query('SELECT * FROM ai_conversations WHERE local_key = ? LIMIT 1', [localKey]);
  if (rows[0]) return rows[0];
  const [result] = await getPool().query(
    "INSERT INTO ai_conversations (scope, task_id, title, local_key) VALUES ('workspace', NULL, '微信对话', ?)",
    [localKey],
  );
  const [created] = await getPool().query('SELECT * FROM ai_conversations WHERE id = ?', [result.insertId]);
  return created[0];
}

async function conversationHistory(conversationId) {
  const [rows] = await getPool().query(
    `
      SELECT role, content
      FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT 16
    `,
    [conversationId],
  );
  return rows.reverse().map((row) => ({ role: row.role, content: normalizeHistoryContent(row.content) }));
}

async function saveConversationExchange(conversationId, question, result) {
  await getPool().query(
    'INSERT INTO ai_messages (conversation_id, role, content, sources_json) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
    [
      conversationId,
      'user',
      question,
      null,
      conversationId,
      'assistant',
      result.answer || '',
      JSON.stringify({
        sources: result.sources || [],
        intent: result.intent || '',
        grounded: Boolean(result.grounded),
        actionRequests: result.actionRequests || [],
        channel: 'weixin',
      }),
    ],
  );
  await getPool().query(
    'UPDATE ai_conversations SET preview = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [htmlToPlainText(result.answer || '').slice(0, 320), conversationId],
  );
}

export function htmlToPlainText(value) {
  const blockBreaks = String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<dt[^>]*>/gi, '')
    .replace(/<\/dt>/gi, '：')
    .replace(/<dd[^>]*>/gi, '')
    .replace(/<\/dd>/gi, '\n');
  return blockBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitMessage(text, maxChars = 3200) {
  const remaining = String(text || '').trim();
  if (!remaining) return [];
  const chunks = [];
  let cursor = remaining;
  while (cursor.length > maxChars) {
    let cut = Math.max(cursor.lastIndexOf('\n', maxChars), cursor.lastIndexOf('。', maxChars));
    if (cut < Math.floor(maxChars * 0.55)) cut = maxChars;
    else cut += 1;
    chunks.push(cursor.slice(0, cut).trim());
    cursor = cursor.slice(cut).trim();
  }
  if (cursor) chunks.push(cursor);
  return chunks;
}

async function sendTextReply(peerId, contextToken, text) {
  for (const chunk of splitMessage(text)) {
    await sendWeixinText({ ...credentials, to: peerId, contextToken, text: chunk });
  }
  patchState({ lastOutboundAt: nowIso() });
}

function incomingText(message) {
  const parts = [];
  for (const item of message.item_list || []) {
    if (item.type === WEIXIN_ITEM_TYPES.TEXT && item.text_item?.text) parts.push(item.text_item.text);
    if (item.type === WEIXIN_ITEM_TYPES.VOICE && item.voice_item?.text) {
      parts.push(`[语音转文字] ${item.voice_item.text}`);
    }
  }
  return parts.join('\n').trim();
}

async function extractTemporaryText(media, buffer) {
  if (/^text\//i.test(media.mimeType)) {
    return buffer.toString('utf8').replace(/\u0000/g, '').slice(0, config.ai.attachmentParsing.maxChars);
  }
  try {
    const extracted = await extractTemporaryAttachmentText({
      originalName: media.originalName,
      mimeType: media.mimeType,
      buffer,
    });
    return String(extracted.text || '').trim();
  } catch (error) {
    appendLog(`临时附件分析失败（${media.originalName}）：${error.message}`);
    return '';
  }
}

async function receiveTemporaryMedia(message, accountId, peerId) {
  const records = [];
  for (const item of message.item_list || []) {
    if (![2, 3, 4, 5].includes(Number(item.type))) continue;
    if (item.type === WEIXIN_ITEM_TYPES.VOICE && item.voice_item?.text) continue;
    try {
      const downloaded = await downloadWeixinMediaItem(item);
      if (!downloaded) continue;
      const record = await saveTemporaryMedia({
        accountId,
        peerId,
        originalName: downloaded.originalName,
        mimeType: downloaded.mimeType,
        buffer: downloaded.buffer,
      });
      const extractedText = await extractTemporaryText(downloaded, downloaded.buffer);
      records.push(await updateTemporaryMediaText(record.id, extractedText));
    } catch (error) {
      appendLog(`接收微信附件失败：${error.message}`);
    }
  }
  return records.filter(Boolean);
}

function mediaContext(records) {
  return records.map((record, index) => [
    `临时附件 ${index + 1}：${record.original_name}`,
    `类型：${record.mime_type}，大小：${Number(record.file_size || 0)} 字节`,
    record.extracted_text ? `识别内容：\n${record.extracted_text}` : '当前无法读取该附件正文，只能确认文件名和类型。',
  ].join('\n')).join('\n\n');
}

function parsePositiveId(text, label) {
  const match = String(text || '').match(new RegExp(`${label}\\s*(?:#|ID[:：]?)?\\s*(\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function isMediaSaveCommand(text) {
  return /(?:保存|存入|放到|放进|归档).*(?:任务|笔记)|(?:任务|笔记).*(?:保存|存入|放到|放进|归档)|(?:新建|新创|创建).{0,8}笔记/i.test(String(text || ''));
}

function instructionValue(text, labelPattern, nextLabelPattern) {
  const match = String(text || '').match(new RegExp(
    `(?:${labelPattern})\\s*(?:命名)?\\s*(?:为|是|叫|：|:)\\s*[“\"']?(.+?)[”\"']?(?=\\s*(?:，|,|。|；|;|\\n|$)(?:\\s*(?:${nextLabelPattern}))?|$)`,
    'i',
  ));
  return match?.[1]?.trim() || '';
}

function namedAttachmentFile(requestedName, originalName) {
  const requested = String(requestedName || '').trim();
  if (!requested) return String(originalName || '微信附件');
  const sourceExtension = path.extname(String(originalName || ''));
  const requestedExtension = path.extname(requested);
  return requestedExtension || !sourceExtension ? requested : `${requested}${sourceExtension}`;
}

export function parseWeixinMediaSaveInstruction(text, originalName = '') {
  const input = String(text || '').trim();
  const createAsNote = /(?:保存|存入|放到|放进).{0,12}(?:一个|一篇)?(?:新建|新创|新的)?笔记|(?:新建|新创|创建).{0,8}笔记|保存为(?:一篇|一个)?笔记/i.test(input);
  const content = instructionValue(input, '笔记内容|内容', '图片|文件|附件|笔记标题|标题|分类');
  const title = instructionValue(input, '笔记标题|标题', '图片|文件|附件|笔记内容|内容|分类');
  const requestedFileName = instructionValue(input, '图片(?:名称|名)?|文件(?:名称|名)?|附件(?:名称|名)?', '笔记标题|标题|笔记内容|内容|分类');
  return {
    createAsNote,
    content,
    title,
    originalName: namedAttachmentFile(requestedFileName, originalName),
  };
}

function mediaSavePlan(answer, actionRequests = []) {
  return {
    intent: 'action_save_weixin_media',
    answer,
    sources: [],
    grounded: actionRequests.length > 0,
    facts: actionRequests.map((action) => ({ type: 'action_request', id: action.id, title: action.title })),
    suggestions: [],
    actionRequests,
  };
}

async function createMediaSaveRequests(text, accountId, peerId, currentMedia = []) {
  if (!isMediaSaveCommand(text)) return null;
  const media = currentMedia.length
    ? currentMedia
    : await listRecentTemporaryMedia(accountId, peerId, { limit: 1 });
  if (!media.length) {
    return mediaSavePlan('没有找到可保存的临时图片或文件，请先在微信中发送附件。');
  }

  const taskId = parsePositiveId(text, '任务');
  const noteId = parsePositiveId(text, '笔记');
  const instruction = parseWeixinMediaSaveInstruction(text, media[0]?.original_name);
  const createAsNote = instruction.createAsNote;
  if (!taskId && !noteId && !createAsNote) {
    return mediaSavePlan('请说明保存位置，例如“保存到任务 #3”“保存到笔记 #8”或“保存为笔记”。');
  }

  const selected = createAsNote ? media.slice(0, 1) : media;
  const actionRequests = [];
  for (const item of selected) {
    const actionType = createAsNote
      ? 'create_note_with_weixin_media'
      : taskId
        ? 'attach_weixin_media_to_task'
        : 'attach_weixin_media_to_note';
    const request = await createActionRequest({
      toolName: 'weixin_save_media',
      actionType,
      payload: {
        tempMediaId: item.id,
        originalName: item.original_name,
        mimeType: item.mime_type,
        fileSize: Number(item.file_size || 0),
        ...(taskId ? { taskId } : {}),
        ...(noteId ? { noteId } : {}),
        ...(createAsNote ? {
          title: (instruction.title || instruction.content || path.parse(item.original_name).name).slice(0, 160) || '微信资料',
          content: instruction.content || item.extracted_text || `来自微信的附件：${item.original_name}`,
          originalName: namedAttachmentFile(instruction.originalName, item.original_name),
        } : {}),
        note: '来自微信对话，确认后保存',
      },
      requestedBy: `weixin:${peerId}`,
      source: 'weixin',
    });
    actionRequests.push(request);
  }
  return mediaSavePlan(
    `已生成 ${actionRequests.length} 条待审批操作。请到任务台顶部“审批”中确认，确认前附件仍只保存在临时区。`,
    actionRequests,
  );
}

function referencesRecentMedia(text) {
  return /(?:刚才|刚刚|上面|这个|这些|该).{0,8}(?:图片|文件|附件|截图|资料)|(?:图片|文件|附件|截图|资料).{0,8}(?:内容|是什么|写了|分析|总结|提取)/i
    .test(String(text || ''));
}

function wantsAttachmentReply(question) {
  return /(?:发|发送|传|给我|下载).{0,12}(?:文件|附件|图片|pdf|文档)|(?:文件|附件|图片|pdf|文档).{0,12}(?:发|发送|传|给我)|(?:发|发送|传|给我)\s*(?:第\s*)?\d+\s*(?:个|份|条)?|第\s*\d+\s*(?:个|份|条)?/i.test(question);
}

function isSendableSource(source) {
  const entityType = String(source?.entityType || '');
  if (/_attachment$/.test(entityType)) return Boolean(source.fileName);
  return entityType === 'resource' && Boolean(source.fileName && source.downloadUrl);
}

function sourceFileLabel(source, index = 0) {
  return String(source?.fileName || source?.label || `文件 ${index + 1}`).trim();
}

function preferNamedSources(question, sources) {
  const compactQuestion = String(question || '').toLowerCase().replace(/\s+/g, '');
  const exact = sources.filter((source) => {
    const fileName = sourceFileLabel(source).toLowerCase();
    const baseName = path.parse(fileName).name.replace(/\s+/g, '');
    return baseName.length >= 2 && compactQuestion.includes(baseName);
  });
  return exact.length ? exact : sources;
}

export function selectAttachmentSourcesForReply(question, sources = []) {
  const text = String(question || '');
  let matches = sources.filter(isSendableSource);
  if (/资料库|资料中心/.test(text)) {
    matches = matches.filter((source) => source.entityType === 'resource');
  }
  if (/pdf/i.test(text)) {
    matches = matches.filter((source) => source.mimeType === 'application/pdf' || /\.pdf$/i.test(source.fileName || ''));
  } else if (/图片|图像|截图|照片/.test(text)) {
    matches = matches.filter((source) => String(source.mimeType || '').startsWith('image/'));
  }
  matches = preferNamedSources(text, matches);
  const seen = new Set();
  matches = matches.filter((source) => {
    const key = `${source.entityType}:${source.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return matches.slice(0, 5);
}

export function parseWeixinAttachmentSelection(question) {
  const match = String(question || '').trim().match(/(?:发|发送|传|给我)\s*(?:第\s*)?(\d+)\s*(?:个|份|条)?|第\s*(\d+)\s*(?:个|份|条)?/);
  const index = Number(match?.[1] || match?.[2] || 0);
  return Number.isInteger(index) && index > 0 && index <= 5 ? index - 1 : null;
}

async function latestAttachmentCandidates(conversationId) {
  const [rows] = await getPool().query(
    `
      SELECT sources_json
      FROM ai_messages
      WHERE conversation_id = ? AND role = 'assistant' AND sources_json IS NOT NULL
      ORDER BY id DESC
      LIMIT 8
    `,
    [conversationId],
  );
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.sources_json || '{}');
      const candidates = (parsed.sources || []).filter(isSendableSource).slice(0, 5);
      if (candidates.length) return candidates;
    } catch {
      // Ignore an older malformed source snapshot and inspect the next one.
    }
  }
  return [];
}

async function latestResourceFileRow(value) {
  const numericValue = Number(value);
  const useNumericId = Number.isInteger(numericValue) && numericValue > 0;
  const where = useNumericId ? 'r.id = ?' : 'r.public_id = ?';
  const [rows] = await getPool().query(
    `
      SELECT v.*, COALESCE(v.original_name, r.title) AS original_name,
        r.id AS resource_id, r.public_id AS resource_public_id, r.title AS resource_title
      FROM resources r
      JOIN resource_versions v
        ON v.resource_id = r.id
       AND v.version_no = (
         SELECT MAX(latest.version_no)
         FROM resource_versions latest
         WHERE latest.resource_id = r.id
       )
      WHERE ${where} AND r.deleted_at IS NULL AND r.kind = 'file'
        AND v.storage_key IS NOT NULL
      LIMIT 1
    `,
    [useNumericId ? numericValue : String(value || '').trim()],
  );
  return rows[0] || null;
}

async function attachmentRowFromSource(source) {
  if (source?.entityType === 'resource') {
    return latestResourceFileRow(source.entityId);
  }
  const configByType = {
    log_attachment: { table: 'log_attachments' },
    note_attachment: { table: 'note_attachments' },
    task_attachment: { table: 'task_attachments' },
  }[source?.entityType];
  if (!configByType) return null;
  const [rows] = await getPool().query(
    `SELECT * FROM ${configByType.table} WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [Number(source.entityId)],
  );
  return rows[0] || null;
}

async function sendStoredRowToWeixin(peerId, contextToken, row) {
  const buffer = await readStoredAttachment(row, config.weixin.maxMediaBytes);
  await fsp.mkdir(outboundRoot, { recursive: true });
  const originalName = path.basename(row.original_name || '附件');
  const filePath = path.join(outboundRoot, `${crypto.randomUUID()}-${originalName}`);
  await fsp.writeFile(filePath, buffer, { mode: 0o600 });
  try {
    await sendWeixinMedia({
      ...credentials,
      to: peerId,
      contextToken,
      filePath,
      originalName,
      mimeType: row.mime_type,
    });
  } finally {
    await fsp.unlink(filePath).catch(() => {});
  }
}

async function sendRequestedAttachment(peerId, contextToken, question, sources) {
  if (!wantsAttachmentReply(question)) return false;
  const attachmentSources = selectAttachmentSourcesForReply(question, sources);
  if (!attachmentSources.length) return false;
  const sendAll = /(?:全部|所有|都).{0,8}(?:发|发送|传)|(?:发|发送|传).{0,8}(?:全部|所有|都)/.test(question);
  if (attachmentSources.length > 1 && !sendAll && parseWeixinAttachmentSelection(question) === null) {
    const choices = attachmentSources
      .map((source, index) => `${index + 1}. ${sourceFileLabel(source, index)}`)
      .join('\n');
    await sendTextReply(peerId, contextToken, `找到多份匹配文件，请回复“发第 1 个”等序号：\n${choices}`);
    return false;
  }
  const selectedSources = sendAll ? attachmentSources : attachmentSources.slice(0, 1);
  let sent = 0;
  for (const source of selectedSources) {
    const row = await attachmentRowFromSource(source);
    if (!row) continue;
    await sendStoredRowToWeixin(peerId, contextToken, row);
    sent += 1;
  }
  if (sent) patchState({ lastOutboundAt: nowIso() });
  return sent > 0;
}

export async function sendResourceToWeixin(value) {
  if (!runtime.connected || !credentials?.token) {
    const error = new Error('微信当前未连接，请先在设置中扫码连接。');
    error.statusCode = 409;
    throw error;
  }
  if (!credentials.replyPeerId || !credentials.replyContextToken) {
    const error = new Error('请先用扫码账号给任务台发送一条微信消息，再从网站发送资料。');
    error.statusCode = 409;
    throw error;
  }
  const row = await latestResourceFileRow(value);
  if (!row) {
    const error = new Error('该资料没有可发送的文件版本。');
    error.statusCode = 404;
    throw error;
  }
  await sendStoredRowToWeixin(credentials.replyPeerId, credentials.replyContextToken, row);
  patchState({ lastOutboundAt: nowIso() });
  appendLog(`已从网站发送资料到微信：${row.original_name}`);
  return {
    resourceId: Number(row.resource_id),
    resourcePublicId: row.resource_public_id,
    title: row.resource_title,
    fileName: row.original_name,
    versionNo: Number(row.version_no || 0),
    sentAt: nowIso(),
  };
}

async function processIncomingMessage(message) {
  const peerId = String(message.from_user_id || '').trim();
  if (!peerId || !credentials) return;
  if (credentials.ownerUserId && peerId !== credentials.ownerUserId) {
    appendLog('已忽略非扫码账号发来的微信消息。');
    return;
  }
  const contextToken = message.context_token || '';
  rememberReplyContext(peerId, contextToken);
  const text = incomingText(message);
  const receivedMedia = await receiveTemporaryMedia(message, credentials.accountId, peerId);
  const media = receivedMedia.length || !referencesRecentMedia(text)
    ? receivedMedia
    : await listRecentTemporaryMedia(credentials.accountId, peerId, { limit: 3 });
  const question = text || (media.length ? '请分析我刚刚发来的图片或文件。' : '');
  if (!question) return;

  patchState({ lastInboundAt: nowIso() });
  appendLog(`收到微信消息${receivedMedia.length ? `，含 ${receivedMedia.length} 个临时附件` : ''}。`);

  try {
    const conversation = await ensureConversation(credentials.accountId, peerId);
    const history = await conversationHistory(conversation.id);
    const selectionIndex = parseWeixinAttachmentSelection(question);
    const previousCandidates = selectionIndex === null
      ? []
      : await latestAttachmentCandidates(conversation.id);
    const selectedSource = selectionIndex === null ? null : previousCandidates[selectionIndex] || null;
    const selectionContext = selectionIndex === null
      ? ''
      : selectedSource
        ? `用户选择发送上一轮候选文件第 ${selectionIndex + 1} 个：${sourceFileLabel(selectedSource, selectionIndex)}。`
        : '用户选择了上一轮文件序号，但该序号不存在或候选已经失效。';
    const mediaSave = await createMediaSaveRequests(question, credentials.accountId, peerId, receivedMedia);
    const actionPlan = mediaSave || await planAiActionRequest(question, {
      requestedBy: `weixin:${peerId}`,
      source: 'weixin',
    });
    const result = await answerWorkspace(question, {
      messages: history,
      additionalContext: [mediaContext(media), selectionContext].filter(Boolean).join('\n\n'),
      actionPlan,
      channel: 'weixin',
    });
    await saveConversationExchange(conversation.id, question, result);
    const plainText = htmlToPlainText(result.answer || '暂时没有可用回答。');
    await sendTextReply(peerId, contextToken, plainText);
    const replySources = selectedSource ? [selectedSource] : (result.sources || []);
    await sendRequestedAttachment(peerId, contextToken, question, replySources).catch((error) => {
      appendLog(`微信附件回复失败：${error.message}`);
    });
  } catch (error) {
    appendLog(`微信 AI 回答失败：${error.message}`);
    await sendTextReply(peerId, contextToken, '暂时无法完成这次回答，请检查任务台的 AI 配置后重试。').catch(() => {});
  }
}

async function monitorLoop(signal) {
  let failures = 0;
  let timeoutMs = 35_000;
  await notifyWeixinStart(credentials).catch(() => {});
  while (!signal.aborted && credentials?.token) {
    try {
      const result = await getWeixinUpdates({
        ...credentials,
        syncBuffer: credentials.syncBuffer || '',
        timeoutMs,
        signal,
      });
      if (signal.aborted) return;
      if ((result.ret && result.ret !== 0) || (result.errcode && result.errcode !== 0)) {
        throw new Error(result.errmsg || `微信连接返回错误 ${result.errcode || result.ret}`);
      }
      failures = 0;
      timeoutMs = Number(result.longpolling_timeout_ms || 35_000);
      if (result.get_updates_buf && result.get_updates_buf !== credentials.syncBuffer) {
        credentials.syncBuffer = result.get_updates_buf;
        queueCredentialSave();
      }
      patchState(loginSession
        ? { lastPollAt: nowIso() }
        : {
            status: 'connected',
            connected: true,
            phase: 'listening',
            lastPollAt: nowIso(),
            error: '',
          });
      for (const message of result.msgs || []) {
        if (Number(message.message_type || 1) !== 1) continue;
        await processIncomingMessage(message);
      }
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError') return;
      failures += 1;
      if (!loginSession) {
        patchState({
          status: failures >= 3 ? 'error' : 'reconnecting',
          connected: failures < 3,
          phase: 'reconnecting',
          error: error.message,
        });
      }
      appendLog(`微信连接异常，正在重试：${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, failures * 3000)));
    }
  }
}

async function startMonitor() {
  await stopMonitor();
  if (!credentials?.token) return;
  monitorController = new AbortController();
  patchState({
    status: 'connecting',
    connected: true,
    phase: 'connecting',
    accountId: credentials.accountId || '',
    connectedAt: credentials.connectedAt || nowIso(),
    qrDataUrl: '',
    qrExpiresAt: null,
    needsVerifyCode: false,
    error: '',
  });
  monitorLoop(monitorController.signal).catch((error) => {
    if (!monitorController?.signal.aborted) {
      patchState({ status: 'error', connected: false, phase: 'error', error: error.message });
    }
  });
}

async function loginPollingLoop(session, signal) {
  const finishAttempt = (patch, logMessage = '') => {
    if (loginSession === session) {
      loginSession = null;
      loginController = null;
    }
    if (credentials?.token && monitorController && !monitorController.signal.aborted) {
      patchState({
        status: 'connected',
        connected: true,
        phase: 'listening',
        accountId: credentials.accountId || '',
        qrDataUrl: '',
        qrExpiresAt: null,
        needsVerifyCode: false,
        error: '',
      });
      if (logMessage) appendLog(`${logMessage}，原微信连接仍保持在线。`);
      return;
    }
    patchState(patch);
    if (logMessage) appendLog(logMessage);
  };

  while (!signal.aborted && Date.now() < session.expiresAt) {
    let result;
    try {
      result = await pollWeixinQrLogin({
        qrcode: session.qrcode,
        baseUrl: session.pollBaseUrl,
        verifyCode: session.verifyCode,
        signal,
      });
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError') return;
      appendLog(`二维码状态检查失败：${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (result.status === 'scaned_but_redirect' && result.redirect_host) {
      session.pollBaseUrl = normalizeBaseUrl(result.redirect_host);
      patchState({ status: 'scanned', phase: 'scanned', error: '' });
    } else if (result.status === 'scaned') {
      session.verifyCode = '';
      patchState({ status: 'scanned', phase: 'scanned', needsVerifyCode: false, error: '' });
    } else if (result.status === 'need_verifycode') {
      patchState({ status: 'verify_required', phase: 'verify_required', needsVerifyCode: true, error: '' });
    } else if (result.status === 'verify_code_blocked') {
      finishAttempt(
        { status: 'error', connected: false, phase: 'verify_blocked', needsVerifyCode: true, error: '验证码错误次数过多，请重新生成二维码。' },
        '微信验证码错误次数过多',
      );
      return;
    } else if (result.status === 'expired') {
      finishAttempt(
        { status: 'expired', connected: false, phase: 'expired', qrDataUrl: '', qrExpiresAt: null, error: '二维码已过期，请重新生成。' },
        '微信登录二维码已过期',
      );
      return;
    } else if (result.status === 'binded_redirect') {
      if (credentials?.token) {
        const monitorActive = Boolean(monitorController && !monitorController.signal.aborted);
        finishAttempt(
          {
            status: 'connecting',
            connected: true,
            phase: 'connecting',
            accountId: credentials.accountId || '',
            qrDataUrl: '',
            qrExpiresAt: null,
            needsVerifyCode: false,
            error: '',
          },
          '当前微信账号已经绑定',
        );
        if (!monitorActive) await startMonitor();
      }
      else patchState({ status: 'error', phase: 'error', error: '该微信已绑定，但服务器没有本地凭证，请先在微信插件中解除后重试。' });
      return;
    } else if (result.status === 'confirmed') {
      if (!result.bot_token || !result.ilink_bot_id || !result.ilink_user_id) {
        finishAttempt(
          { status: 'error', connected: false, phase: 'error', error: '微信确认成功，但登录凭证不完整。' },
          '微信确认成功，但新登录凭证不完整',
        );
        return;
      }
      credentials = {
        token: result.bot_token,
        accountId: result.ilink_bot_id,
        ownerUserId: result.ilink_user_id,
        baseUrl: normalizeBaseUrl(result.baseurl || session.pollBaseUrl),
        syncBuffer: '',
        connectedAt: nowIso(),
      };
      await queueCredentialSave();
      loginSession = null;
      loginController = null;
      appendLog('微信扫码连接成功。');
      await startMonitor();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  if (!signal.aborted) {
    finishAttempt(
      { status: 'expired', connected: false, phase: 'expired', qrDataUrl: '', qrExpiresAt: null, error: '二维码已过期，请重新生成。' },
      '微信登录二维码已过期',
    );
  }
}

export async function startWeixinLogin({ force = false } = {}) {
  if (!force && loginSession && loginController && !loginController.signal.aborted) {
    return publicState();
  }
  if (!force && credentials?.token) {
    if (!monitorController || monitorController.signal.aborted) await startMonitor();
    return publicState();
  }
  abortLogin();
  const qr = await startWeixinQrLogin(credentials?.token ? [credentials.token] : []);
  const session = {
    qrcode: qr.qrcode,
    pollBaseUrl: config.weixin.apiBaseUrl,
    verifyCode: '',
    expiresAt: Date.now() + loginTtlMs,
  };
  loginSession = session;
  loginController = new AbortController();
  patchState({
    status: 'waiting_scan',
    connected: Boolean(credentials?.token && runtime.connected),
    phase: 'waiting_scan',
    qrDataUrl: qr.qrDataUrl,
    qrExpiresAt: new Date(session.expiresAt).toISOString(),
    needsVerifyCode: false,
    error: '',
  });
  appendLog('已生成微信登录二维码。');
  loginPollingLoop(session, loginController.signal).catch((error) => {
    if (!loginController?.signal.aborted) {
      patchState({ status: 'error', phase: 'error', error: error.message });
    }
  });
  return publicState();
}

export async function submitWeixinVerifyCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{1,8}$/.test(normalized)) {
    const error = new Error('请输入手机微信中显示的数字验证码。');
    error.statusCode = 400;
    throw error;
  }
  if (!loginSession) {
    const error = new Error('当前没有进行中的微信扫码。');
    error.statusCode = 409;
    throw error;
  }
  loginSession.verifyCode = normalized;
  patchState({ status: 'verifying', phase: 'verifying', needsVerifyCode: false, error: '' });
  return publicState();
}

export async function disconnectWeixin() {
  abortLogin();
  await stopMonitor({ notify: true });
  credentials = null;
  await queueCredentialSave();
  await removeAllTemporaryMedia();
  runtime = {
    ...runtime,
    status: 'disconnected',
    connected: false,
    phase: 'idle',
    accountId: '',
    qrDataUrl: '',
    qrExpiresAt: null,
    needsVerifyCode: false,
    connectedAt: null,
    lastPollAt: null,
    error: '',
  };
  appendLog('微信连接已断开，临时附件已清理。');
  return publicState();
}

export function getWeixinStatus() {
  return publicState();
}

export function openWeixinEventStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  writeSse(res, 'weixin.state', { state: publicState(), at: nowIso() });
  const client = {
    res,
    heartbeat: setInterval(() => writeSse(res, 'ping', { at: nowIso() }), 20_000),
  };
  clients.add(client);
  req.on('close', () => {
    clearInterval(client.heartbeat);
    clients.delete(client);
  });
}

export async function initializeWeixinService() {
  await fsp.mkdir(weixinTempRoot, { recursive: true });
  await cleanupExpiredTemporaryMedia().catch((error) => appendLog(`微信临时附件清理失败：${error.message}`));
  cleanupTimer = setInterval(() => {
    cleanupExpiredTemporaryMedia().catch((error) => appendLog(`微信临时附件清理失败：${error.message}`));
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();
  credentials = await loadCredentials();
  if (credentials?.token && credentials?.accountId) {
    appendLog('已恢复服务器保存的微信连接。');
    await startMonitor();
  }
  return publicState();
}

export async function shutdownWeixinService() {
  abortLogin();
  clearInterval(cleanupTimer);
  await stopMonitor({ notify: true });
  await credentialWrite;
}
