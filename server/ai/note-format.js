import { config } from '../config.js';

const allowedMarks = new Set(['bold', 'italic', 'link', 'code']);
const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
]);

function chatCompletionsUrl() {
  const baseUrl = String(config.ai.litellm.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('LiteLLM requires LITELLM_BASE_URL.');
  }
  return `${baseUrl}/chat/completions`;
}

function textToRichDoc(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.length
      ? lines.map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : undefined,
        }))
      : [{ type: 'paragraph' }],
  };
}

function normalizeInputDoc(value, fallbackText = '') {
  if (value && typeof value === 'object' && value.type === 'doc') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === 'doc') return parsed;
    } catch {
      return textToRichDoc(fallbackText);
    }
  }
  return textToRichDoc(fallbackText);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAttachmentAttrs(attrs = {}) {
  return {
    id: attrs.id ?? null,
    tempId: attrs.tempId ?? null,
    name: String(attrs.name || attrs.originalName || '附件').slice(0, 255),
    size: Number(attrs.size || attrs.fileSize || 0),
    mimeType: String(attrs.mimeType || 'application/octet-stream').slice(0, 120),
    previewUrl: attrs.previewUrl || null,
    downloadUrl: attrs.downloadUrl || null,
    isImage: Boolean(attrs.isImage),
  };
}

function docWithAttachmentPlaceholders(doc) {
  const attachments = [];

  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'fileAttachment') {
      const token = `ATTACHMENT_${attachments.length + 1}`;
      const attrs = normalizeAttachmentAttrs(node.attrs || {});
      attachments.push({ token, attrs });
      return {
        type: 'fileAttachment',
        attrs: {
          placeholder: token,
          name: attrs.name,
          mimeType: attrs.mimeType,
          isImage: attrs.isImage,
        },
      };
    }
    const next = { ...node };
    if (Array.isArray(node.content)) {
      next.content = node.content.map(visit).filter(Boolean);
    }
    return next;
  };

  return { promptDoc: visit(clone(doc)), attachments };
}

function safeLink(href) {
  const value = String(href || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeMarks(marks) {
  if (!Array.isArray(marks)) return undefined;
  const normalized = marks
    .map((mark) => {
      if (!allowedMarks.has(mark?.type)) return null;
      if (mark.type === 'link') {
        const href = safeLink(mark.attrs?.href);
        return href ? { type: 'link', attrs: { href } } : null;
      }
      return { type: mark.type };
    })
    .filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function flatten(nodes) {
  return nodes.flatMap((node) => (Array.isArray(node) ? flatten(node) : node ? [node] : []));
}

function isInlineNode(node) {
  return node?.type === 'text' || node?.type === 'hardBreak';
}

function isBlockNode(node) {
  return node && (blockTypes.has(node.type) || node.type === 'fileAttachment');
}

function wrapInlineNodes(nodes) {
  const content = nodes.filter(isInlineNode);
  return content.length ? [{ type: 'paragraph', content }] : [];
}

function normalizeRootContent(nodes) {
  const result = [];
  let inlineBuffer = [];
  const flushInline = () => {
    if (inlineBuffer.length) {
      result.push({ type: 'paragraph', content: inlineBuffer });
      inlineBuffer = [];
    }
  };

  for (const node of nodes) {
    if (isInlineNode(node)) {
      inlineBuffer.push(node);
      continue;
    }
    flushInline();
    if (isBlockNode(node)) result.push(node);
  }
  flushInline();
  return result;
}

function sanitizeFormattedDoc(value, attachments) {
  const attachmentMap = new Map(attachments.map((item) => [item.token, item.attrs]));
  const usedAttachments = new Set();

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 24) return [];
    if (node.type === 'text') {
      const text = String(node.text || '').slice(0, 5000);
      return text ? [{ type: 'text', text, marks: sanitizeMarks(node.marks) }] : [];
    }
    if (node.type === 'hardBreak') return [{ type: 'hardBreak' }];
    if (node.type === 'fileAttachment') {
      const token = String(node.attrs?.placeholder || node.attrs?.token || node.attrs?.name || '').trim();
      if (!attachmentMap.has(token) || usedAttachments.has(token)) return [];
      usedAttachments.add(token);
      return [{ type: 'fileAttachment', attrs: attachmentMap.get(token) }];
    }

    const children = flatten((node.content || []).map((child) => visit(child, depth + 1)));
    if (!blockTypes.has(node.type)) return children;

    const next = { type: node.type };
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level || 3);
      next.attrs = { level: Math.max(1, Math.min(4, Number.isFinite(level) ? level : 3)) };
    }
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      const inlineContent = children.filter(isInlineNode);
      if (inlineContent.length) next.content = inlineContent;
      if (!inlineContent.length && node.type !== 'paragraph') return [];
      return [next];
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = children.filter((child) => child.type === 'listItem');
      if (!items.length) return [];
      next.content = items;
      return [next];
    }
    if (node.type === 'listItem') {
      const blockChildren = children.filter(isBlockNode);
      next.content = blockChildren.length ? blockChildren : wrapInlineNodes(children);
      return next.content.length ? [next] : [];
    }
    if (node.type === 'blockquote') {
      const blockChildren = children.filter(isBlockNode);
      next.content = blockChildren.length ? blockChildren : wrapInlineNodes(children);
      return next.content.length ? [next] : [];
    }
    if (children.length) next.content = children.filter(isBlockNode);
    if (!next.content?.length) return [];
    return [next];
  };

  const root = value?.type === 'doc' ? value : value?.contentJson?.type === 'doc' ? value.contentJson : null;
  const content = normalizeRootContent(flatten((root?.content || []).map((node) => visit(node))));

  for (const item of attachments) {
    if (!usedAttachments.has(item.token)) {
      content.push({ type: 'fileAttachment', attrs: item.attrs });
    }
  }

  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  };
}

