import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { config } from '../../../server/config.js';
import { getPool } from '../../../server/db.js';
import { extractTemporaryAttachmentText } from '../../../server/ai/attachment-cache.js';
import { enqueueIndexJob } from '../../../server/indexing.js';
import { readStoredAttachment } from '../../../server/storage.js';
import { redactSensitiveText } from '../../../packages/domain/src/redaction.js';

const maxWebBytes = 5 * 1024 * 1024;
const maxRedirects = 4;

function compactText(value) {
  return String(value || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function chatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

function parseModelJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回有效的说明 JSON。');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeKeywords(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[，,、;；\n]/);
  return [...new Set(entries
    .map((item) => compactText(item).slice(0, 40))
    .filter((item) => item.length >= 2))]
    .slice(0, 12);
}

function fallbackResourceDescription(version, text) {
  const cleanText = compactText(redactSensitiveText(text));
  const fileName = version.original_name || version.resource_title || '未命名资料';
  const type = version.mime_type || version.kind || '未知类型';
  if (!cleanText) {
    return {
      summary: `${fileName}（${type}）`,
      description: `资料文件“${fileName}”，文件类型为 ${type}。当前尚未识别出可用于检索的正文。`,
      keywords: normalizeKeywords([fileName, type]),
    };
  }
  return {
    summary: cleanText.slice(0, 160),
    description: `该资料主要包含以下内容：${cleanText.slice(0, 620)}`,
    keywords: normalizeKeywords([fileName, ...cleanText.split(/[\s，。；：、,.;:()（）]+/).filter((item) => item.length >= 2)]),
  };
}

export async function generateResourceDescription(version, text, { fetchImpl = fetch } = {}) {
  const fallback = fallbackResourceDescription(version, text);
  const cleanText = compactText(redactSensitiveText(text));
  if (!cleanText || version.ai_visibility === 'deny' || !config.ai.resourceDescription.enabled) {
    return { ...fallback, status: cleanText ? 'skipped' : 'fallback', model: null, error: null };
  }
  const { baseUrl, apiKey, chatModel } = config.ai.litellm;
  if (!baseUrl || !apiKey || !chatModel) {
    return { ...fallback, status: 'fallback', model: null, error: '聊天模型未配置，已使用本地摘要。' };
  }

  try {
    const response = await fetchImpl(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: chatModel,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: [
              '你是个人资料库的文件编目助手。',
              '只能根据给定文件名、类型和识别正文生成说明，不得补充或猜测正文中没有的事实。',
              '返回严格 JSON：{"summary":"30-100字摘要","description":"80-300字文件说明","keywords":["关键词"]}。',
              '关键词保留公司、人名、项目、文档类型、编号主题等检索线索，但不要输出密码、Token、身份证号等敏感值。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `文件名：${version.original_name || version.resource_title || '未命名资料'}`,
              `文件类型：${version.mime_type || version.kind || '未知'}`,
              `识别方式：${version.parser || '自动识别'}`,
              `识别正文：${cleanText.slice(0, config.ai.resourceDescription.maxInputChars)}`,
            ].join('\n'),
          },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(body || `说明模型请求失败：HTTP ${response.status}`);
    }
    const json = await response.json();
    const parsed = parseModelJson(json.choices?.[0]?.message?.content);
    const summary = compactText(parsed.summary).slice(0, 500);
    const description = compactText(parsed.description).slice(0, 1600);
    const keywords = normalizeKeywords(parsed.keywords);
    if (!summary || !description) throw new Error('模型返回的摘要或说明为空。');
    return { summary, description, keywords, status: 'completed', model: chatModel, error: null };
  } catch (error) {
    return {
      ...fallback,
      status: 'fallback',
      model: chatModel,
      error: String(error?.message || error).slice(0, 1000),
    };
  }
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0
    || parts[0] >= 224;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (!net.isIPv6(address)) return true;
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    const mappedAddress = value.slice('::ffff:'.length);
    if (net.isIPv4(mappedAddress)) return isPrivateIpv4(mappedAddress);
  }
  return value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe8')
    || value.startsWith('fe9')
    || value.startsWith('fea')
    || value.startsWith('feb')
    || value.startsWith('ff')
    || value.startsWith('2001:db8:');
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('网页地址无效。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('网页资料仅支持 HTTP 或 HTTPS。');
  }
  if (url.username || url.password) {
    throw new Error('网页地址不能包含登录凭据。');
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('网页地址不能指向本机或内网。');
  }
  return url;
}

