import crypto from 'crypto';
import { promises as fsp } from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { config } from '../config.js';

const CHANNEL_VERSION = '2.4.6';
const ILINK_APP_ID = 'bot';
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 6);
const BOT_AGENT = 'AssistantTaskBoard/1.0.0';
const API_TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_MS = 35_000;

export const WEIXIN_ITEM_TYPES = Object.freeze({
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
});

function normalizeBaseUrl(value, fallback = config.weixin.apiBaseUrl) {
  const text = String(value || fallback || '').trim();
  if (!text) throw new Error('微信服务地址未配置。');
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (url.protocol !== 'https:') throw new Error('微信服务地址必须使用 HTTPS。');
  return url.toString().replace(/\/+$/, '');
}

function endpointUrl(baseUrl, endpoint) {
  return new URL(String(endpoint).replace(/^\/+/, ''), `${normalizeBaseUrl(baseUrl)}/`).toString();
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function commonHeaders({ token, json = true } = {}) {
  const headers = {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION,
  };
  if (json) {
    headers['Content-Type'] = 'application/json';
    headers.AuthorizationType = 'ilink_bot_token';
    headers['X-WECHAT-UIN'] = randomWechatUin();
  }
  if (token) headers.Authorization = `Bearer ${String(token).trim()}`;
  return headers;
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}失败（${response.status}）：${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label}返回了无法识别的数据。`);
  }
}

async function postJson(baseUrl, endpoint, body, { token, timeoutMs = API_TIMEOUT_MS, signal } = {}) {
  const response = await fetchWithTimeout(endpointUrl(baseUrl, endpoint), {
    method: 'POST',
    headers: commonHeaders({ token }),
    body: JSON.stringify(body),
    signal,
  }, timeoutMs);
  return readJsonResponse(response, endpoint);
}

async function getJson(baseUrl, endpoint, { timeoutMs = LONG_POLL_TIMEOUT_MS, signal } = {}) {
  const response = await fetchWithTimeout(endpointUrl(baseUrl, endpoint), {
    method: 'GET',
    headers: commonHeaders({ json: false }),
    signal,
  }, timeoutMs);
  return readJsonResponse(response, endpoint);
}

export async function startWeixinQrLogin(localTokenList = []) {
  const result = await postJson(
    config.weixin.apiBaseUrl,
    'ilink/bot/get_bot_qrcode?bot_type=3',
    { local_token_list: localTokenList.filter(Boolean).slice(0, 10) },
  );
  if (!result.qrcode || !result.qrcode_img_content) throw new Error('微信没有返回可用的登录二维码。');
  return {
    qrcode: result.qrcode,
    qrcodeContent: result.qrcode_img_content,
    qrDataUrl: await QRCode.toDataURL(result.qrcode_img_content, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    }),
  };
}

export async function pollWeixinQrLogin({ qrcode, baseUrl, verifyCode, signal }) {
  const suffix = verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : '';
  return getJson(
    baseUrl || config.weixin.apiBaseUrl,
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${suffix}`,
    { timeoutMs: LONG_POLL_TIMEOUT_MS, signal },
  );
}