function extractPlainTextFromDoc(doc) {
  const parts = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (node.type === 'fileAttachment' && node.attrs?.name) parts.push(node.attrs.name);
    (node.content || []).forEach(visit);
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'fileAttachment') {
      parts.push('\n');
    }
  };
  visit(doc);
  return parts.join(' ').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function parseModelJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI did not return valid JSON.');
  }
}

function parseOpenAiStreamEvent(block, onDelta) {
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  for (const data of dataLines) {
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data);
    const choice = payload.choices?.[0] || {};
    const delta = choice.delta?.content ?? choice.message?.content ?? choice.text ?? '';
    if (delta) onDelta(delta);
  }
}

async function readOpenAiStream(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      if (block.trim()) parseOpenAiStreamEvent(block, onDelta);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) parseOpenAiStreamEvent(buffer, onDelta);
}

async function callModel(messages) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }

  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.15,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `LiteLLM request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || '';
}

async function callModelStream(messages, onDelta, signal) {
  if (!config.ai.litellm.apiKey || !config.ai.litellm.chatModel) {
    throw new Error('LiteLLM requires LITELLM_API_KEY and LITELLM_CHAT_MODEL.');
  }

  const response = await fetch(chatCompletionsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.litellm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.litellm.chatModel,
      temperature: 0.15,
      stream: true,
      messages,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `LiteLLM stream failed with status ${response.status}.`);
  }

  let answer = '';
  await readOpenAiStream(response.body, (delta) => {
    answer += delta;
    onDelta?.(delta);
  });
  return answer;
}

function normalizeFormatInstruction(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

function createNoteFormatInput({
  title = '',
  category = '',
  content = '',
  contentJson = null,
  noteId = null,
  instruction = '',
}) {
  const inputDoc = normalizeInputDoc(contentJson, content);
  const plainText = extractPlainTextFromDoc(inputDoc) || String(content || '').trim();
  if (!plainText) {
    throw new Error('笔记内容不能为空。');
  }

  const { promptDoc, attachments } = docWithAttachmentPlaceholders(inputDoc);
  return { noteId, title, category, plainText, promptDoc, attachments, instruction: normalizeFormatInstruction(instruction) };
}

function attachmentTokenRegex() {
  return /\[\[(ATTACHMENT_\d+)\]\]/g;
}

function normalizeInlineLink(value) {
  const href = safeLink(value);
  return href ? { type: 'link', attrs: { href } } : null;
}

function textNodes(text) {
  const value = String(text || '').trim();
  if (!value) return [];

  const nodes = [];
  const pattern = /(`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;

  const pushText = (rawText, marks) => {
    if (!rawText) return;
    const node = { type: 'text', text: rawText };
    if (marks?.length) node.marks = marks;
    nodes.push(node);
  };

  for (const match of value.matchAll(pattern)) {
    if (match.index > lastIndex) {
      pushText(value.slice(lastIndex, match.index));
    }

    if (match[2]) {
      pushText(match[2], [{ type: 'code' }]);
    } else if (match[3] && match[4]) {
      const link = normalizeInlineLink(match[4]);
      pushText(match[3], link ? [link] : undefined);
    } else if (match[5]) {
      pushText(match[5], [{ type: 'bold' }]);
    } else if (match[6]) {
      pushText(match[6], [{ type: 'italic' }]);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    pushText(value.slice(lastIndex));
  }

  return nodes.length ? nodes : [{ type: 'text', text: value }];
}