async function readLimitedBody(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxWebBytes) throw new Error('网页内容超过 5MB 限制。');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxWebBytes) {
      await reader.cancel();
      throw new Error('网页内容超过 5MB 限制。');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchPublicPage(sourceUrl) {
  let current = await validatePublicUrl(sourceUrl);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: 'text/html,text/plain;q=0.9',
        'User-Agent': 'AssistantWorkspace/1.0 (+resource-ingestion)',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === maxRedirects) throw new Error('网页重定向次数过多。');
      const location = response.headers.get('location');
      if (!location) throw new Error('网页重定向缺少目标地址。');
      current = await validatePublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`网页读取失败：HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error('该链接不是可提取的网页正文。');
    }
    const body = await readLimitedBody(response);
    if (contentType.includes('text/plain')) {
      return { title: '', text: compactText(body), finalUrl: current.toString(), parser: 'web-text' };
    }
    const $ = cheerio.load(body);
    $('script,style,noscript,svg,canvas,nav,footer,form').remove();
    const title = compactText($('meta[property="og:title"]').attr('content') || $('title').first().text());
    const main = $('article,main,[role="main"]').first();
    const text = compactText(main.length ? main.text() : $('body').text());
    return { title, text, finalUrl: current.toString(), parser: 'web-html' };
  }
  throw new Error('网页读取失败。');
}

async function suggestExistingTags(workspaceId, text) {
  const [rows] = await getPool().query(
    'SELECT id, name FROM tags WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name',
    [workspaceId],
  );
  const haystack = compactText(text).toLocaleLowerCase('zh-CN');
  return rows
    .filter((tag) => tag.name.length >= 2 && haystack.includes(tag.name.toLocaleLowerCase('zh-CN')))
    .slice(0, 8)
    .map((tag) => ({ id: Number(tag.id), name: tag.name }));
}

async function loadVersion(versionId) {
  const [[row]] = await getPool().query(
    `
      SELECT v.*, r.kind, r.workspace_id, r.ai_visibility, r.title AS resource_title
      FROM resource_versions v
      JOIN resources r ON r.id = v.resource_id
      WHERE v.id = ? AND r.deleted_at IS NULL
    `,
    [versionId],
  );
  return row || null;
}

export async function processResourceVersion(versionId) {
  const db = getPool();
  const version = await loadVersion(versionId);
  if (!version) throw new Error('资料版本不存在。');
  await db.query('UPDATE resources SET status = ? WHERE id = ?', ['processing', version.resource_id]);
  await db.query(
    `
      INSERT INTO resource_contents (version_id, status)
      VALUES (?, 'processing')
      ON DUPLICATE KEY UPDATE status = 'processing', error_message = NULL
    `,
    [versionId],
  );

  try {
    let extracted = { parser: null, text: '', pageCount: null, truncated: false };
    let sourceUrl = version.source_url;
    if (version.kind === 'link') {
      const page = await fetchPublicPage(version.source_url);
      extracted = { parser: page.parser, text: page.text, pageCount: null, truncated: false };
      sourceUrl = page.finalUrl;
      if (page.title && (!version.resource_title || version.resource_title === version.source_url)) {
        await db.query('UPDATE resources SET title = ? WHERE id = ?', [page.title.slice(0, 255), version.resource_id]);
      }
      await db.query('UPDATE resource_versions SET source_url = ? WHERE id = ?', [sourceUrl, versionId]);
    } else if (version.kind === 'file') {
      const buffer = await readStoredAttachment(version, config.ai.attachmentParsing.maxBytes);
      extracted = await extractTemporaryAttachmentText({
        originalName: version.original_name,
        mimeType: version.mime_type,
        buffer,
        allowCloud: version.ai_visibility !== 'deny',
      });
    } else {
      const [[content]] = await db.query(
        'SELECT extracted_text FROM resource_contents WHERE version_id = ?',
        [versionId],
      );
      extracted = { parser: 'text', text: content?.extracted_text || '', pageCount: null, truncated: false };
    }

    const text = String(extracted.text || '').slice(0, config.ai.attachmentParsing.maxChars);
    const status = text ? 'completed' : 'unsupported';
    const descriptionResult = await generateResourceDescription(
      { ...version, parser: extracted.parser },
      text,
    );
    const summary = descriptionResult.summary;
    const suggestedTags = await suggestExistingTags(
      version.workspace_id,
      [text, descriptionResult.description, ...descriptionResult.keywords].join(' '),
    );
    const contentHash = text ? crypto.createHash('sha256').update(text).digest('hex') : null;
    await db.query(
      `
        INSERT INTO resource_contents
          (version_id, status, parser, extracted_text, summary, auto_description, keywords_json,
           description_status, description_model, description_error, suggested_tags_json,
           text_chars, page_count, truncated, content_hash, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status), parser = VALUES(parser), extracted_text = VALUES(extracted_text),
          summary = VALUES(summary), auto_description = VALUES(auto_description),
          keywords_json = VALUES(keywords_json), description_status = VALUES(description_status),
          description_model = VALUES(description_model), description_error = VALUES(description_error),
          suggested_tags_json = VALUES(suggested_tags_json),
          text_chars = VALUES(text_chars), page_count = VALUES(page_count),
          truncated = VALUES(truncated), content_hash = VALUES(content_hash), error_message = NULL
      `,
      [
        versionId,
        status,
        extracted.parser,
        text || null,
        summary || null,
        descriptionResult.description || null,
        JSON.stringify(descriptionResult.keywords),
        descriptionResult.status,
        descriptionResult.model,
        descriptionResult.error,
        JSON.stringify(suggestedTags),
        text.length,
        extracted.pageCount,
        extracted.truncated ? 1 : 0,
        contentHash,
      ],
    );
    await db.query(
      `UPDATE resources
       SET status = ?,
           description = CASE WHEN description_source IN ('none', 'ai') THEN ? ELSE description END,
           description_source = CASE WHEN description_source IN ('none', 'ai') THEN 'ai' ELSE description_source END
       WHERE id = ?`,
      ['ready', descriptionResult.description || null, version.resource_id],
    );
    await db.query(
      `UPDATE resource_processing_jobs
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE version_id = ?`,
      [versionId],
    );
    await enqueueIndexJob({
      targetType: 'resources',
      targetId: version.resource_id,
      operation: 'upsert',
      reason: 'resource content processed',
    });
    return { resourceId: Number(version.resource_id), versionId: Number(versionId), status: 'ready' };
  } catch (error) {
    const message = String(error?.message || error || '资料处理失败').slice(0, 4000);
    const fallback = fallbackResourceDescription(version, '');
    await db.query(
      `UPDATE resource_contents
       SET status = 'failed', summary = ?, auto_description = ?, keywords_json = ?,
           description_status = 'failed', description_error = ?, error_message = ?
       WHERE version_id = ?`,
      [fallback.summary, fallback.description, JSON.stringify(fallback.keywords), message, message, versionId],
    );
    await db.query(
      `UPDATE resources
       SET status = 'failed',
           description = CASE WHEN description_source IN ('none', 'ai') THEN ? ELSE description END,
           description_source = CASE WHEN description_source IN ('none', 'ai') THEN 'ai' ELSE description_source END
       WHERE id = ?`,
      [fallback.description, version.resource_id],
    );
    await db.query(
      `UPDATE resource_processing_jobs
       SET status = 'failed', completed_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_by = NULL, last_error = ?
       WHERE version_id = ?`,
      [message, versionId],
    );
    await enqueueIndexJob({
      targetType: 'resources',
      targetId: version.resource_id,
      operation: 'upsert',
      reason: 'resource metadata indexed after processing failure',
    });
    throw error;
  }
}

export async function queueResourceProcessing(resourceId, versionId) {
  await getPool().query(
    `
      INSERT INTO resource_processing_jobs (resource_id, version_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
        locked_at = NULL, locked_by = NULL, last_error = NULL, completed_at = NULL
    `,
    [resourceId, versionId],
  );
  setImmediate(() => {
    processResourceVersion(versionId).catch((error) => {
      console.error(`Resource version ${versionId} processing failed:`, error.message);
    });
  });
}