export async function getWeixinUpdates({ baseUrl, token, syncBuffer = '', timeoutMs, signal }) {
  try {
    return await postJson(baseUrl, 'ilink/bot/getupdates', {
      get_updates_buf: syncBuffer,
      base_info: baseInfo(),
    }, {
      token,
      timeoutMs: timeoutMs || LONG_POLL_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') return { ret: 0, msgs: [], get_updates_buf: syncBuffer };
    throw error;
  }
}

export async function notifyWeixinStart({ baseUrl, token }) {
  return postJson(baseUrl, 'ilink/bot/msg/notifystart', { base_info: baseInfo() }, { token, timeoutMs: 10_000 });
}

export async function notifyWeixinStop({ baseUrl, token }) {
  return postJson(baseUrl, 'ilink/bot/msg/notifystop', { base_info: baseInfo() }, { token, timeoutMs: 10_000 });
}

function messageRequest({ to, contextToken, item }) {
  return {
    msg: {
      from_user_id: '',
      to_user_id: to,
      client_id: `assistant-task-board-${crypto.randomUUID()}`,
      message_type: 2,
      message_state: 2,
      item_list: [item],
      context_token: contextToken || undefined,
    },
    base_info: baseInfo(),
  };
}

async function sendItem({ baseUrl, token, to, contextToken, item }) {
  const result = await postJson(
    baseUrl,
    'ilink/bot/sendmessage',
    messageRequest({ to, contextToken, item }),
    { token },
  );
  if (result.ret && result.ret !== 0) throw new Error(result.errmsg || `微信消息发送失败：${result.ret}`);
  return result;
}

export async function sendWeixinText({ baseUrl, token, to, contextToken, text }) {
  return sendItem({
    baseUrl,
    token,
    to,
    contextToken,
    item: { type: WEIXIN_ITEM_TYPES.TEXT, text_item: { text: String(text || '') } },
  });
}

function parseAesKey(value) {
  const decoded = Buffer.from(String(value || ''), 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  throw new Error('微信附件加密密钥无效。');
}

function decryptAesEcb(ciphertext, key) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptAesEcb(plaintext, key) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function cdnDownloadUrl(media) {
  if (media?.full_url) return media.full_url;
  if (!media?.encrypt_query_param) throw new Error('微信附件缺少下载地址。');
  return `${config.weixin.cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
}

async function downloadCdnBuffer(media, aesKeyValue) {
  const response = await fetchWithTimeout(cdnDownloadUrl(media), { method: 'GET' }, 30_000);
  if (!response.ok) throw new Error(`微信附件下载失败（${response.status}）。`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > config.weixin.maxMediaBytes + 16) throw new Error('微信附件超过大小限制。');
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length > config.weixin.maxMediaBytes + 16) throw new Error('微信附件超过大小限制。');
  return aesKeyValue ? decryptAesEcb(encrypted, parseAesKey(aesKeyValue)) : encrypted;
}

export async function downloadWeixinMediaItem(item) {
  if (item?.type === WEIXIN_ITEM_TYPES.IMAGE && item.image_item?.media) {
    const image = item.image_item;
    const key = image.aeskey
      ? Buffer.from(image.aeskey, 'hex').toString('base64')
      : image.media.aes_key;
    return {
      buffer: await downloadCdnBuffer(image.media, key),
      originalName: `微信图片-${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      kind: 'image',
    };
  }
  if (item?.type === WEIXIN_ITEM_TYPES.FILE && item.file_item?.media) {
    return {
      buffer: await downloadCdnBuffer(item.file_item.media, item.file_item.media.aes_key),
      originalName: path.basename(item.file_item.file_name || `微信文件-${Date.now()}.bin`),
      mimeType: mimeFromFileName(item.file_item.file_name),
      kind: 'file',
    };
  }
  if (item?.type === WEIXIN_ITEM_TYPES.VIDEO && item.video_item?.media) {
    return {
      buffer: await downloadCdnBuffer(item.video_item.media, item.video_item.media.aes_key),
      originalName: `微信视频-${Date.now()}.mp4`,
      mimeType: 'video/mp4',
      kind: 'video',
    };
  }
  if (item?.type === WEIXIN_ITEM_TYPES.VOICE && item.voice_item?.media?.aes_key) {
    return {
      buffer: await downloadCdnBuffer(item.voice_item.media, item.voice_item.media.aes_key),
      originalName: `微信语音-${Date.now()}.silk`,
      mimeType: 'audio/silk',
      kind: 'voice',
    };
  }
  return null;
}

function mimeFromFileName(fileName = '') {
  const extension = path.extname(fileName).toLowerCase();
  return {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.zip': 'application/zip',
    '.mp4': 'video/mp4',
  }[extension] || 'application/octet-stream';
}

function uploadMediaType(mimeType) {
  if (mimeType.startsWith('image/')) return 1;
  if (mimeType.startsWith('video/')) return 2;
  return 3;
}

function mediaItemForUpload({ mimeType, originalName, encryptedParam, aesKey, rawSize, cipherSize }) {
  const media = {
    encrypt_query_param: encryptedParam,
    aes_key: Buffer.from(aesKey.toString('hex')).toString('base64'),
    encrypt_type: 1,
  };
  if (mimeType.startsWith('image/')) {
    return { type: WEIXIN_ITEM_TYPES.IMAGE, image_item: { media, mid_size: cipherSize } };
  }
  if (mimeType.startsWith('video/')) {
    return { type: WEIXIN_ITEM_TYPES.VIDEO, video_item: { media, video_size: cipherSize } };
  }
  return {
    type: WEIXIN_ITEM_TYPES.FILE,
    file_item: { media, file_name: path.basename(originalName || '附件'), len: String(rawSize) },
  };
}

export async function sendWeixinMedia({ baseUrl, token, to, contextToken, filePath, originalName, mimeType }) {
  const buffer = await fsp.readFile(filePath);
  if (buffer.length > config.weixin.maxMediaBytes) throw new Error('待发送文件超过微信附件大小限制。');
  const normalizedMime = mimeType || mimeFromFileName(originalName || filePath);
  const aesKey = crypto.randomBytes(16);
  const encrypted = encryptAesEcb(buffer, aesKey);
  const fileKey = crypto.randomBytes(16).toString('hex');
  const upload = await postJson(baseUrl, 'ilink/bot/getuploadurl', {
    filekey: fileKey,
    media_type: uploadMediaType(normalizedMime),
    to_user_id: to,
    rawsize: buffer.length,
    rawfilemd5: crypto.createHash('md5').update(buffer).digest('hex'),
    filesize: encrypted.length,
    no_need_thumb: true,
    aeskey: aesKey.toString('hex'),
    base_info: baseInfo(),
  }, { token });
  const uploadUrl = upload.upload_full_url
    || `${config.weixin.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param || '')}&filekey=${encodeURIComponent(fileKey)}`;
  if (!upload.upload_full_url && !upload.upload_param) throw new Error('微信没有返回附件上传地址。');
  const response = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted,
  }, 45_000);
  if (!response.ok) throw new Error(`微信附件上传失败（${response.status}）。`);
  const encryptedParam = response.headers.get('x-encrypted-param');
  if (!encryptedParam) throw new Error('微信附件上传响应缺少下载参数。');
  return sendItem({
    baseUrl,
    token,
    to,
    contextToken,
    item: mediaItemForUpload({
      mimeType: normalizedMime,
      originalName,
      encryptedParam,
      aesKey,
      rawSize: buffer.length,
      cipherSize: encrypted.length,
    }),
  });
}

export { normalizeBaseUrl, mimeFromFileName };