function paragraph(text) {
  return { type: 'paragraph', content: textNodes(text) };
}

function listItem(text) {
  return { type: 'listItem', content: [paragraph(text)] };
}

function structuredTextToRichDoc(value, attachments) {
  const attachmentMap = new Map(attachments.map((item) => [item.token, item.attrs]));
  const usedAttachments = new Set();
  const content = [];
  let listType = null;
  let listItems = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    content.push({
      type: listType,
      content: listItems.map((item) => listItem(item)),
    });
    listType = null;
    listItems = [];
  };

  const pushAttachment = (token) => {
    if (!attachmentMap.has(token) || usedAttachments.has(token)) return;
    usedAttachments.add(token);
    content.push({ type: 'fileAttachment', attrs: attachmentMap.get(token) });
  };

  const pushTextLine = (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      content.push({
        type: 'heading',
        attrs: { level: Math.min(4, heading[1].length) },
        content: textNodes(heading[2]),
      });
      return;
    }

    const markdownTitle = trimmed.match(/^\*\*([^*]{2,120})\*\*(?:\s+(.+))?$/);
    if (markdownTitle && !/[：:]/.test(trimmed)) {
      flushList();
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: textNodes(`${markdownTitle[1]}${markdownTitle[2] ? ` ${markdownTitle[2]}` : ''}`),
      });
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== 'bulletList') flushList();
      listType = 'bulletList';
      listItems.push(bullet[1]);
      return;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== 'orderedList') flushList();
      listType = 'orderedList';
      listItems.push(ordered[1]);
      return;
    }

    flushList();
    content.push(paragraph(trimmed));
  };

  String(value || '')
    .replace(/^```(?:text|markdown)?/i, '')
    .replace(/```$/i, '')
    .split(/\r?\n/)
    .forEach((line) => {
      const parts = [];
      let lastIndex = 0;
      for (const match of line.matchAll(attachmentTokenRegex())) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: line.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'attachment', value: match[1] });
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        parts.push({ type: 'text', value: line.slice(lastIndex) });
      }
      if (!parts.length) {
        flushList();
        return;
      }
      for (const part of parts) {
        if (part.type === 'attachment') {
          flushList();
          pushAttachment(part.value);
        } else {
          pushTextLine(part.value);
        }
      }
    });
  flushList();

  for (const item of attachments) {
    if (!usedAttachments.has(item.token)) {
      content.push({ type: 'fileAttachment', attrs: item.attrs });
    }
  }

  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  };
}

