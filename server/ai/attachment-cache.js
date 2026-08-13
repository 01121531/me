import crypto from 'crypto';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { readStoredAttachment } from '../storage.js';
import { extractAttachmentText } from './attachment-text.js';

const kindConfig = {
  log: {
    table: 'log_attachments',
  },
  note: {
    table: 'note_attachments',
  },
  task: {
    table: 'task_attachments',
  },
};

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const textExtensions = new Set(['.pdf', '.docx', '.xlsx', '.csv']);
const maxImageSide = 2200;

function normalizeKind(kind) {
  return kindConfig[kind] ? kind : null;
}

function extensionOf(attachment) {
  return path.extname(attachment.original_name || '').toLowerCase();
}

function supportsExtraction(attachment) {
  const extension = extensionOf(attachment);
  return textExtensions.has(extension) || imageExtensions.has(extension);
}

function trimText(value, maxChars = config.ai.attachmentParsing.maxChars) {
  const text = String(value || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[内容已截断]` : text;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function openAiChatUrl() {
  const baseUrl = String(config.ai.ocr.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('OCR requires OCR_BASE_URL or LITELLM_BASE_URL.');
  return `${baseUrl}/chat/completions`;
}

function assertOcrConfiguration() {
  if (!config.ai.ocr.apiKey || !config.ai.ocr.model) {
    throw new Error('OCR requires OCR_API_KEY/OCR_MODEL or LITELLM_API_KEY/LITELLM_CHAT_MODEL.');
  }
}

async function getAttachment(kind, id) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return null;
  const [rows] = await getPool().query(
    `SELECT * FROM ${kindConfig[normalizedKind].table} WHERE id = ?`,
    [Number(id)],
  );
  return rows[0] || null;
}

export async function getAttachmentTextCache(kind, id) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return null;
  const [rows] = await getPool().query(
    `
      SELECT *
      FROM attachment_text_cache
      WHERE attachment_kind = ? AND attachment_id = ?
    `,
    [normalizedKind, Number(id)],
  );
  return rows[0] || null;
}

export async function deleteAttachmentTextCache(kind, id) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return;
  await getPool().query(
    'DELETE FROM attachment_text_cache WHERE attachment_kind = ? AND attachment_id = ?',
    [normalizedKind, Number(id)],
  );
}

async function saveCache(kind, id, payload) {
  const text = trimText(payload.text || '');
  await getPool().query(
    `
      INSERT INTO attachment_text_cache
        (attachment_kind, attachment_id, status, parser, text, text_chars, page_count, truncated, content_hash, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        parser = VALUES(parser),
        text = VALUES(text),
        text_chars = VALUES(text_chars),
        page_count = VALUES(page_count),
        truncated = VALUES(truncated),
        content_hash = VALUES(content_hash),
        error_message = VALUES(error_message)
    `,
    [
      kind,
      Number(id),
      payload.status,
      payload.parser || null,
      text || null,
      text.length,
      payload.pageCount || null,
      payload.truncated ? 1 : 0,
      payload.contentHash || null,
      payload.errorMessage || null,
    ],
  );
  return getAttachmentTextCache(kind, id);
}

export async function queueAttachmentTextExtraction(kind, id, { force = false } = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return null;
  const attachment = await getAttachment(normalizedKind, id);
  if (!attachment) return null;
  const status = supportsExtraction(attachment) ? 'pending' : 'unsupported';
  return saveCache(normalizedKind, id, {
    status,
    parser: status === 'unsupported' ? 'unsupported' : null,
    errorMessage: status === 'unsupported' ? '该附件类型暂不支持文本识别。' : null,
    truncated: false,
    contentHash: force ? null : undefined,
  });
}

export function scheduleAttachmentTextExtraction(kind, id, options = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) return;
  setTimeout(() => {
    extractAndCacheAttachmentText(normalizedKind, id, options).catch((error) => {
      console.error(`Attachment text extraction failed for ${normalizedKind}:${id}:`, error.message);
    });
  }, 0);
}

async function describeImageBatch(images, { title, pageOffset = 0, kind = 'image' } = {}) {
  assertOcrConfiguration();
  const parts = [
    {
      type: 'text',
      text: [
        '请把下面图片中的可见文字和关键信息整理成可检索的中文文本。',
        '如果是证照、合同、票据、截图或表格，请尽量保留公司名、姓名、编号、日期、金额、地址、联系方式和字段名。',
        '不要猜测看不清的内容；不确定就写“无法确认”。',
        kind === 'pdf'
          ? `这些图片来自文件“${title}”，按顺序对应第 ${pageOffset + 1} 页开始的 PDF 页面。`
          : `图片文件名为“${title}”。`,
      ].join('\n'),
    },
  ];

  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
  }

  const response = await fetch(openAiChatUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.ocr.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.ocr.model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: parts,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `OCR model request failed with status ${response.status}.`);
  }
  const json = await response.json();
  return trimText(json.choices?.[0]?.message?.content || '');
}

function dataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function imageBufferToDataUrl(buffer, mimeType) {
  const image = await loadImage(buffer);
  const ratio = Math.min(1, maxImageSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const jpeg = await canvas.encode('jpeg');
  return dataUrl('image/jpeg', jpeg);
}

async function renderPdfPages(buffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Number(pdf.numPages || 0);
  const pageLimit = Math.min(pageCount, Math.max(1, Number(config.ai.ocr.maxPdfPages || 20)));
  const images = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min(
        Number(config.ai.ocr.renderScale || 1.2),
        maxImageSide / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale: Math.max(0.35, fitScale) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const jpeg = await canvas.encode('jpeg');
      images.push({
        pageNumber,
        dataUrl: dataUrl('image/jpeg', jpeg),
      });
      page.cleanup?.();
    }
  } finally {
    await loadingTask.destroy?.();
  }

  return {
    images,
    pageCount,
    truncated: pageCount > pageLimit,
  };
}

async function describePdfPages(attachment, buffer) {
  const { images, pageCount, truncated } = await renderPdfPages(buffer);
  const batchSize = Math.max(1, Number(config.ai.ocr.batchPages || 4));
  const chunks = [];

  for (let index = 0; index < images.length; index += batchSize) {
    const batch = images.slice(index, index + batchSize);
    const text = await describeImageBatch(batch, {
      title: attachment.original_name,
      pageOffset: index,
      kind: 'pdf',
    });
    if (text) chunks.push(text);
  }

  return {
    parser: 'pdf-vision',
    text: trimText(chunks.join('\n\n')),
    pageCount,
    truncated,
  };
}

async function extractPdfTextOrVision(attachment, buffer) {
  const parsed = await extractAttachmentText(attachment, buffer, config.ai.attachmentParsing.maxChars);
  const text = trimText(parsed.text || '');
  if (compactText(text).length >= Number(config.ai.ocr.minTextChars || 80)) {
    return {
      parser: 'pdf',
      text,
      pageCount: null,
      truncated: false,
    };
  }

  const vision = await describePdfPages(attachment, buffer);
  const combined = [text && compactText(text) !== '-- 1 of 1 --' ? text : '', vision.text]
    .filter(Boolean)
    .join('\n\n');
  return {
    ...vision,
    parser: text ? 'pdf+vision' : vision.parser,
    text: trimText(combined),
  };
}

async function extractImageDescription(attachment, buffer) {
  const image = {
    dataUrl: await imageBufferToDataUrl(buffer, attachment.mime_type || 'image/jpeg'),
  };
  return {
    parser: 'image-vision',
    text: await describeImageBatch([image], {
      title: attachment.original_name,
      kind: 'image',
    }),
    pageCount: 1,
    truncated: false,
  };
}

async function extractTextForAttachment(attachment, buffer) {
  const extension = extensionOf(attachment);
  if (extension === '.pdf') return extractPdfTextOrVision(attachment, buffer);
  if (imageExtensions.has(extension)) return extractImageDescription(attachment, buffer);

  const extracted = await extractAttachmentText(attachment, buffer, config.ai.attachmentParsing.maxChars);
  return {
    parser: extracted.parser,
    text: extracted.text,
    pageCount: null,
    truncated: false,
  };
}

export async function extractTemporaryAttachmentText({ originalName, mimeType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { parser: null, text: '', pageCount: null, truncated: false };
  }
  return extractTextForAttachment({
    original_name: String(originalName || '微信附件'),
    mime_type: String(mimeType || 'application/octet-stream'),
  }, buffer);
}

export async function extractAndCacheAttachmentText(kind, id, { force = false } = {}) {
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) throw new Error('Invalid attachment kind.');

  const attachment = await getAttachment(normalizedKind, id);
  if (!attachment) throw new Error('Attachment does not exist.');

  if (!supportsExtraction(attachment)) {
    return saveCache(normalizedKind, id, {
      status: 'unsupported',
      parser: 'unsupported',
      errorMessage: '该附件类型暂不支持文本识别。',
    });
  }

  let buffer;
  let hash;
  try {
    buffer = await readStoredAttachment(attachment, config.ai.attachmentParsing.maxBytes);
    hash = contentHash(buffer);
    const existing = await getAttachmentTextCache(normalizedKind, id);
    if (!force && existing?.status === 'completed' && existing.content_hash === hash) {
      return existing;
    }

    await saveCache(normalizedKind, id, {
      status: 'processing',
      parser: null,
      text: '',
      contentHash: hash,
      errorMessage: null,
    });

    const extracted = await extractTextForAttachment(attachment, buffer);
    const text = trimText(extracted.text || '');
    return saveCache(normalizedKind, id, {
      status: text ? 'completed' : 'failed',
      parser: extracted.parser || null,
      text,
      pageCount: extracted.pageCount,
      truncated: extracted.truncated,
      contentHash: hash,
      errorMessage: text ? null : '没有识别到可用文字。',
    });
  } catch (error) {
    return saveCache(normalizedKind, id, {
      status: 'failed',
      parser: extensionOf(attachment).slice(1) || null,
      text: '',
      contentHash: hash || null,
      errorMessage: String(error?.message || error).slice(0, 1000),
    });
  }
}

export function mapCacheRow(row) {
  if (!row?.text_status) return {};
  return {
    textStatus: row.text_status,
    textParser: row.text_parser || null,
    textChars: Number(row.text_chars || 0),
    textUpdatedAt: row.text_updated_at || null,
    textError: row.text_error || '',
    textTruncated: Boolean(row.text_truncated),
  };
}

export const attachmentTextJoinSql = (kind, alias = 'a') => `
  LEFT JOIN attachment_text_cache atc
    ON atc.attachment_kind = '${kind}' AND atc.attachment_id = ${alias}.id
`;

export const attachmentTextSelectSql = `
  atc.status AS text_status,
  atc.parser AS text_parser,
  atc.text_chars AS text_chars,
  atc.updated_at AS text_updated_at,
  atc.error_message AS text_error,
  atc.truncated AS text_truncated
`;