function buildJsonFormatMessages({ noteId, title, category, plainText, promptDoc, attachments, instruction }) {
  const systemPrompt = [
    '你是个人助理任务台的笔记排版整理助手。',
    '你的任务是对单篇笔记做轻微润色和排版优化：分段、加小标题、列表、重点标记，必要时整理顺序。',
    '不要新增事实、日期、人物、链接、任务、结论或附件；不确定的内容必须保留原意。',
    '必须返回 JSON，不要 Markdown，不要解释。',
    '返回结构必须是 {"contentJson": TipTapDoc}。',
    'TipTapDoc 只能使用 doc、paragraph、heading、bulletList、orderedList、listItem、blockquote、codeBlock、text、hardBreak、fileAttachment。',
    '文字 mark 只能使用 bold、italic、link、code；link 只能使用 http、https 或 mailto。',
    '附件只能使用输入里的占位符，格式必须是 {"type":"fileAttachment","attrs":{"placeholder":"ATTACHMENT_1"}}；可以调整位置，不能新增未知附件。',
    '如果用户提供了整理想法，请在不新增事实的前提下优先按该想法整理；如果没有整理想法，就按默认轻微润色和清晰排版处理。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    noteId,
    title,
    category,
    plainText: plainText.slice(0, 20000),
    instruction: instruction || '默认整理：轻微润色、清晰分段、必要时加标题/列表，不新增事实。',
    contentJson: promptDoc,
    attachments: attachments.map((item) => ({
      placeholder: item.token,
      name: item.attrs.name,
      mimeType: item.attrs.mimeType,
      isImage: item.attrs.isImage,
    })),
  });

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildStreamingFormatMessages({ noteId, title, category, plainText, promptDoc, attachments, instruction }) {
  const systemPrompt = [
    '你是个人助理任务台的笔记排版整理助手。',
    '请对单篇笔记做轻微润色和排版优化，并直接输出整理后的正文。',
    '输出会被实时显示给用户，所以不要输出 JSON、解释、前后寒暄或代码围栏。',
    '允许使用简洁结构标记：# 小标题、- 列表、1. 编号列表、空行分段；标题必须用 #，不要用 **标题**。',
    '不要新增事实、日期、人物、链接、任务、结论或附件；不确定的内容必须保留原意。',
    '附件只能使用输入里的占位符。需要放附件时，单独输出一行 [[ATTACHMENT_1]]；可以调整位置，不能新增未知附件。',
    '如果用户提供了整理想法，请在不新增事实的前提下优先按该想法整理；如果没有整理想法，就按默认轻微润色和清晰排版处理。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    noteId,
    title,
    category,
    plainText: plainText.slice(0, 20000),
    instruction: instruction || '默认整理：轻微润色、清晰分段、必要时加标题/列表，不新增事实。',
    contentJson: promptDoc,
    attachments: attachments.map((item) => ({
      placeholder: `[[${item.token}]]`,
      name: item.attrs.name,
      mimeType: item.attrs.mimeType,
      isImage: item.attrs.isImage,
    })),
  });

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export async function formatNoteWithAi({
  title = '',
  category = '',
  content = '',
  contentJson = null,
  noteId = null,
  instruction = '',
}) {
  const input = createNoteFormatInput({ title, category, content, contentJson, noteId, instruction });
  const modelText = await callModel(buildJsonFormatMessages(input));
  const parsed = parseModelJson(modelText);
  const formattedDoc = sanitizeFormattedDoc(parsed.contentJson || parsed, input.attachments);
  const formattedText = extractPlainTextFromDoc(formattedDoc);
  if (!formattedText) {
    throw new Error('AI 整理结果为空。');
  }

  return {
    content: formattedText,
    contentJson: formattedDoc,
  };
}

export async function streamFormatNoteWithAi(
  { title = '', category = '', content = '', contentJson = null, noteId = null, instruction = '' },
  handlers = {},
) {
  const input = createNoteFormatInput({ title, category, content, contentJson, noteId, instruction });
  const streamedText = await callModelStream(
    buildStreamingFormatMessages(input),
    handlers.onDelta,
    handlers.signal,
  );
  const formattedDoc = structuredTextToRichDoc(streamedText, input.attachments);
  const formattedText = extractPlainTextFromDoc(formattedDoc);
  if (!formattedText) {
    throw new Error('AI 整理结果为空。');
  }
  const result = {
    content: formattedText,
    contentJson: formattedDoc,
    streamText: streamedText,
  };
  handlers.onDone?.(result);
  return result;
}
