import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Flag,
  GripVertical,
  ImageIcon,
  Link2,
  Paperclip,
  Upload,
  Info,
  LayoutDashboard,
  ListFilter,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { api } from './api.js';

const columns = [
  { status: 'todo', title: '寰呭姙', icon: ClipboardList },
  { status: 'in_progress', title: '杩涜涓?, icon: Clock3 },
  { status: 'done', title: '宸插畬鎴?, icon: Check },
];

const priorityLabels = {
  low: '浣?,
  medium: '涓?,
  high: '楂?,
};

const statusLabels = {
  todo: '寰呭姙',
  in_progress: '杩涜涓?,
  done: '宸插畬鎴?,
};

const columnStatuses = columns.map((column) => column.status);

const emptyTaskForm = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: '',
  progress: 0,
  status: 'todo',
  tags: '',
};

const attachmentAccept = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
].join(',');

const emptyRichDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
};

const noteTemplates = [
  {
    id: 'account',
    label: '璐﹀彿璁板綍',
    title: '璐﹀彿璁板綍',
    category: '璐﹀彿',
    content: '璐﹀彿鍚嶇О锛歕n骞冲彴/鐢ㄩ€旓細\n鐧诲綍鏂瑰紡锛歕n鍏抽敭缃戝潃锛歕n缁戝畾淇℃伅锛歕n褰撳墠鐘舵€侊細\n娉ㄦ剰浜嬮」锛歕n涓嬩竴姝ワ細',
  },
  {
    id: 'contract',
    label: '鍚堝悓璁板綍',
    title: '鍚堝悓璁板綍',
    category: '鍚堝悓',
    content: '鍚堝悓鍚嶇О锛歕n鍚堜綔鏂癸細\n璐熻矗浜猴細\n褰撳墠闃舵锛歕n鍏抽敭鏃ユ湡锛歕n寰呯‘璁や簨椤癸細\n闄勪欢璇存槑锛歕n涓嬩竴姝ワ細',
  },
  {
    id: 'customer',
    label: '瀹㈡埛娌熼€?,
    title: '瀹㈡埛娌熼€氳褰?,
    category: '瀹㈡埛',
    content: '瀹㈡埛/鑱旂郴浜猴細\n娌熼€氭椂闂达細\n娌熼€氭笭閬擄細\n鏍稿績璇夋眰锛歕n宸茬‘璁ゅ唴瀹癸細\n寰呭洖澶嶉棶棰橈細\n椋庨櫓/澶囨敞锛歕n涓嬩竴姝ワ細',
  },
  {
    id: 'troubleshooting',
    label: '闂鎺掓煡',
    title: '闂鎺掓煡璁板綍',
    category: '闂',
    content: '闂鐜拌薄锛歕n褰卞搷鑼冨洿锛歕n澶嶇幇姝ラ锛歕n宸插皾璇曟搷浣滐細\n鎺掓煡缁撹锛歕n涓存椂鏂规锛歕n寰呴獙璇佷簨椤癸細\n涓嬩竴姝ワ細',
  },
  {
    id: 'meeting',
    label: '浼氳绾',
    title: '浼氳绾',
    category: '浼氳绾',
    content: '浼氳涓婚锛歕n鍙備細浜哄憳锛歕n璁ㄨ瑕佺偣锛歕n宸茬‘瀹氫簨椤癸細\n寰呭姙浜嬮」锛歕n璐熻矗浜猴細\n鎴鏃堕棿锛歕n涓嬩竴娆¤窡杩涳細',
  },
];

const noteFormatPresets = [
  {
    id: 'checklist',
    label: '鎸夋竻鍗曟暣鐞?,
    instruction: '鎶婂唴瀹规暣鐞嗘垚娓呮櫚鐨勫緟鍔炴竻鍗曞拰宸茬‘璁や簨椤癸紝淇濈暀鍘熸湁浜嬪疄锛屼笉鏂板淇℃伅銆?,
  },
  {
    id: 'grouped',
    label: '鎸夊垎缁勬暣鐞?,
    instruction: '鎸変富棰樻垨瀵硅薄鍒嗙粍鏁寸悊锛岀粰姣忕粍鍔犵畝鐭皬鏍囬锛岄噸澶嶅唴瀹瑰悎骞讹紝涓嶆柊澧炰簨瀹炪€?,
  },
  {
    id: 'todos',
    label: '鎻愬彇寰呭姙',
    instruction: '閲嶇偣鎻愬彇寰呭姙浜嬮」銆佽礋璐ｄ汉銆佹埅姝㈡椂闂村拰涓嬩竴姝ワ紝鏃犳硶纭鐨勫瓧娈垫爣娉ㄤ负寰呯‘璁ゃ€?,
  },
  {
    id: 'key-info',
    label: '鎻愬彇鍏抽敭淇℃伅',
    instruction: '鎻愬彇璐﹀彿銆侀摼鎺ャ€侀噾棰濄€佹椂闂淬€佽仈绯讳汉銆佺姸鎬佺瓑鍏抽敭瀛楁锛岄€傚悎鏃舵暣鐞嗘垚琛ㄦ牸銆?,
  },
];

const logTemplates = [
  {
    id: 'follow-up',
    label: '鏃ュ父璺熻繘',
    content: '宸茶窡杩涘綋鍓嶄换鍔★紝纭浜嗘渶鏂拌繘灞曚笌闃诲鐐广€?,
    nextStep: '缁х画鎺ㄨ繘涓嬩竴姝ワ紝骞跺悓姝ュ叧閿粨鏋溿€?,
    hours: '0.5',
    detailsOpen: false,
  },
  {
    id: 'communication',
    label: '娌熼€氳褰?,
    content: '宸插畬鎴愮浉鍏虫矡閫氾紝璁板綍瀵规柟鍙嶉銆佺‘璁や簨椤瑰拰寰呭洖澶嶉棶棰樸€?,
    nextStep: '鏁寸悊娌熼€氱粨璁猴紝骞惰窡杩涙湭纭浜嬮」銆?,
    hours: '0.5',
    detailsOpen: true,
  },
  {
    id: 'file-work',
    label: '鏂囦欢鏁寸悊',
    content: '宸叉暣鐞嗘湰闃舵鏂囦欢鎴栧浘鐗囪祫鏂欙紝骞惰ˉ鍏呴檮浠惰鏄庛€?,
    nextStep: '妫€鏌ヨ祫鏂欐槸鍚﹀畬鏁达紝蹇呰鏃剁户缁ˉ鍏呮垨鎻愪氦瀹℃牳銆?,
    hours: '1',
    detailsOpen: true,
  },
  {
    id: 'issue',
    label: '闂澶勭悊',
    content: '宸插畾浣嶅苟澶勭悊褰撳墠闂锛岃褰曠幇璞°€佸師鍥犲拰澶勭悊缁撴灉銆?,
    nextStep: '缁х画瑙傚療缁撴灉锛岀‘璁ら棶棰樻槸鍚﹀鐜般€?,
    hours: '1',
    detailsOpen: true,
  },
  {
    id: 'summary',
    label: '闃舵鎬荤粨',
    content: '鏈樁娈靛凡瀹屾垚涓昏浜嬮」锛屾暣鐞嗕簡褰撳墠鎴愭灉銆佸墿浣欓棶棰樺拰涓嬩竴姝ヨ鍒掋€?,
    nextStep: '鎸夎鍒掕繘鍏ヤ笅涓€闃舵澶勭悊銆?,
    hours: '1',
    detailsOpen: true,
  },
];

const customLogTemplatesStorageKey = 'assistant-task-board:custom-log-templates:v1';
const customNoteTemplatesStorageKey = 'assistant-task-board:custom-note-templates:v1';

function normalizeCustomNoteTemplate(template) {
  const label = String(template?.label || '').trim().slice(0, 24);
  const content = String(template?.content || '').trim();
  if (!label || !content) return null;
  return {
    id: template?.id || `custom-note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    custom: true,
    label,
    title: String(template?.title || label).trim().slice(0, 160),
    category: String(template?.category || '').trim().slice(0, 60),
    content,
  };
}

function loadCustomNoteTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(customNoteTemplatesStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeCustomNoteTemplate).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomNoteTemplates(templates) {
  try {
    localStorage.setItem(customNoteTemplatesStorageKey, JSON.stringify(templates));
  } catch {
    // Browser storage can fail in private mode; templates are convenience data only.
  }
}

function normalizeCustomLogTemplate(template) {
  const label = String(template?.label || '').trim().slice(0, 24);
  const content = String(template?.content || '').trim();
  if (!label || !content) return null;
  return {
    id: String(template?.id || `custom-${Date.now()}`),
    label,
    content,
    nextStep: String(template?.nextStep || '').trim(),
    hours: String(template?.hours || '').trim(),
    detailsOpen: Boolean(template?.detailsOpen || template?.nextStep),
    custom: true,
  };
}

function loadCustomLogTemplates() {
  try {
    const raw = localStorage.getItem(customLogTemplatesStorageKey);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCustomLogTemplate).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}

function saveCustomLogTemplates(templates) {
  try {
    localStorage.setItem(customLogTemplatesStorageKey, JSON.stringify(templates));
  } catch {
    // 鑷畾涔夋ā鏉垮彧鏄緟鍔╁綍鍏ワ紝淇濆瓨澶辫触涓嶅奖鍝嶆寮忔棩蹇椼€?  }
}

const FileAttachmentNode = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: null },
      tempId: { default: null },
      name: { default: '' },
      size: { default: 0 },
      mimeType: { default: 'application/octet-stream' },
      previewUrl: { default: null },
      downloadUrl: { default: null },
      isImage: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      'data-file-attachment': '',
      'data-id': HTMLAttributes.id || '',
      'data-temp-id': HTMLAttributes.tempId || '',
      'data-pending': HTMLAttributes.tempId ? 'true' : 'false',
      class: `${HTMLAttributes.isImage ? 'rich-attachment-node image' : 'rich-attachment-node'}${HTMLAttributes.tempId ? ' pending' : ''}`,
    };
    const name = HTMLAttributes.name || '闄勪欢';
    const size = formatFileSize(Number(HTMLAttributes.size || 0));

    if (HTMLAttributes.isImage && HTMLAttributes.previewUrl) {
      return [
        'figure',
        mergeAttributes(attrs),
        ['img', { src: HTMLAttributes.previewUrl, alt: name }],
        ['figcaption', {}, HTMLAttributes.tempId ? `${name} 路 寰呬繚瀛樹笂浼燻 : name],
      ];
    }

    return [
      'div',
      mergeAttributes(attrs),
      ['span', { class: 'rich-attachment-icon' }, 'FILE'],
      ['span', { class: 'rich-attachment-name' }, name],
      ['span', { class: 'rich-attachment-size' }, size],
      ...(HTMLAttributes.tempId ? [['span', { class: 'rich-attachment-pending' }, '寰呬繚瀛?]] : []),
    ];
  },
});

function today() {
  return formatChinaDateParts(chinaDateParts());
}

function weekStart() {
  const current = chinaDateParts();
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatChinaDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function chinaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
  };
}

function formatChinaDateParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '鏈缃?;
  return value.slice(0, 10);
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function compactAttachmentTextError(error = '') {
  if (!error) return '';
  let message = String(error);
  try {
    const parsed = JSON.parse(message);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {
    // Some providers return plain text; keep it and normalize below.
  }
  if (/No endpoints found that support image input/i.test(message)) {
    return '褰撳墠 OCR 妯″瀷涓嶆敮鎸佸浘鐗囪緭鍏?;
  }
  if (/timeout|timed out/i.test(message)) return '璇嗗埆瓒呮椂锛岃绋嶅悗閲嶈瘯';
  if (/rate limit|quota/i.test(message)) return '妯″瀷棰濆害鎴栭鐜囧彈闄?;
  return message.length > 36 ? `${message.slice(0, 36)}...` : message;
}

function attachmentTextStatusLabel(attachment) {
  const chars = Number(attachment.textChars || 0);
  if (attachment.textStatus === 'completed') {
    return `宸茶瘑鍒?{chars ? ` 路 ${chars} 瀛梎 : ''}${attachment.textTruncated ? ' 路 宸叉埅鏂? : ''}`;
  }
  if (attachment.textStatus === 'processing' || attachment.textStatus === 'pending') return '璇嗗埆涓?;
  if (attachment.textStatus === 'failed') {
    const reason = compactAttachmentTextError(attachment.textError);
    return `璇嗗埆澶辫触${reason ? `锛?{reason}` : ''}`;
  }
  if (attachment.textStatus === 'unsupported') return '鏆備笉鏀寔璇嗗埆';
  return '鏈瘑鍒?;
}

function canReextractAttachment(attachment) {
  return !attachment.textStatus || attachment.textStatus === 'failed';
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
      : emptyRichDoc.content,
  };
}

function noteToRichDoc(note) {
  return note?.contentJson || textToRichDoc(note?.content || '');
}

function extractPlainTextFromDoc(doc) {
  const parts = [];
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      parts.push(node.text);
    }
    if (node.type === 'fileAttachment' && node.attrs?.name) {
      parts.push(node.attrs.name);
    }
    (node.content || []).forEach(visit);
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'fileAttachment') {
      parts.push('\n');
    }
  };
  visit(doc);
  return parts.join(' ').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function replacePendingAttachmentNodes(doc, pendingFiles, uploadedAttachments) {
  const replacements = new Map();
  pendingFiles.forEach((item, index) => {
    const attachment = uploadedAttachments[index];
    if (!attachment) return;
    replacements.set(item.tempId, {
      id: attachment.id,
      tempId: null,
      name: attachment.originalName,
      size: attachment.fileSize,
      mimeType: attachment.mimeType,
      previewUrl: attachment.previewUrl,
      downloadUrl: attachment.downloadUrl,
      isImage: attachment.isImage,
    });
  });

  const visit = (node) => {
    if (!node) return node;
    const nextNode = { ...node };
    if (node.type === 'fileAttachment' && replacements.has(node.attrs?.tempId)) {
      nextNode.attrs = {
        ...node.attrs,
        ...replacements.get(node.attrs.tempId),
      };
    }
    if (node.content) {
      nextNode.content = node.content.map(visit);
    }
    return nextNode;
  };

  return visit(doc);
}

function stripPendingAttachmentNodes(doc) {
  const visit = (node) => {
    if (!node) return null;
    if (node.type === 'fileAttachment' && node.attrs?.tempId) {
      return null;
    }
    const nextNode = { ...node };
    if (node.content) {
      nextNode.content = node.content.map(visit).filter(Boolean);
    }
    return nextNode;
  };
  return visit(doc);
}

function noteDraftStorageKey(task, note) {
  const scope = note?.id
    ? `note-${note.id}`
    : task?.id
      ? `new-task-note-${task.id}`
      : 'new-standalone-note';
  return `assistant-task-board:note-draft:v1:${scope}`;
}

function isMeaningfulNoteDraft(form) {
  return Boolean(
    String(form?.title || '').trim()
    || String(form?.category || '').trim()
    || String(form?.content || '').trim()
    || form?.attachmentId,
  );
}

function normalizeDraftForm(draft) {
  const contentJson = draft?.contentJson?.type === 'doc'
    ? draft.contentJson
    : textToRichDoc(draft?.content || '');
  return {
    title: String(draft?.title || ''),
    category: String(draft?.category || ''),
    content: String(draft?.content || extractPlainTextFromDoc(contentJson)),
    contentJson,
    attachmentId: draft?.attachmentId ? String(draft.attachmentId) : '',
  };
}

function cloneRichDoc(doc) {
  return JSON.parse(JSON.stringify(doc || emptyRichDoc));
}

function normalizeFormattedNoteResult(result) {
  const contentJson = result?.contentJson?.type === 'doc'
    ? result.contentJson
    : textToRichDoc(result?.content || '');
  return {
    contentJson,
    content: String(result?.content || extractPlainTextFromDoc(contentJson)),
  };
}

function noteFormatPayloadFromNote(note) {
  const contentJson = noteToRichDoc(note);
  return {
    noteId: note?.id || null,
    title: note?.title || '',
    category: note?.category || '',
    content: note?.content || extractPlainTextFromDoc(contentJson),
    contentJson,
  };
}

function noteFormatPayloadFromForm(form, note) {
  const contentJson = form?.contentJson?.type === 'doc' ? form.contentJson : textToRichDoc(form?.content || '');
  return {
    noteId: note?.id || null,
    title: form?.title || '',
    category: form?.category || '',
    content: form?.content || extractPlainTextFromDoc(contentJson),
    contentJson,
  };
}

function formatDraftTime(savedAt) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(savedAt));
}

function createLogForm(task, log = null) {
  if (log) {
    return {
      logDate: formatDate(log.logDate),
      stage: log.stage || task.status,
      content: log.content || '',
      hours: String(log.hours ?? ''),
      progressSnapshot: String(log.progressSnapshot ?? progressForStatus(task.status, task.progress)),
      nextStep: log.nextStep || '',
    };
  }
  return {
    logDate: today(),
    stage: task.status,
    content: '',
    hours: '',
    progressSnapshot: String(progressForStatus(task.status, task.progress)),
    nextStep: '',
  };
}

function logDraftStorageKey(taskId, logId = null) {
  return `assistant-task-board:log-draft:v1:${logId ? `log-${logId}` : `task-${taskId}`}`;
}

function isMeaningfulLogDraft(form) {
  return Boolean(
    String(form?.content || '').trim()
    || String(form?.hours || '').trim()
    || String(form?.nextStep || '').trim(),
  );
}

function normalizeLogDraftForm(draft, task, log = null) {
  const fallback = createLogForm(task, log);
  return {
    logDate: /^\d{4}-\d{2}-\d{2}$/.test(String(draft?.logDate || ''))
      ? draft.logDate
      : fallback.logDate,
    stage: statusLabels[draft?.stage] ? draft.stage : fallback.stage,
    content: String(draft?.content || ''),
    hours: draft?.hours === undefined || draft?.hours === null ? fallback.hours : String(draft.hours),
    progressSnapshot: draft?.progressSnapshot === undefined || draft?.progressSnapshot === null
      ? fallback.progressSnapshot
      : String(Math.max(0, Math.min(100, Number(draft.progressSnapshot) || 0))),
    nextStep: String(draft?.nextStep || ''),
  };
}

function inferNextStepFromLogContent(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const patterns = [
    /^(?:涓嬩竴姝涓嬫|鍚庣画|寰呭姙|todo|TODO|璁″垝|闇€瑕佽窡杩泑缁х画璺熻繘)\s*[锛?锛?銆?]?\s*(.+)$/i,
    /^(?:闇€瑕亅鍑嗗|缁х画|鏄庡ぉ|绋嶅悗)\s*(.+)$/i,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      const suggestion = String(match?.[1] || '').trim();
      if (suggestion && suggestion.length >= 4) {
        return suggestion.slice(0, 180);
      }
    }
  }
  return '';
}

function attachmentNodeAttrsFromAttachment(attachment) {
  return {
    id: attachment.id,
    tempId: null,
    name: attachment.originalName,
    size: attachment.fileSize,
    mimeType: attachment.mimeType,
    previewUrl: attachment.previewUrl,
    downloadUrl: attachment.downloadUrl,
    isImage: attachment.isImage,
  };
}

function getOrderedColumnTasks(tasks, status) {
  return tasks
    .filter((task) => task.status === status)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.id - b.id);
}

function normalizeTaskOrders(tasks) {
  return columnStatuses.flatMap((status) =>
    getOrderedColumnTasks(tasks, status).map((task, index) => ({
      ...task,
      status,
      sortOrder: index,
    })),
  );
}

function getDropStatus(tasks, overId) {
  if (!overId) return null;
  if (columnStatuses.includes(overId)) return overId;
  return tasks.find((task) => task.id === Number(overId))?.status || null;
}

function reorderTasksForDrop(tasks, activeId, overId) {
  if (!overId) return tasks;

  const activeTask = tasks.find((task) => task.id === Number(activeId));
  const overStatus = getDropStatus(tasks, overId);
  if (!activeTask || !overStatus) return tasks;

  const activeStatus = activeTask.status;
  const overTask = tasks.find((task) => task.id === Number(overId));
  const nextByStatus = Object.fromEntries(
    columnStatuses.map((status) => [status, getOrderedColumnTasks(tasks, status)]),
  );

  if (overTask && activeStatus === overStatus) {
    const list = nextByStatus[activeStatus];
    const oldIndex = list.findIndex((task) => task.id === activeTask.id);
    const newIndex = list.findIndex((task) => task.id === overTask.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return tasks;
    }
    nextByStatus[activeStatus] = arrayMove(list, oldIndex, newIndex);
    return normalizeTaskOrders(columnStatuses.flatMap((status) => nextByStatus[status]));
  }

  nextByStatus[activeStatus] = nextByStatus[activeStatus].filter((task) => task.id !== activeTask.id);
  const targetList = nextByStatus[overStatus];
  const overIndex = overTask ? targetList.findIndex((task) => task.id === overTask.id) : -1;
  const insertIndex = overIndex >= 0 ? overIndex : targetList.length;

  targetList.splice(insertIndex, 0, {
    ...activeTask,
    status: overStatus,
  });

  return normalizeTaskOrders(columnStatuses.flatMap((status) => nextByStatus[status]));
}

function toOrderPayload(tasks) {
  return normalizeTaskOrders(tasks).map((task) => ({
    id: task.id,
    status: task.status,
    sortOrder: task.sortOrder,
  }));
}

function hasOrderChanged(before, after) {
  return JSON.stringify(toOrderPayload(before)) !== JSON.stringify(toOrderPayload(after));
}

function progressForStatus(status, progress = 0) {
  if (status === 'todo') return 0;
  if (status === 'done') return 100;
  return Math.max(0, Math.min(99, Number(progress) || 0));
}

function pointInRect(point, rect) {
  return Boolean(
    point &&
      rect &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
  );
}

function getPointCollisions(args, point) {
  if (!point) return [];

  const hits = args.droppableContainers
    .map((droppableContainer) => ({
      id: droppableContainer.id,
      data: { droppableContainer, value: 1 },
      rect: args.droppableRects.get(droppableContainer.id),
    }))
    .filter((item) => pointInRect(point, item.rect));

  const taskHit = hits.find(
    ({ id }) => id !== args.active.id && !columnStatuses.includes(id),
  );
  if (taskHit) {
    return [{ id: taskHit.id, data: taskHit.data }];
  }

  const columnHit = hits.find(({ id }) => columnStatuses.includes(id));
  if (columnHit) {
    return [{ id: columnHit.id, data: columnHit.data }];
  }

  const anyHit = hits.find(({ id }) => id !== args.active.id);
  return anyHit ? [{ id: anyHit.id, data: anyHit.data }] : [];
}

function boardCollisionDetection(args) {
  const activeId = args.active.id;
  const detect = (collisions) => {
    const taskHits = collisions.filter(
      ({ id }) => id !== activeId && !columnStatuses.includes(id),
    );
    if (taskHits.length) return taskHits;

    const columnHits = collisions.filter(({ id }) => columnStatuses.includes(id));
    if (columnHits.length) return columnHits;

    return collisions.filter(({ id }) => id !== activeId);
  };

  const pointerPointHits = getPointCollisions(args, args.pointerCoordinates);
  if (pointerPointHits.length) return pointerPointHits;

  if (args.collisionRect) {
    const centerPointHits = getPointCollisions(args, {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + args.collisionRect.height / 2,
    });
    if (centerPointHits.length) return centerPointHits;
  }

  const pointerHits = detect(pointerWithin(args));
  if (pointerHits.length) return pointerHits;

  const rectHits = detect(rectIntersection(args));
  if (rectHits.length) return rectHits;

  return detect(closestCorners(args));
}

function TaskBoardApp() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('today');
  const [filters, setFilters] = useState({ priority: '', tag: '' });
  const [activeDragId, setActiveDragId] = useState(null);
  const [overStatus, setOverStatus] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDrawerInitialSection, setTaskDrawerInitialSection] = useState('progress');
  const [editingTask, setEditingTask] = useState(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [createTaskDefaultStatus, setCreateTaskDefaultStatus] = useState('todo');
  const [createTaskInitialValues, setCreateTaskInitialValues] = useState(null);
  const [reportDates, setReportDates] = useState({ from: weekStart(), to: today() });
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [isApprovalsOpen, setIsApprovalsOpen] = useState(false);
  const [actionRequests, setActionRequests] = useState([]);
  const [actionRequestsLoading, setActionRequestsLoading] = useState(false);

  // Theme state
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  // Toasts state
  const [toasts, setToasts] = useState([]);

  // Custom confirm state
  const [confirmState, setConfirmState] = useState(null);
  const toastIdRef = useRef(0);

  // Lifted Standalone Notes State
  const [standaloneNotes, setStandaloneNotes] = useState([]);
  const [standaloneNotesLoading, setStandaloneNotesLoading] = useState(false);
  const [availableNoteCategories, setAvailableNoteCategories] = useState([]);
  const [noteFocusRequest, setNoteFocusRequest] = useState(null);

  const dragSnapshotRef = useRef([]);
  const dragCurrentRef = useRef([]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 260, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Sync theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const locked = Boolean(selectedTask || isTaskModalOpen || isApprovalsOpen);
    document.body.classList.toggle('scroll-locked', locked);
    return () => document.body.classList.remove('scroll-locked');
  }, [selectedTask, isTaskModalOpen, isApprovalsOpen]);

  // Toast Helpers
  const addToast = (type, title, message) => {
    toastIdRef.current += 1;
    const id = `${Date.now()}-${toastIdRef.current}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Custom Confirm Promise Helper
  const askConfirm = (title, message) => {
    return new Promise((resolve) => {
      setConfirmState({ title, message, resolve });
    });
  };

  async function loadTasks(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const data = await api.getTasks(nextFilters);
      setTasks(data);
      if (selectedTask) {
        const fresh = data.find((task) => task.id === selectedTask.id);
        setSelectedTask(fresh || null);
      }
    } catch (err) {
      setError(err.message);
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    } finally {
      setLoading(false);
    }
  }

  async function loadStandaloneNotes(searchVal = '', includeLinked = false) {
    setStandaloneNotesLoading(true);
    try {
      const data = await api.getStandaloneNotes({ search: searchVal, includeLinked: includeLinked ? '1' : '' });
      setStandaloneNotes(data);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    } finally {
      setStandaloneNotesLoading(false);
    }
  }

  function openNotesAt(noteId = null, options = {}) {
    const numericNoteId = Number(noteId);
    if (Number.isFinite(numericNoteId) && numericNoteId > 0) {
      setNoteFocusRequest({
        noteId: numericNoteId,
        includeLinked: options.includeLinked !== false,
        nonce: Date.now(),
      });
    }
    setView('notes');
  }

  async function loadNoteCategories() {
    try {
      const data = await api.getNoteCategories();
      setAvailableNoteCategories(mergeNoteCategories(data));
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    }
  }

  async function loadActionRequests() {
    setActionRequestsLoading(true);
    try {
      const data = await api.getActionRequests({ status: 'pending' });
      setActionRequests(data);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    } finally {
      setActionRequestsLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
    loadStandaloneNotes();
    loadNoteCategories();
    loadActionRequests();
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    let refreshTimer;
    events.addEventListener('workspace.changed', () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        setWorkspaceRevision((current) => current + 1);
      }, 180);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      events.close();
    };
  }, []);

  useEffect(() => {
    if (!workspaceRevision) return;
    loadTasks();
    loadStandaloneNotes();
    loadNoteCategories();
    loadActionRequests();
  }, [workspaceRevision]);

  const stats = useMemo(() => {
    const total = tasks.length || 0;
    const done = tasks.filter((task) => task.status === 'done').length;
    const active = tasks.filter((task) => task.status !== 'done').length;
    const avg = total
      ? Math.round(tasks.reduce((sum, task) => sum + progressForStatus(task.status, task.progress), 0) / total)
      : 0;
    return { total, done, active, avg };
  }, [tasks]);

  const groupedTasks = useMemo(() => {
    return columns.reduce((acc, column) => {
      acc[column.status] = getOrderedColumnTasks(tasks, column.status);
      return acc;
    }, {});
  }, [tasks]);

  const activeDragTask = useMemo(
    () => tasks.find((task) => task.id === Number(activeDragId)),
    [activeDragId, tasks],
  );

  function openCreateTask(status = 'todo', initialValues = null) {
    setEditingTask(null);
    setCreateTaskDefaultStatus(status);
    setCreateTaskInitialValues(initialValues);
    setIsTaskModalOpen(true);
  }

  function openTask(task, initialSection = 'progress') {
    setTaskDrawerInitialSection(initialSection);
    setSelectedTask(task);
  }

  function openEditTask(task) {
    setEditingTask(task);
    setCreateTaskInitialValues(null);
    setIsTaskModalOpen(true);
  }

  function openCreateTaskFromLog(task, log) {
    if (!log.nextStep) {
      addToast('info', '鎻愮ず', '杩欐潯鏃ュ織娌℃湁涓嬩竴姝ヨ鍒掋€?);
      return;
    }
    const title = String(log.nextStep || '').trim().slice(0, 160);
    const description = [
      `鏉ユ簮浠诲姟锛?{task.title}`,
      `鏉ユ簮鏃ュ織鏃ユ湡锛?{log.logDate}`,
      '',
      '鍘熸棩蹇楀唴瀹癸細',
      log.content || '',
      '',
      '涓嬩竴姝ヨ鍒掞細',
      log.nextStep || '',
    ].join('\n');
    openCreateTask('todo', {
      title,
      description,
      priority: task.priority || 'medium',
      dueDate: '',
      progress: 0,
      status: 'todo',
      tags: Array.isArray(task.tags) ? task.tags.join(',') : '',
    });
    addToast('info', '宸茬敓鎴愪换鍔¤崏绋?, '璇风‘璁ゅ唴瀹瑰悗淇濆瓨銆?);
  }

  async function saveTask(payload) {
    try {
      const nextPayload = {
        ...payload,
        progress: progressForStatus(payload.status, payload.progress),
      };
      if (editingTask) {
        await api.updateTask(editingTask.id, nextPayload);
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      } else {
        await api.createTask(nextPayload);
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      }
      setIsTaskModalOpen(false);
      setEditingTask(null);
      setCreateTaskInitialValues(null);
      await loadTasks();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function deleteTask(task) {
    const ok = await askConfirm('纭鍒犻櫎浠诲姟', `纭畾瑕佸垹闄も€?{task.title}鈥濆悧锛熶换鍔′細杩涘叆鍥炴敹绔欙紝鍙湪鍥炴敹绔欐仮澶嶃€俙);
    if (!ok) return;
    try {
      await api.deleteTask(task.id);
      setSelectedTask(null);
      setTaskDrawerInitialSection('progress');
      addToast('success', '宸茬Щ鍏ュ洖鏀剁珯', '鍙湪鍥炴敹绔欐仮澶嶈繖椤逛换鍔°€?);
      await loadTasks();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  function handleDragStart(event) {
    dragSnapshotRef.current = tasks;
    dragCurrentRef.current = tasks;
    setActiveDragId(Number(event.active.id));
    setOverStatus(getDropStatus(tasks, event.active.id));
  }

  function handleDragOver(event) {
    const overId = event.over?.id;
    const current = dragCurrentRef.current.length ? dragCurrentRef.current : tasks;
    const nextTasks = reorderTasksForDrop(current, event.active.id, overId);

    setOverStatus(getDropStatus(nextTasks, overId));
    if (overId && hasOrderChanged(current, nextTasks)) {
      dragCurrentRef.current = nextTasks;
      setTasks(nextTasks);
    }
  }

  function handleDragCancel() {
    if (dragSnapshotRef.current.length) {
      setTasks(dragSnapshotRef.current);
    }
    setActiveDragId(null);
    setOverStatus(null);
    dragSnapshotRef.current = [];
    dragCurrentRef.current = [];
  }

  async function handleDragEnd(event) {
    const taskBefore = dragSnapshotRef.current.length ? dragSnapshotRef.current : tasks;
    const taskCurrent = dragCurrentRef.current.length ? dragCurrentRef.current : taskBefore;
    setActiveDragId(null);
    setOverStatus(null);
    dragSnapshotRef.current = [];
    dragCurrentRef.current = [];

    const nextTasks = event.over
      ? reorderTasksForDrop(taskCurrent, event.active.id, event.over.id)
      : taskCurrent;

    if (!event.over) {
      setTasks(taskBefore);
      return;
    }

    if (!hasOrderChanged(taskBefore, nextTasks)) {
      return;
    }

    setTasks(nextTasks);
    try {
      await api.reorderTasks(toOrderPayload(nextTasks));
      addToast('info', '鎻愮ず', '鎿嶄綔宸插畬鎴愩€?);
      await loadTasks();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
      setTasks(taskBefore);
      await loadTasks();
    }
  }

  async function updateProgress(task, progress) {
    try {
      await api.updateTask(task.id, { progress });
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await loadTasks();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function moveTaskStatus(task, status) {
    const before = tasks;
    const baseProgress = task.status === 'todo' && status === 'in_progress' ? 10 : (task.progress || 10);
    const nextProgress = progressForStatus(status, baseProgress);
    const nextTasks = normalizeTaskOrders(
      tasks.map((item) =>
        item.id === task.id
          ? { ...item, status, progress: nextProgress, sortOrder: getOrderedColumnTasks(tasks, status).length }
          : item,
      ),
    );

    setTasks(nextTasks);
    try {
      await api.updateTask(task.id, { status, progress: nextProgress });
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await loadTasks();
    } catch (err) {
      setTasks(before);
      addToast('error', '鍑洪敊浜?, err.message);
      await loadTasks();
    }
  }

  function applyFilters(next) {
    setFilters(next);
    loadTasks(next);
  }

  function openAiSource(source) {
    const noteTargetId = source?.noteId || (source?.entityType === 'note' ? source.entityId : null);
    if (noteTargetId) {
      openNotesAt(noteTargetId, { includeLinked: true });
      return;
    }
    if (source.taskId) {
      const task = tasks.find((item) => item.id === source.taskId);
      if (task) {
        const initialSection = source.entityType === 'log' || source.entityType === 'log_attachment'
          ? 'logs'
          : source.entityType === 'note' || source.entityType === 'note_attachment'
            ? 'notes'
            : source.entityType === 'task_attachment'
              ? 'attachments'
              : 'progress';
        openTask(task, initialSection);
      }
    }
    if ((source.entityType === 'note' || source.entityType === 'note_attachment') && !source.taskId) {
      openNotesAt();
    }
  }

  async function approveAction(action) {
    try {
      const updated = await api.approveActionRequest(action.id);
      if (updated.status === 'applied') {
        addToast('success', '瀹屾垚', updated.title || '鎿嶄綔宸插畬鎴愩€?);
      } else {
        addToast('error', '鍑洪敊浜?, updated.errorMessage || '鎿嶄綔澶辫触銆?);
      }
      await loadActionRequests();
      await loadTasks();
      await loadStandaloneNotes();
      await loadNoteCategories();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function rejectAction(action) {
    try {
      await api.rejectActionRequest(action.id);
      addToast('info', '宸叉嫆缁?, action.title || '璇ュ姩浣滆姹傚凡鎷掔粷銆?);
      await loadActionRequests();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">涓汉宸ヤ綔璁板綍</p>
          <h1>鍔╃悊浠诲姟鍙?/h1>
        </div>
        <div className="top-actions">
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? '鍒囨崲鍒版繁鑹叉ā寮? : '鍒囨崲鍒版祬鑹叉ā寮?}
            aria-label="鍒囨崲涓婚"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className={view === 'today' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('today')}
            title="浠婃棩宸ヤ綔鍙?
          >
            <Clock3 size={18} />
            <span>浠婃棩</span>
          </button>
          <button
            className={view === 'board' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('board')}
            title="浠诲姟鐪嬫澘"
          >
            <LayoutDashboard size={18} />
            <span>鐪嬫澘</span>
          </button>
          <button
            className={view === 'report' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('report')}
            title="鏃ユ姤鍛ㄦ姤"
          >
            <BarChart3 size={18} />
            <span>姹囨€?/span>
          </button>
          <button
            className={view === 'notes' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('notes')}
            title="鐙珛绗旇"
          >
            <FileText size={18} />
            <span>绗旇</span>
          </button>
          <button
            className={view === 'attachments' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('attachments')}
            title="闄勪欢涓績"
          >
            <Paperclip size={18} />
            <span>闄勪欢</span>
          </button>
          <button
            className={view === 'ai' ? 'icon-button ai-search-button active' : 'icon-button ai-search-button'}
            onClick={() => setView('ai')}
            title="AI"
          >
            <Search size={18} />
            <span>鏅鸿兘妫€绱?/span>
          </button>
          <button
            className={view === 'trash' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('trash')}
            title="鍥炴敹绔?
          >
            <Trash2 size={18} />
            <span>鍥炴敹绔?/span>
          </button>
          <button
            className={view === 'system' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('system')}
            title="绯荤粺涓庡浠?
          >
            <Save size={18} />
            <span>绯荤粺</span>
          </button>
          <button
            className={actionRequests.length ? 'icon-button approval-button has-pending' : 'icon-button approval-button'}
            onClick={() => setIsApprovalsOpen(true)}
            title="OpenClaw 瀹℃壒"
          >
            <ShieldCheck size={18} />
            <span>瀹℃壒</span>
            {actionRequests.length > 0 && <em>{actionRequests.length}</em>}
          </button>
          <button className="icon-button primary" onClick={() => openCreateTask('todo')} title="鏂板缓浠诲姟">
            <Plus size={18} />
            <span>鏂板缓</span>
          </button>
        </div>
      </header>

      <main className="workspace">

        {error && (
          <div className="notice">
            <span>{error}</span>
            <button className="ghost-button" onClick={() => loadTasks()}>
              <RefreshCw size={16} />
              閲嶈瘯
            </button>
          </div>
        )}

        {view === 'today' ? (
          <TodayWorkbenchView
            workspaceRevision={workspaceRevision}
            onCreateTask={() => openCreateTask('todo')}
            onOpenTask={openTask}
            onOpenNotes={openNotesAt}
            onOpenAi={() => setView('ai')}
            addToast={addToast}
          />
        ) : view === 'board' ? (
          <>
            <FilterBar filters={filters} onChange={applyFilters} loading={loading} onRefresh={() => loadTasks()} />
            <DndContext
              sensors={sensors}
              collisionDetection={boardCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              <section className="board" aria-label="浠诲姟鐪嬫澘">
                {columns.map((column) => (
                  <BoardColumn
                    key={column.status}
                    column={column}
                    tasks={groupedTasks[column.status] || []}
                    isActiveDrop={overStatus === column.status}
                    onOpenTask={openTask}
                    onQuickAdd={openCreateTask}
                  />
                ))}
              </section>
              <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(.2, .9, .25, 1.2)' }}>
                {activeDragTask ? (
                  <TaskCard task={activeDragTask} onOpen={() => {}} isOverlay />
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        ) : view === 'notes' ? (
          <StandaloneNotesView
            notes={standaloneNotes}
            loading={standaloneNotesLoading}
            loadNotes={loadStandaloneNotes}
            askConfirm={askConfirm}
            addToast={addToast}
            tasks={tasks}
            noteCategories={availableNoteCategories}
            onCategoriesChanged={loadNoteCategories}
            onOpenTask={openTask}
            focusRequest={noteFocusRequest}
          />
        ) : view === 'ai' ? (
          <AiWorkspaceView onOpenSource={openAiSource} />
        ) : view === 'attachments' ? (
          <AttachmentCenterView
            tasks={tasks}
            onOpenTask={openTask}
            onOpenNotes={openNotesAt}
            addToast={addToast}
            askConfirm={askConfirm}
          />
        ) : view === 'trash' ? (
          <RecycleBinView
            askConfirm={askConfirm}
            addToast={addToast}
            onChanged={async () => {
              await loadTasks();
              await loadStandaloneNotes();
              await loadNoteCategories();
            }}
          />
        ) : view === 'system' ? (
          <SystemView addToast={addToast} />
        ) : (
          <ReportView
            dates={reportDates}
            onDatesChange={setReportDates}
            addToast={addToast}
            onNoteSaved={async () => {
              await loadStandaloneNotes();
              await loadNoteCategories();
            }}
          />
        )}
      </main>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          initialSection={taskDrawerInitialSection}
          onClose={() => {
            setSelectedTask(null);
            setTaskDrawerInitialSection('progress');
          }}
          onEdit={() => openEditTask(selectedTask)}
          onDelete={() => deleteTask(selectedTask)}
          onProgress={updateProgress}
          onMove={moveTaskStatus}
          onChanged={loadTasks}
          onCreateTaskFromLog={openCreateTaskFromLog}
          askConfirm={askConfirm}
          addToast={addToast}
          noteCategories={availableNoteCategories}
          onCategoriesChanged={loadNoteCategories}
          workspaceRevision={workspaceRevision}
        />
      )}

      {isApprovalsOpen && (
        <ActionRequestsModal
          actions={actionRequests}
          loading={actionRequestsLoading}
          onClose={() => setIsApprovalsOpen(false)}
          onRefresh={loadActionRequests}
          onApprove={approveAction}
          onReject={rejectAction}
        />
      )}

      {isTaskModalOpen && (
        <TaskModal
          task={editingTask}
          defaultStatus={createTaskDefaultStatus}
          initialValues={createTaskInitialValues}
          onClose={() => {
            setIsTaskModalOpen(false);
            setEditingTask(null);
            setCreateTaskInitialValues(null);
          }}
          onSave={saveTask}
        />
      )}

      {/* Toast Notification Mount */}
      <ToastContainer toasts={toasts} onClose={removeToast} />

      {/* Custom Confirmation Dialog Modal */}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterBar({ filters, onChange, loading, onRefresh }) {
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  return (
    <div className="filters">
      <div className="filter-title">
        <ListFilter size={17} />
        <span>绛涢€?/span>
      </div>
      <label>
        <Flag size={16} />
        <select
          id="task-priority-filter"
          name="priority"
          value={draft.priority}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
        >
          <option value="">鍏ㄩ儴浼樺厛绾?/option>
          <option value="high">楂樹紭鍏堢骇</option>
          <option value="medium">涓紭鍏堢骇</option>
          <option value="low">浣庝紭鍏堢骇</option>
        </select>
      </label>
      <label>
        <Search size={16} />
        <input
          id="task-tag-filter"
          name="tag"
          value={draft.tag}
          onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          placeholder="鎼滅储鏍囩..."
        />
      </label>
      <button className="ghost-button" onClick={() => onChange(draft)}>
        <Search size={16} />
        搴旂敤
      </button>
      <button className="ghost-button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={16} />
        鍒锋柊
      </button>
    </div>
  );
}

function TodayWorkbenchView({
  workspaceRevision,
  onCreateTask,
  onOpenTask,
  onOpenNotes,
  onOpenAi,
  addToast,
}) {
  const [mode, setMode] = useState('today');
  const [dates, setDates] = useState({ from: today(), to: today() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadWorkbench(nextDates = dates) {
    setLoading(true);
    setError('');
    try {
      const result = await api.getWorkbench(nextDates);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkbench(dates);
  }, [dates.from, dates.to, workspaceRevision]);

  const allKnownTasks = useMemo(() => {
    const map = new Map();
    [
      ...(data?.activeTasks || []),
      ...(data?.todoTasks || []),
      ...(data?.inProgressTasks || []),
      ...(data?.dueTasks || []),
    ].forEach((task) => map.set(task.id, task));
    return map;
  }, [data]);

  const rangeLabel = dates.from === dates.to ? dates.from : `${dates.from} 鑷?${dates.to}`;

  function selectRange(nextMode) {
    setMode(nextMode);
    if (nextMode === 'today') {
      setDates({ from: today(), to: today() });
    }
    if (nextMode === 'week') {
      setDates({ from: weekStart(), to: today() });
    }
  }

  function updateCustomDate(field, value) {
    setMode('custom');
    setDates((current) => ({ ...current, [field]: value }));
  }

  function openFirstLogTarget() {
    const task =
      data?.inProgressTasks?.[0] ||
      data?.todoTasks?.[0] ||
      data?.activeTasks?.[0] ||
      null;
    if (!task) {
      addToast('info', '鎻愮ず', '褰撳墠娌℃湁鍙褰曟棩蹇楃殑鏈畬鎴愪换鍔°€?);
      return;
    }
    onOpenTask(task, 'logs');
  }

  function openAttachmentSource(item) {
    if (item.noteId) {
      onOpenNotes(item.noteId, { includeLinked: true });
      return;
    }
    if (item.taskId && allKnownTasks.has(item.taskId)) {
      onOpenTask(allKnownTasks.get(item.taskId), 'attachments');
      return;
    }
    onOpenNotes();
  }

  return (
    <section className="today-workbench">
      <div className="today-head">
        <div>
          <p className="eyebrow">浠婃棩宸ヤ綔鍙?/p>
          <h2>{rangeLabel}</h2>
          <span>浠诲姟銆佹棩蹇椼€佺瑪璁板拰闄勪欢鐨勫綋鍓嶅鐞嗚鍥?/span>
        </div>
        <div className="range-switch" role="group" aria-label="宸ヤ綔鍙版棩鏈熻寖鍥?>
          <button type="button" className={mode === 'today' ? 'active' : ''} onClick={() => selectRange('today')}>
            浠婂ぉ
          </button>
          <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => selectRange('week')}>
            鏈懆
          </button>
          <button type="button" className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
            鑷畾涔?          </button>
        </div>
      </div>

      <div className="workbench-toolbar">
        <label>
          <CalendarDays size={16} />
          <span>寮€濮?/span>
          <input type="date" value={dates.from} onChange={(event) => updateCustomDate('from', event.target.value)} />
        </label>
        <label>
          <CalendarDays size={16} />
          <span>缁撴潫</span>
          <input type="date" value={dates.to} onChange={(event) => updateCustomDate('to', event.target.value)} />
        </label>
        <button type="button" className="ghost-button" onClick={() => loadWorkbench()} disabled={loading}>
          <RefreshCw size={16} />
          鍒锋柊
        </button>
      </div>

      <div className="workbench-quick-actions" aria-label="蹇嵎鍏ュ彛">
        <button type="button" onClick={onCreateTask}>
          <Plus size={18} />
          <span>鏂板缓浠诲姟</span>
        </button>
        <button type="button" onClick={openFirstLogTarget}>
          <Clock3 size={18} />
          <span>鍐欐棩蹇?/span>
        </button>
        <button type="button" onClick={onOpenNotes}>
          <FileText size={18} />
          <span>鏂板缓绗旇</span>
        </button>
        <button type="button" onClick={onOpenAi}>
          <Sparkles size={18} />
          <span>鎵撳紑 AI</span>
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="workbench-metrics">
        <WorkbenchMetric label="鏈畬鎴愪换鍔? value={data?.metrics?.activeTasks || 0} />
        <WorkbenchMetric label="鑼冨洿鏃ュ織" value={data?.metrics?.logs || 0} />
        <WorkbenchMetric label="鎶曞叆鑰楁椂" value={`${data?.metrics?.totalHours || 0}h`} />
        <WorkbenchMetric label="鏂板闄勪欢" value={data?.metrics?.attachments || 0} />
      </div>

      {loading && !data ? (
        <div className="empty-column workbench-loading">姝ｅ湪鍔犺浇宸ヤ綔鍙?..</div>
      ) : (
        <>
          <div className="workbench-task-grid">
            <WorkbenchPanel title="寰呭鐞? count={data?.todoTasks?.length || 0}>
              {(data?.todoTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'progress')} />
              ))}
              {!data?.todoTasks?.length && <div className="empty-column">鏆傛棤浠诲姟</div>}
            </WorkbenchPanel>
            <WorkbenchPanel title="杩涜涓? count={data?.inProgressTasks?.length || 0}>
              {(data?.inProgressTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'logs')} />
              ))}
              {!data?.inProgressTasks?.length && <div className="empty-column">鏆傛棤浠诲姟</div>}
            </WorkbenchPanel>
            <WorkbenchPanel title="鍗冲皢鎴" count={data?.dueTasks?.length || 0}>
              {(data?.dueTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'progress')} dueFocus />
              ))}
              {!data?.dueTasks?.length && <div className="empty-column">鏆傛棤浠诲姟</div>}
            </WorkbenchPanel>
          </div>

          <div className="workbench-lower-grid">
            <WorkbenchPanel title="宸ヤ綔鏃ュ織" count={data?.logs?.length || 0}>
              {(data?.logs || []).map((log) => (
                <button
                  type="button"
                  className="workbench-record"
                  key={log.id}
                  onClick={() => {
                    const task = allKnownTasks.get(log.taskId);
                    if (task) onOpenTask(task, 'logs');
                  }}
                >
                  <strong>{log.taskTitle}</strong>
                  <span>{log.content}</span>
                  <em>{log.logDate} 路 {log.hours}h 路 {statusLabels[log.stage] || log.stage}</em>
                </button>
              ))}
              {!data?.logs?.length && <div className="empty-column">鏆傛棤宸ヤ綔鏃ュ織</div>}
            </WorkbenchPanel>

            <WorkbenchPanel title="鏈€杩戠瑪璁? count={data?.recentNotes?.length || 0}>
              {(data?.recentNotes || []).map((note) => (
                <button
                  type="button"
                  className="workbench-record"
                  key={note.id}
                  onClick={() => {
                    onOpenNotes(note.id, { includeLinked: true });
                  }}
                >
                  <strong>{note.title || '鏈懡鍚嶇瑪璁?}</strong>
                  <span>{note.content || '鏆傛棤姝ｆ枃'}</span>
                  <em>{note.category || '鏈垎绫?} 路 {formatDate(note.updatedAt)}</em>
                </button>
              ))}
              {!data?.recentNotes?.length && <div className="empty-column">鏆傛棤绗旇</div>}
            </WorkbenchPanel>

            <WorkbenchPanel title="闄勪欢璁板綍" count={data?.attachments?.length || 0}>
              {(data?.attachments || []).map((item) => (
                <div className="workbench-attachment" key={`${item.kind}-${item.attachment.id}`}>
                  <button type="button" onClick={() => openAttachmentSource(item)}>
                    <Paperclip size={16} />
                    <span>
                      <strong>{item.attachment.originalName}</strong>
                      <em>{item.sourceLabel} 路 {item.sourceTitle || '鏈懡鍚嶆潵婧?}</em>
                    </span>
                  </button>
                  <a href={item.attachment.downloadUrl} target="_blank" rel="noreferrer">
                    涓嬭浇
                  </a>
                </div>
              ))}
              {!data?.attachments?.length && <div className="empty-column">鏆傛棤闄勪欢</div>}
            </WorkbenchPanel>
          </div>
        </>
      )}
    </section>
  );
}

function WorkbenchMetric({ label, value }) {
  return (
    <div className="workbench-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkbenchPanel({ title, count, children }) {
  return (
    <section className="workbench-panel">
      <div className="workbench-panel-head">
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      <div className="workbench-panel-body">{children}</div>
    </section>
  );
}

function WorkbenchTaskItem({ task, onOpen, dueFocus = false }) {
  const progress = progressForStatus(task.status, task.progress);
  const overdue = task.dueDate && task.dueDate < today() && task.status !== 'done';

  return (
    <button type="button" className="workbench-task-item" onClick={onOpen}>
      <div className="workbench-task-main">
        <strong>{task.title}</strong>
        <span>{task.description || '鏆傛棤璇存槑'}</span>
      </div>
      <div className="workbench-task-meta">
        <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
        <span className={`status-chip ${task.status}`}>{statusLabels[task.status]}</span>
        <span className={overdue ? 'due overdue' : 'due'}>{dueFocus && overdue ? '閫炬湡 ' : ''}{formatDate(task.dueDate)}</span>
      </div>
      <div className="workbench-progress">
        <span>{progress}%</span>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    </button>
  );
}

function BoardColumn({ column, tasks, isActiveDrop, onOpenTask, onQuickAdd }) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.status,
    data: { type: 'column', status: column.status },
  });
  const Icon = column.icon;

  return (
    <div
      ref={setNodeRef}
      className={`board-column ${column.status} ${isActiveDrop || isOver ? 'is-over' : ''}`}
    >
      <div className="column-head">
        <div>
          <Icon size={18} />
          <h2>{column.title}</h2>
        </div>
        <div className="column-head-right">
          <span className="count">{tasks.length}</span>
          <button
            type="button"
            className="column-quick-add"
            onClick={() => onQuickAdd(column.status)}
            title={`鍦ㄢ€?{column.title}鈥濅腑鏂板缓浠诲姟`}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onOpen={() => onOpenTask(task)}
            />
          ))}
          {!tasks.length && (
            <div className="empty-column board-empty">
              鏆傛棤浠诲姟
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTaskCard({ task, onOpen }) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  });

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      onOpen={onOpen}
      dragAttributes={attributes}
      dragListeners={listeners}
      setActivatorNodeRef={setActivatorNodeRef}
      isDragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    />
  );
}

const TaskCard = forwardRef(function TaskCard(
  {
    task,
    onOpen,
    dragAttributes,
    dragListeners,
    setActivatorNodeRef,
    isDragging = false,
    isOverlay = false,
    style,
  },
  ref,
) {
  const setCombinedRef = (node) => {
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
    if (!isOverlay && setActivatorNodeRef) {
      setActivatorNodeRef(node);
    }
  };
  const dragProps = !isOverlay
    ? {
        ...(dragAttributes || {}),
        ...(dragListeners || {}),
      }
    : {};
  const dragKeyDown = !isOverlay ? dragListeners?.onKeyDown : null;

  return (
    <article
      ref={setCombinedRef}
      {...dragProps}
      className={`task-card ${task.priority}-priority ${isDragging ? 'is-dragging' : ''} ${isOverlay ? 'drag-overlay' : ''}`}
      style={style}
      onClick={isOverlay ? undefined : onOpen}
      tabIndex={isOverlay ? -1 : 0}
      onKeyDown={(event) => {
        dragKeyDown?.(event);
        if (!event.defaultPrevented && !isOverlay && event.key === 'Enter') onOpen();
      }}
    >
      <div className="task-card-top">
        <div className="task-card-badges">
          <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
        </div>
        <span className="due">{formatDate(task.dueDate)}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-desc">{task.description}</p>}
      <TaskProgress task={task} />
      {task.tags.length > 0 && (
        <div className="tag-list">
          {task.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
});

function TaskProgress({ task }) {
  if (task.status === 'todo') {
    return (
      <div className="progress-line progress-idle">
        <div>
          <span>鐘舵€?/span>
          <strong>鏈紑濮?/strong>
        </div>
      </div>
    );
  }

  return (
    <div className="progress-line">
      <div>
        <span>{task.status === 'done' ? '宸插畬鎴? : '杩涜涓?}</span>
        <strong>{task.status === 'done' ? 100 : task.progress}%</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${task.status === 'done' ? 100 : task.progress}%` }} />
      </div>
    </div>
  );
}

function StatusActions({ task, onMove }) {
  const actions = {
    todo: [
      { status: 'in_progress', label: '寮€濮?, icon: Clock3 },
    ],
    in_progress: [
      { status: 'done', label: '瀹屾垚', icon: CheckCircle2 },
      { status: 'todo', label: '閫€鍥?, icon: ChevronLeft },
    ],
    done: [
      { status: 'in_progress', label: '閲嶅紑', icon: RefreshCw },
    ],
  }[task.status] || [];

  if (!actions.length) return null;

  return (
    <div className="status-actions" aria-label="浠诲姟鐘舵€佹祦杞?>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.status}
            type="button"
            className={`flow-button to-${action.status}`}
            title={`绉诲姩鍒?${statusLabels[action.status]}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onMove(task, action.status);
            }}
          >
            <Icon size={13} />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TaskModal({ task, defaultStatus = 'todo', initialValues = null, onClose, onSave }) {
  const [form, setForm] = useState(() =>
    task
      ? {
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate || '',
          progress: task.progress,
          status: task.status,
          tags: task.tags.join(','),
        }
      : { ...emptyTaskForm, ...initialValues, status: initialValues?.status || defaultStatus },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const normalizedProgress = progressForStatus(form.status, form.progress);

  useEffect(() => {
    const nextProgress = progressForStatus(form.status, form.progress);
    if (Number(form.progress) !== nextProgress) {
      setForm((current) => ({ ...current, progress: nextProgress }));
    }
  }, [form.status]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        progress: Number(form.progress),
        tags: form.tags,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="task-modal" onSubmit={submit}>
        <div className="modal-head">
          <h2>{task ? '缂栬緫浠诲姟' : '鏂板缓浠诲姟'}</h2>
          <button type="button" className="round-button small" onClick={onClose} title="鍏抽棴">
            <X size={16} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label>
          鏍囬
          <input
            required
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="浠诲姟鏍囬..."
          />
        </label>
        <label>
          璇存槑
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="瀵逛换鍔＄殑鍏蜂綋鎻忚堪缁嗚妭..."
          />
        </label>
        <div className="form-grid">
          <label>
            浼樺厛绾?            <select
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            >
              <option value="high">{priorityLabels.high}</option>
              <option value="medium">{priorityLabels.medium}</option>
              <option value="low">{priorityLabels.low}</option>
            </select>
          </label>
          <label>
            鐘舵€?            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="todo">寰呭姙</option>
              <option value="in_progress">杩涜涓?/option>
              <option value="done">宸插畬鎴?/option>
            </select>
          </label>
          <label>
            鎴鏃ユ湡
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </label>
          <label>
            杩涘害
            {form.status === 'todo' ? (
              <div className="locked-progress">寰呭姙浠诲姟榛樿鏈紑濮?/div>
            ) : form.status === 'done' ? (
              <div className="locked-progress">宸插畬鎴愪换鍔￠粯璁?100%</div>
            ) : (
              <div className="modal-progress-field">
                <input
                  type="range"
                  min="0"
                  max="99"
                  value={normalizedProgress}
                  onChange={(event) => setForm({ ...form, progress: event.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={normalizedProgress}
                  onChange={(event) => setForm({ ...form, progress: event.target.value })}
                />
              </div>
            )}
          </label>
        </div>
        <label>
          鏍囩
          <input
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            placeholder="渚嬪锛氬悎鍚屻€佸鎴枫€佺揣鎬?
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            <ChevronLeft size={16} />
            鍙栨秷
          </button>
          <button type="submit" className="icon-button primary" disabled={saving}>
            <Save size={17} />
            淇濆瓨
          </button>
        </div>
      </form>
    </div>
  );
}

function TaskDrawer({
  task,
  initialSection = 'progress',
  onClose,
  onEdit,
  onDelete,
  onProgress,
  onMove,
  onChanged,
  onCreateTaskFromLog,
  askConfirm,
  addToast,
  noteCategories,
  onCategoriesChanged,
  workspaceRevision,
}) {
  const [logs, setLogs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [taskFiles, setTaskFiles] = useState([]);
  const [noteSearch, setNoteSearch] = useState('');
  const [logFilters, setLogFilters] = useState({ search: '', from: '', to: '', stage: '', minHours: '', maxHours: '' });
  const [editingLog, setEditingLog] = useState(null);
  const [progress, setProgress] = useState(task.progress);
  const [savingProgress, setSavingProgress] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [logComposerSeed, setLogComposerSeed] = useState(null);

  async function loadLogs(filters = logFilters) {
    try {
      const data = await api.getLogs(task.id, filters);
      setLogs(data);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    }
  }

  async function loadNotes(search = noteSearch) {
    try {
      const data = await api.getNotes(task.id, { search });
      setNotes(data);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    }
  }

  async function loadTaskFiles() {
    try {
      const data = await api.getTaskAttachments(task.id);
      setTaskFiles(data);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    }
  }

  useEffect(() => {
    setProgress(task.progress);
  }, [task.progress]);

  useEffect(() => {
    loadNotes('');
    loadTaskFiles();
    setNoteSearch('');
    setLogFilters({ search: '', from: '', to: '', stage: '', minHours: '', maxHours: '' });
    setEditingLog(null);
    setLogComposerSeed(null);
    setActiveSection(initialSection);
  }, [task.id, initialSection]);

  useEffect(() => {
    const delay = logFilters.search ? 260 : 0;
    const timer = window.setTimeout(() => {
      loadLogs(logFilters);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [task.id, logFilters.search, logFilters.from, logFilters.to, logFilters.stage, logFilters.minHours, logFilters.maxHours]);

  useEffect(() => {
    if (!workspaceRevision) return;
    loadLogs();
    loadNotes(noteSearch);
    loadTaskFiles();
  }, [workspaceRevision]);

  const logAttachments = useMemo(
    () => logs.flatMap((log) => log.attachments || []),
    [logs],
  );

  const logHours = useMemo(
    () => logs.reduce((total, log) => total + Number(log.hours || 0), 0),
    [logs],
  );

  async function saveProgress() {
    setSavingProgress(true);
    try {
      await onProgress(task, Number(progress));
    } finally {
      setSavingProgress(false);
    }
  }

  function setProgressValue(value) {
    setProgress(progressForStatus(task.status, value));
  }

  function createLogDraftFromNote(note) {
    const plainContent = String(note.content || extractPlainTextFromDoc(note.contentJson) || '').trim();
    const content = [
      `鏉ユ簮绗旇锛?{note.title || '鏈懡鍚嶇瑪璁?}`,
      note.category ? `鍒嗙被锛?{note.category}` : '',
      plainContent,
    ].filter(Boolean).join('\n\n');

    setLogComposerSeed({
      id: `${note.id}-${Date.now()}`,
      form: {
        ...createLogForm(task),
        content,
        hours: '0.25',
        progressSnapshot: String(progressForStatus(task.status, task.progress)),
        stage: task.status,
        nextStep: `缁х画璺熻繘銆?{note.title || '杩欐潯绗旇'}銆嶄腑璁板綍鐨勪簨椤广€俙,
      },
      detailsOpen: true,
      status: '宸叉牴鎹瑪璁扮敓鎴愭棩蹇楄崏绋匡紝璇风‘璁ゅ悗鍐嶈褰曘€?,
    });
    setActiveSection('logs');
  }

  async function createAiLogDraftFromNote(note) {
    const result = await api.generateLogDraftFromNote(task.id, note.id);
    const draft = result?.draft || {};
    setLogComposerSeed({
      id: `ai-${note.id}-${Date.now()}`,
      form: {
        ...createLogForm(task),
        content: draft.content || '',
        hours: draft.hours === undefined || draft.hours === null ? '0.25' : String(draft.hours),
        progressSnapshot: String(draft.progressSnapshot ?? progressForStatus(task.status, task.progress)),
        stage: statusLabels[draft.stage] ? draft.stage : task.status,
        nextStep: draft.nextStep || '',
      },
      detailsOpen: Boolean(draft.nextStep || draft.hours),
      status: 'AI 宸茬敓鎴愭棩蹇楄崏绋匡紝璇风‘璁ゅ悗鍐嶈褰曘€?,
    });
    setActiveSection('logs');
  }

  async function removeLog(log) {
    const ok = await askConfirm('纭鍒犻櫎鏃ュ織', '纭畾瑕佸垹闄よ繖鏉″伐浣滆褰曟棩蹇楀悧锛熸棩蹇椾細杩涘叆鍥炴敹绔欙紝鍙仮澶嶃€?);
    if (!ok) return;
    try {
      await api.deleteLog(log.id);
      addToast('success', '宸茬Щ鍏ュ洖鏀剁珯', '鍙湪鍥炴敹绔欐仮澶嶈繖鏉℃棩蹇椼€?);
      await loadLogs();
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className={`priority ${task.priority}`} style={{ marginBottom: '8px' }}>
              {priorityLabels[task.priority]}浼樺厛绾?            </span>
            <h2>{task.title}</h2>
          </div>
          <button className="round-button small" onClick={onClose} title="鍏抽棴">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-meta">
          <span>{statusLabels[task.status]}</span>
          <span>鎴锛歿formatDate(task.dueDate)}</span>
          <span className="note-meta">绗旇锛歿notes.length} 鏉?/span>
        </div>
        {task.description && <p className="drawer-desc">{task.description}</p>}
        <div className="drawer-actions">
          <button className="ghost-button" onClick={onEdit}>
            <Edit3 size={15} />
            缂栬緫浠诲姟
          </button>
          <button className="danger-button" onClick={onDelete}>
            <Trash2 size={15} />
            鍒犻櫎浠诲姟
          </button>
        </div>

        <div className="drawer-tabs" role="tablist" aria-label="浠诲姟璇︽儏">
          <button
            type="button"
            className={activeSection === 'progress' ? 'active' : ''}
            onClick={() => setActiveSection('progress')}
          >
            杩涘害
          </button>
          <button
            type="button"
            className={activeSection === 'logs' ? 'active' : ''}
            onClick={() => setActiveSection('logs')}
          >
            鏃ュ織 {logs.length}
          </button>
          <button
            type="button"
            className={activeSection === 'notes' ? 'active' : ''}
            onClick={() => setActiveSection('notes')}
          >
            绗旇 {notes.length}
          </button>
          <button
            type="button"
            className={activeSection === 'attachments' ? 'active' : ''}
            onClick={() => setActiveSection('attachments')}
          >
            闄勪欢 {taskFiles.length}
          </button>
          <button
            type="button"
            className={activeSection === 'ai' ? 'active' : ''}
            onClick={() => setActiveSection('ai')}
          >
            鏅鸿兘
          </button>
        </div>

        {activeSection === 'progress' && (
          <section className="drawer-section">
            <div className="drawer-status-flow">
              <span>鐘舵€佹祦杞?/span>
              <StatusActions task={task} onMove={onMove} />
            </div>
            <section className={`progress-editor ${task.status !== 'in_progress' ? 'locked' : ''}`}>
              {task.status === 'todo' ? (
                <>
                  <div>
                    <span>浠诲姟杩涘害</span>
                    <strong>鏈紑濮?/strong>
                  </div>
                  <p className="progress-hint">寰呭姙浠诲姟鍏堜粠涓婃柟鍒囨崲鍒拌繘琛屼腑锛屽啀寮€濮嬭褰曠櫨鍒嗘瘮</p>
                </>
              ) : task.status === 'done' ? (
                <>
                  <div>
                    <span>浠诲姟杩涘害</span>
                    <strong>100%</strong>
                  </div>
                  <div className="progress-track large">
                    <span style={{ width: '100%' }} />
                  </div>
                  <p className="progress-hint">宸插畬鎴愪换鍔″浐瀹氫负 100%锛岄渶瑕佺户缁鐞嗗彲鍏堥噸寮€</p>
                </>
              ) : (
                <>
                  <div>
                    <span>璋冩暣浠诲姟杩涘害</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className="progress-control-row">
                    <button type="button" onClick={() => setProgressValue(Number(progress) - 5)}>-5</button>
                    <input
                      type="range"
                      min="0"
                      max="99"
                      value={progress}
                      onChange={(event) => setProgressValue(event.target.value)}
                    />
                    <button type="button" onClick={() => setProgressValue(Number(progress) + 5)}>+5</button>
                  </div>
                  <div className="progress-presets">
                    {[25, 50, 75, 90].map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={Number(progress) === value ? 'active' : ''}
                        onClick={() => setProgressValue(value)}
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                  <button className="ghost-button" onClick={saveProgress} disabled={savingProgress} style={{ marginTop: '4px' }}>
                    <Save size={15} />
                    淇濆瓨杩涘害
                  </button>
                </>
              )}
            </section>
          </section>
        )}

        {activeSection === 'logs' && (
          <section className="drawer-section">
            <LogComposer task={task} seed={logComposerSeed} onCreated={async () => {
              addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
              setLogComposerSeed(null);
              await loadLogs();
              await onChanged();
            }} addToast={addToast} />

            <section className="logs">
              <div className="logs-head">
                <div>
                  <h3>鍘嗗彶宸ヤ綔鏃ュ織</h3>
                  <span>{logs.length} 鏉¤褰暵?{logHours.toFixed(2).replace(/\.00$/, '')} 灏忔椂</span>
                </div>
                <button
                  type="button"
                  className="round-button small"
                  title="閲嶇疆鏃ュ織绛涢€?
                  onClick={() => setLogFilters({ search: '', from: '', to: '', stage: '', minHours: '', maxHours: '' })}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <div className="log-filter-toolbar">
                <label className="log-search-field">
                  <Search size={15} />
                  <input
                    value={logFilters.search}
                    onChange={(event) => setLogFilters({ ...logFilters, search: event.target.value })}
                    placeholder="鎼滅储鏃ュ織鍐呭銆佷笅涓€姝ヨ鍒?.."
                  />
                </label>
                <label>
                  <span>寮€</span>
                  <input
                    type="date"
                    value={logFilters.from}
                    onChange={(event) => setLogFilters({ ...logFilters, from: event.target.value })}
                  />
                </label>
                <label>
                  <span>缁撴潫</span>
                  <input
                    type="date"
                    value={logFilters.to}
                    onChange={(event) => setLogFilters({ ...logFilters, to: event.target.value })}
                  />
                </label>
                <label>
                  <span>闃舵</span>
                  <select
                    value={logFilters.stage}
                    onChange={(event) => setLogFilters({ ...logFilters, stage: event.target.value })}
                  >
                    <option value="">鍏ㄩ儴闃舵</option>
                    {columnStatuses.map((status) => (
                      <option value={status} key={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>鏈€灏戣€楁椂</span>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={logFilters.minHours}
                    onChange={(event) => setLogFilters({ ...logFilters, minHours: event.target.value })}
                    placeholder="0"
                  />
                </label>
                <label>
                  <span>鏈€澶氳€楁椂</span>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={logFilters.maxHours}
                    onChange={(event) => setLogFilters({ ...logFilters, maxHours: event.target.value })}
                    placeholder="8"
                  />
                </label>
              </div>
              <div className="timeline">
                {logs.map((log) => (
                  <div className="timeline-item" key={log.id}>
                    <div className="timeline-node" />
                    <article className="timeline-content">
                      <div className="timeline-head">
                        <div className="timeline-title-row">
                          <span className={`stage-pill ${log.stage}`}>{statusLabels[log.stage] || '闃舵璁板綍'}</span>
                          <span className="date">{log.logDate}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="hours">{log.hours}h</span>
                          <button
                            className="round-button small"
                            type="button"
                            onClick={() => setEditingLog(log)}
                            title="缂栬緫鏃ュ織"
                            style={{ width: '24px', height: '24px', minHeight: '24px' }}
                          >
                            <Edit3 size={12} />
                          </button>
                          <button className="round-button small" onClick={() => removeLog(log)} title="鍒犻櫎鏃ュ織" style={{ width: '24px', height: '24px', minHeight: '24px' }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="timeline-body">{log.content}</div>
                      <div className="timeline-foot">
                        <span>褰撴椂杩涘害 {log.progressSnapshot}%</span>
                        {log.nextStep && <span className="next">涓嬩竴姝ワ細{log.nextStep}</span>}
                        {log.nextStep && onCreateTaskFromLog && (
                          <button
                            type="button"
                            className="ghost-button tiny log-next-task-button"
                            onClick={() => onCreateTaskFromLog(task, log)}
                            title="鎶婁笅涓€姝ヨ鍒掕浆涓轰换鍔¤崏绋?
                          >
                            <Plus size={12} />
                            杞负浠诲姟
                          </button>
                        )}
                      </div>
                      <LogAttachmentSummary attachments={log.attachments} />
                    </article>
                  </div>
                ))}
              </div>
              {!logs.length && <div className="empty-column">娌℃湁鍖归厤鐨勫伐浣滄棩蹇?/div>}
            </section>
          </section>
        )}

        {activeSection === 'notes' && (
          <NotesSection
            task={task}
            notes={notes}
            search={noteSearch}
            attachments={logAttachments}
            askConfirm={askConfirm}
            addToast={addToast}
            noteCategories={noteCategories}
            onCategoriesChanged={onCategoriesChanged}
            onSearchChange={async (value) => {
              setNoteSearch(value);
              await loadNotes(value);
            }}
            onChanged={() => loadNotes(noteSearch)}
            onCreateLogFromNote={createLogDraftFromNote}
            onCreateAiLogFromNote={createAiLogDraftFromNote}
          />
        )}
        {activeSection === 'attachments' && (
          <TaskAttachmentsSection
            task={task}
            attachments={taskFiles}
            askConfirm={askConfirm}
            addToast={addToast}
            onChanged={loadTaskFiles}
          />
        )}
        {activeSection === 'ai' && <TaskAiPanel taskId={task.id} addToast={addToast} />}
      </aside>
      {editingLog && (
        <LogEditDrawer
          task={task}
          log={editingLog}
          askConfirm={askConfirm}
          addToast={addToast}
          onClose={() => setEditingLog(null)}
          onChanged={async () => {
            await loadLogs();
            await onChanged();
          }}
        />
      )}
    </>
  );
}

const actionTypeLabels = {
  create_task: '鍒涘缓浠诲姟',
  update_task: '鏇存柊浠诲姟',
  create_log: '鏂板鏃ュ織',
  update_log: '缂栬緫鏃ュ織',
  create_note: '鏂板绗旇',
  update_note: '缂栬緫绗旇',
};

function tagsToText(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean).join('锛?);
  return String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).join('锛?);
}

function ActionPayloadSummary({ action }) {
  const payload = action.payload || {};
  const rows = [];

  if (action.actionType === 'create_task') {
    rows.push(
      ['浠诲姟鏍囬', payload.title],
      ['浼樺厛绾?, priorityLabels[payload.priority] || payload.priority || '涓?],
      ['鐘舵€?, statusLabels[payload.status] || '寰呭姙'],
      ['鎴鏃ユ湡', formatDate(payload.dueDate)],
      ['鏍囩', tagsToText(payload.tags)],
      ['鏉ユ簮浠诲姟', payload.sourceTaskId ? `浠诲姟 #${payload.sourceTaskId}` : '褰撳墠 AI 寤鸿'],
      ['鏉ユ簮璇存槑', payload.sourceReason],
      ['浠诲姟璇存槑', payload.description],
    );
  } else {
    rows.push(
      ['鍔ㄤ綔绫诲瀷', actionTypeLabels[action.actionType] || action.actionType],
      ['鐩爣绫诲瀷', action.targetType || payload.targetType],
      ['鐩爣 ID', action.targetId || payload.taskId || payload.logId || payload.noteId],
      ['鏉ユ簮璇存槑', payload.sourceReason],
    );
  }

  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  if (!visibleRows.length) return null;

  return (
    <dl className="approval-summary">
      {visibleRows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionRequestsModal({ actions, loading, onClose, onRefresh, onApprove, onReject }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="modal-backdrop">
      <section className="approval-modal" role="dialog" aria-modal="true" aria-label="OpenClaw 瀹℃壒">
        <div className="modal-head">
          <div>
            <h2>OpenClaw 瀹℃壒</h2>
            <p>AI 鎴栧閮ㄦ櫤鑳戒綋鎻愬嚭鐨勫啓鍏ュ姩浣滀細鍏堝仠鍦ㄨ繖閲岋紝鎵瑰噯鍚庢墠浼氫慨鏀逛换鍔″彴</p>
          </div>
          <button type="button" className="round-button small" onClick={onClose} title="鍏抽棴">
            <X size={16} />
          </button>
        </div>
        <div className="approval-toolbar">
          <span>{loading ? '姝ｅ湪鍒锋柊...' : `寰呭鎵?${actions.length} 鏉}</span>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            <RefreshCw size={14} />
            鍒锋柊
          </button>
        </div>
        <div className="approval-list">
          {!actions.length && !loading && (
            <div className="approval-empty">
              <ShieldCheck size={22} />
              <strong>鏆傛棤寰呭鎵?/strong>
              <span>OpenClaw 鎻愪氦鏂扮殑鍐欏叆璇锋眰鍚庝細鍑虹幇鍦ㄨ繖閲屻€?/span>
            </div>
          )}
          {actions.map((action) => {
            const expanded = expandedId === action.id;
            return (
              <article className="approval-card" key={action.id}>
                <div className="approval-card-head">
                  <div>
                    <span className="approval-type">{actionTypeLabels[action.actionType] || action.actionType}</span>
                    <h3>{action.title || ('Action #' + action.id)}</h3>
                    <p>鍒涘缓鏃堕棿锛歿action.createdAt} 路 璇锋眰鏉ユ簮锛歿action.requestedBy || action.source}</p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button tiny"
                    onClick={() => setExpandedId(expanded ? null : action.id)}
                    title={expanded ? '鏀惰捣璇︽儏' : '鏌ョ湅璇︽儏'}
                  >
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {expanded ? '鏀惰捣 JSON' : '鏌ョ湅 JSON'}
                  </button>
                </div>
                <ActionPayloadSummary action={action} />
                {expanded && (
                  <pre className="approval-json">{JSON.stringify(action.payload || {}, null, 2)}</pre>
                )}
                {action.errorMessage && <div className="form-error">{action.errorMessage}</div>}
                <div className="approval-actions">
                  <button type="button" className="ghost-button" onClick={() => onReject(action)}>
                    <X size={15} />
                    鎷掔粷
                  </button>
                  <button type="button" className="icon-button primary" onClick={() => onApprove(action)}>
                    <Check size={15} />
                    鎵瑰噯鎵ц
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function createAiMessage(role, content = '', extra = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    sources: [],
    streaming: false,
    ...extra,
  };
}

function toAiHistory(messages) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.content?.trim())
    .map((message) => ({ role: message.role, content: message.content }))
    .slice(-12);
}

function updateAiMessage(messages, messageId, updater) {
  return messages.map((message) => (
    message.id === messageId ? updater(message) : message
  ));
}

function normalizeClientActionUrl(value, { allowRelative = false } = {}) {
  const text = String(value || '')
    .trim()
    .replace(/[)\]}>,锛屻€傦紱;?!锛侊紵]+$/g, '');
  if (!text) return null;
  if (allowRelative && text.startsWith('/')) return text;
  try {
    const base = typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin;
    const url = new URL(text, base);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (!allowRelative && text.startsWith('/')) return null;
    return url.protocol === 'mailto:' ? text : url.toString();
  } catch {
    return null;
  }
}

function extractLinksFromText(value) {
  const text = String(value || '');
  const seen = new Set();
  const links = [];
  const pattern = /\b(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi;
  for (const match of text.matchAll(pattern)) {
    const url = normalizeClientActionUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label: url.replace(/^mailto:/i, '') });
  }
  return links;
}

function mergeActionLinks(...groups) {
  const seen = new Set();
  return groups
    .flat()
    .map((item) => {
      const url = normalizeClientActionUrl(typeof item === 'string' ? item : item?.url, { allowRelative: Boolean(item?.allowRelative) });
      if (!url || seen.has(url)) return null;
      seen.add(url);
      return {
        url,
        label: String(item?.label || url.replace(/^mailto:/i, '')).trim(),
      };
    })
    .filter(Boolean);
}

async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function CopyButton({ value, label = '澶嶅埗', copiedLabel = '宸插鍒?, className = 'ghost-button tiny', title }) {
  const [copied, setCopied] = useState(false);

  async function copy(event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyTextToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={className} onClick={copy} title={title || label} disabled={!String(value || '').trim()}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? copiedLabel : label}
    </button>
  );
}

const aiHtmlAllowedTags = [
  'p',
  'br',
  'span',
  'div',
  'section',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'a',
  'header',
  'progress',
];

const aiHtmlAllowedAttributes = ['class', 'colspan', 'rowspan', 'href', 'title', 'target', 'rel', 'value', 'max'];

function escapePlainHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineTextToAiHtml(value) {
  return escapePlainHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\b(?:https?:\/\/|mailto:)[^\s<]+/gi, (url) => {
      const href = normalizeClientActionUrl(url);
      return href ? `<a href="${escapePlainHtml(href)}">${escapePlainHtml(url)}</a>` : escapePlainHtml(url);
    });
}

function plainTextToAiHtml(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const lines = text.split('\n');
  const blocks = [];
  let listType = '';
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${inlineTextToAiHtml(item)}</li>`).join('')}</${listType}>`);
    listType = '';
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(4, Math.max(3, heading[1].length + 2));
      blocks.push(`<h${level}>${inlineTextToAiHtml(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      continue;
    }
    flushList();
    blocks.push(`<p>${inlineTextToAiHtml(line)}</p>`);
  }
  flushList();
  return blocks.join('');
}

function toSafeAiHtml(value) {
  const text = String(value || '');
  const rawHtml = /<\/?[a-z][\s\S]*>/i.test(text) ? text : plainTextToAiHtml(text);
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: aiHtmlAllowedTags,
    ALLOWED_ATTR: aiHtmlAllowedAttributes,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });
  if (typeof document === 'undefined' || !safeHtml) return safeHtml;
  const template = document.createElement('template');
  template.innerHTML = safeHtml;
  template.content.querySelectorAll('a').forEach((link) => {
    const href = normalizeClientActionUrl(link.getAttribute('href'));
    if (!href) {
      link.replaceWith(document.createTextNode(link.textContent || ''));
      return;
    }
    link.setAttribute('href', href);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  template.content.querySelectorAll('progress').forEach((progress) => {
    const fallbackValue = progress.textContent?.match(/\d+/)?.[0] || '0';
    const rawValue = Number(progress.getAttribute('value') || fallbackValue);
    const rawMax = Number(progress.getAttribute('max') || 100);
    const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 100;
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(max, rawValue)) : 0;
    progress.setAttribute('max', String(max));
    progress.setAttribute('value', String(value));
  });
  return template.innerHTML;
}

function aiContentToPlainText(value) {
  const safeHtml = toSafeAiHtml(value);
  if (typeof document === 'undefined') return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const template = document.createElement('template');
  template.innerHTML = safeHtml;
  template.content.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    const label = link.textContent?.trim();
    if (href && label && href !== label) {
      link.textContent = `${label} (${href})`;
    }
  });
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function extractLinksFromAiContent(value) {
  if (typeof document === 'undefined') return extractLinksFromText(value);
  const safeHtml = toSafeAiHtml(value);
  const template = document.createElement('template');
  template.innerHTML = safeHtml;
  const anchorLinks = Array.from(template.content.querySelectorAll('a[href]')).map((link) => ({
    url: link.getAttribute('href'),
    label: link.textContent?.trim() || link.getAttribute('href'),
  }));
  return mergeActionLinks(anchorLinks, extractLinksFromText(value));
}

function displayActionUrl(url) {
  const value = String(url || '');
  if (value.startsWith('mailto:')) return value.replace(/^mailto:/i, '');
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return value;
  }
}

function AiActionStrip({ links = [], files = [] }) {
  const normalizedLinks = mergeActionLinks(links);
  const normalizedFiles = files.filter((file) => file?.downloadUrl || file?.previewUrl);
  if (!normalizedLinks.length && !normalizedFiles.length) return null;

  return (
    <div className="ai-action-strip">
      {normalizedLinks.map((link) => (
        <div className="ai-action-card" key={link.url}>
          <Link2 size={16} />
          <span>
            <strong>{link.label || '閾炬帴'}</strong>
            <small>{displayActionUrl(link.url)}</small>
          </span>
          <div className="ai-action-card-actions">
            <a className="ghost-button tiny" href={link.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              鎵撳紑
            </a>
            <CopyButton value={link.url} label="澶嶅埗閾炬帴" />
          </div>
        </div>
      ))}
      {normalizedFiles.map((file) => {
        return (
          <div className="ai-action-card" key={`${file.kind || 'file'}-${file.id || file.downloadUrl}`}>
            {file.isImage ? <ImageIcon size={16} /> : <Paperclip size={16} />}
            <span>
              <strong>{file.fileName || '闄勪欢'}</strong>
              <small>{file.mimeType || '鏂囦欢'}</small>
            </span>
            <div className="ai-action-card-actions">
              {file.previewUrl && (
                <a className="ghost-button tiny" href={file.previewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  棰勮
                </a>
              )}
              {file.downloadUrl && (
                <a className="ghost-button tiny" href={file.downloadUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download size={14} />
                  涓嬭浇
                </a>
              )}
              <CopyButton value={file.fileName || file.downloadUrl} label="澶嶅埗鏂囦欢鍚? />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiMessageTools({ message }) {
  if (message.role !== 'assistant' || !message.content || message.streaming) return null;
  const links = extractLinksFromAiContent(message.content);
  const plainText = aiContentToPlainText(message.content);
  return (
    <div className="ai-message-tools">
      <CopyButton value={plainText} label="澶嶅埗鍏ㄦ枃" className="ghost-button small" />
      <AiActionStrip links={links} />
    </div>
  );
}

function sourceFileAction(source) {
  if (!source?.downloadUrl && !source?.previewUrl) return null;
  return {
    id: source.entityId,
    kind: source.entityType,
    fileName: source.fileName,
    mimeType: source.mimeType,
    isImage: source.isImage,
    previewUrl: source.previewUrl,
    downloadUrl: source.downloadUrl,
  };
}

function sourceTypeLabel(source) {
  const type = source?.entityType;
  if (type === 'task') return '浠诲姟';
  if (type === 'log') return '鏃ュ織';
  if (type === 'note') return source.taskId ? '浠诲姟绗旇' : '鐙珛绗旇';
  if (type === 'task_attachment') return '浠诲姟闄勪欢';
  if (type === 'log_attachment') return '鏃ュ織闄勪欢';
  if (type === 'note_attachment') return source.taskId ? '浠诲姟绗旇闄勪欢' : '鐙珛绗旇闄勪欢';
  return '璧勬枡';
}

function AiSourceList({ sources = [], onOpenSource }) {
  if (!sources.length) return <p className="ai-empty">鏆傛棤鍙紩鐢ㄧ殑璧勬枡銆?/p>;

  return (
    <div className="ai-source-list">
      {sources.map((source) => {
        const file = sourceFileAction(source);
        const links = mergeActionLinks(source.links || [], extractLinksFromText(source.excerpt));
        return (
          <article className="ai-source-card" key={source.id}>
            <button
              type="button"
              className="ai-source-main"
              onClick={() => onOpenSource?.(source)}
              disabled={!onOpenSource}
            >
              {file ? <Paperclip size={15} /> : <FileText size={15} />}
              <span>
                <strong>{source.label}</strong>
                <em>
                  <b>{sourceTypeLabel(source)}</b>
                  {source.reason ? <b>{source.reason}</b> : null}
                </em>
                <small>{source.excerpt}</small>
              </span>
            </button>
            <div className="ai-source-actions">
              {onOpenSource && (
                <button type="button" className="ghost-button tiny" onClick={() => onOpenSource(source)}>
                  <ExternalLink size={14} />
                  鎵撳紑鏉ユ簮
                </button>
              )}
              <CopyButton value={source.copyText || source.excerpt || source.label} label="澶嶅埗鏉ユ簮" />
            </div>
            <AiActionStrip links={links} files={file ? [file] : []} />
          </article>
        );
      })}
    </div>
  );
}

const aiLocalCachePrefix = 'assistant-task-board:ai-conversations:';
const aiText = {
  newChat: '鏂板璇?,
  history: '鍘嗗彶瀵硅瘽',
  closeHistory: '鍏抽棴鍘嗗彶',
  noContent: '鏆傛棤鍐呭',
  emptyHistory: '杩樻病鏈夊巻鍙插璇濄€?,
  rename: '閲嶅懡鍚?,
  delete: '鍒犻櫎',
  startTitle: '寮€濮嬩竴娆℃櫤鑳芥绱?,
  startHint: '鍙互杩炵画鎻愰棶锛孉I 浼氭牴鎹换鍔°€佹棩蹇椼€佺瑪璁板拰闄勪欢璧勬枡鍥炵瓟銆?,
  you: '浣?,
  thinking: '姝ｅ湪鏁寸悊鍥炵瓟',
  sources: '鏌ョ湅鏉ユ簮',
  loadingHistory: '姝ｅ湪杞藉叆鍘嗗彶...',
  renamePrompt: '閲嶅懡鍚嶅璇?,
  deletePrefix: '鍒犻櫎瀵硅瘽鈥?,
  deleteSuffix: '鈥濓紵',
  failed: '杩欐鍥炵瓟娌℃湁鎴愬姛锛岃绋嶅悗閲嶈瘯銆?,
  taskAi: '浠诲姟 AI',
  workspaceAi: 'AI 宸ヤ綔鍖?,
  taskTitle: '浠诲姟鏅鸿兘闂瓟',
  workspaceTitle: '鏅鸿兘妫€绱?,
  askTask: '闂棶杩欎釜浠诲姟鐨勮繘灞曘€佺己鍙ｆ垨涓嬩竴姝?..',
  askWorkspace: '璇㈤棶浠诲姟銆佹棩蹇椼€佺瑪璁版垨闄勪欢閲岀殑鍐呭...',
  generating: '鐢熸垚涓?,
  send: '鍙戦€?,
};

const taskAiQuickPrompts = [
  {
    id: 'task-summary',
    label: '鎬荤粨杩涘睍',
    prompt: '璇峰熀浜庡綋鍓嶄换鍔＄殑鐘舵€併€佽鏄庛€佸叧閿棩蹇椼€佷换鍔＄瑪璁板拰闄勪欢璧勬枡锛岀敓鎴愪竴涓彲宓屽叆椤甸潰鐨勫畨鍏?HTML 浠诲姟杩涘睍鎬荤粨銆傝鍖呭惈锛氬綋鍓嶇姸鎬併€佸凡瀹屾垚鍐呭銆佸叧閿棩蹇椼€侀檮浠?璧勬枡銆侀闄╂垨闃诲銆佷笅涓€姝ヨ鍒掋€傚彲浠ヤ娇鐢ㄦ暟鎹潰鏉裤€佸垪琛ㄦ垨琛ㄦ牸锛屼絾涓嶈缂栭€犺祫鏂欍€?,
  },
  {
    id: 'next-steps',
    label: '鎻愬彇涓嬩竴姝?,
    prompt: '璇峰彧鏍规嵁褰撳墠浠诲姟宸叉湁璧勬枡锛屾彁鍙栨帴涓嬫潵鏈€搴旇澶勭悊鐨勪笅涓€姝ヨ鍒掋€傝鐢ㄥ畨鍏?HTML 杈撳嚭锛屾寜浼樺厛绾у垪鍑哄緟鍔炰簨椤广€佸師鍥犮€佸缓璁埅姝㈡椂闂存垨闇€瑕佺‘璁ょ殑淇℃伅锛涙棤娉曠‘璁ょ殑鍐呭璇锋爣娉ㄢ€滃緟纭鈥濄€?,
  },
  {
    id: 'task-review',
    label: '浠诲姟澶嶇洏',
    prompt: '璇峰褰撳墠浠诲姟鍋氫竴浠界畝娲佸鐩橈紝浣跨敤瀹夊叏 HTML 杈撳嚭銆傝鍖呭惈鐩爣銆佽繃绋嬫憳瑕併€佸凡瀹屾垚鎴愭灉銆侀仐鐣欓棶棰樸€佸彲澶嶇敤缁忛獙鍜屽悗缁缓璁紱涓嶈鏂板浜嬪疄銆?,
  },
];

function compactAiText(value, maxLength = 80) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function aiCacheKey(scope, taskId) {
  return aiLocalCachePrefix + scope + ':' + (taskId || 'workspace');
}

function readAiLocalCache(scope, taskId) {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(aiCacheKey(scope, taskId)) || 'null');
  } catch {
    return null;
  }
}

function writeAiLocalCache(scope, taskId, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(aiCacheKey(scope, taskId), JSON.stringify(value));
  } catch {
    // Local cache is only a safety net; ignore quota or privacy-mode failures.
  }
}

function normalizeAiConversation(conversation, fallback = {}) {
  if (!conversation) return null;
  const id = conversation.id === undefined || conversation.id === null
    ? fallback.id
    : String(conversation.id);
  return {
    id,
    scope: conversation.scope || fallback.scope || 'workspace',
    taskId: conversation.taskId ?? fallback.taskId ?? null,
    title: conversation.title || fallback.title || aiText.newChat,
    preview: conversation.preview || fallback.preview || '',
    localKey: conversation.localKey || fallback.localKey || '',
    localOnly: Boolean(conversation.localOnly || fallback.localOnly),
    createdAt: conversation.createdAt || fallback.createdAt || new Date().toISOString(),
    updatedAt: conversation.updatedAt || fallback.updatedAt || new Date().toISOString(),
  };
}

function normalizeAiConversations(conversations = []) {
  return conversations.map((item) => normalizeAiConversation(item)).filter(Boolean);
}

function serverMessageToAiMessage(message) {
  return createAiMessage(message.role, message.content || '', {
    id: 'db-' + message.id,
    sources: message.sources || [],
    createdAt: message.createdAt,
  });
}

function upsertAiConversation(list, conversation) {
  const normalized = normalizeAiConversation(conversation);
  if (!normalized?.id) return list;
  const without = list.filter((item) => item.id !== normalized.id && item.localKey !== normalized.localKey);
  return [normalized, ...without].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function AiChatThread({ messages, onOpenSource }) {
  if (!messages.length) {
    return (
      <div className="ai-empty-state">
        <strong>{aiText.startTitle}</strong>
        <span>{aiText.startHint}</span>
      </div>
    );
  }

  return (
    <div className="ai-chat-thread" aria-live="polite">
      {messages.map((message) => (
        <article className={'ai-chat-message ' + message.role} key={message.id}>
          <span className="ai-chat-role">{message.role === 'user' ? '鎴? : 'AI'}</span>
          <div className="ai-chat-bubble">
            {message.role === 'assistant' ? (
              message.content ? (
                <div
                  className="ai-html-content"
                  dangerouslySetInnerHTML={{ __html: toSafeAiHtml(message.content) }}
                />
              ) : (
                <p>{message.streaming ? aiText.thinking : ''}</p>
              )
            ) : (
              <p>{message.content}</p>
            )}
            {message.streaming && <span className="streaming-cursor" aria-hidden="true" />}
          </div>
          <AiMessageTools message={message} />
          {message.role === 'assistant' && Boolean(message.sources?.length) && (
            <details className="ai-chat-sources">
              <summary>{aiText.sources}</summary>
              <AiSourceList sources={message.sources} onOpenSource={onOpenSource} />
            </details>
          )}
        </article>
      ))}
    </div>
  );
}

function AiConversationSidebar({
  conversations,
  activeConversationId,
  loading,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onClose,
}) {
  return (
    <aside className="ai-conversation-sidebar">
      <div className="ai-sidebar-head">
        <strong>{aiText.history}</strong>
        <button type="button" className="icon-button tiny" onClick={onClose} title={aiText.closeHistory}>
          <X size={15} />
        </button>
      </div>
      <button type="button" className="ai-new-chat-button" onClick={onNew} disabled={loading}>
        <Plus size={15} />
        {aiText.newChat}
      </button>
      <div className="ai-conversation-list">
        {conversations.length ? conversations.map((conversation) => (
          <article
            key={conversation.id}
            className={conversation.id === activeConversationId ? 'ai-conversation-item active' : 'ai-conversation-item'}
          >
            <button type="button" className="ai-conversation-main" onClick={() => onSelect(conversation.id)}>
              <span>
                <strong>{conversation.title || aiText.newChat}</strong>
                <small>{conversation.preview || aiText.noContent}</small>
              </span>
            </button>
            <div className="ai-conversation-actions">
              <button type="button" onClick={() => onRename(conversation)} title={aiText.rename}>
                <Edit3 size={13} />
              </button>
              <button type="button" onClick={() => onDelete(conversation)} title={aiText.delete}>
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        )) : (
          <p className="ai-sidebar-empty">{aiText.emptyHistory}</p>
        )}
      </div>
    </aside>
  );
}

function AiConversationShell({ scope = 'workspace', taskId = null, compact = false, onOpenSource }) {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);

  const activeMessages = activeConversationId ? messagesByConversation[activeConversationId] || [] : [];
  const activeConversation = conversations.find((item) => item.id === activeConversationId);

  useEffect(() => {
    let ignore = false;
    const cached = readAiLocalCache(scope, taskId);
    setCacheReady(false);
    if (cached) {
      setConversations(normalizeAiConversations(cached.conversations || []));
      setMessagesByConversation(cached.messagesByConversation || {});
      setActiveConversationId(cached.activeConversationId || null);
    } else {
      setConversations([]);
      setMessagesByConversation({});
      setActiveConversationId(null);
    }

    async function loadConversations() {
      try {
        const result = await api.getAiConversations({ scope, taskId: scope === 'task' ? taskId : undefined });
        if (ignore) return;
        const nextConversations = normalizeAiConversations(result.conversations || []);
        setConversations(nextConversations);
        setActiveConversationId((current) => (
          current && nextConversations.some((item) => item.id === current)
            ? current
            : nextConversations[0]?.id || null
        ));
        setError('');
      } catch (err) {
        if (!cached && !ignore) setError(err.message);
      } finally {
        if (!ignore) setCacheReady(true);
      }
    }

    loadConversations();
    return () => {
      ignore = true;
    };
  }, [scope, taskId]);

  useEffect(() => {
    if (!cacheReady) return;
    writeAiLocalCache(scope, taskId, {
      conversations,
      activeConversationId,
      messagesByConversation,
    });
  }, [scope, taskId, conversations, activeConversationId, messagesByConversation, cacheReady]);

  useEffect(() => {
    if (!activeConversationId || activeConversationId.startsWith('local-')) return;
    let ignore = false;
    setLoadingMessages(true);
    api.getAiConversationMessages(activeConversationId)
      .then((result) => {
        if (ignore) return;
        const messages = (result.messages || []).map(serverMessageToAiMessage);
        setMessagesByConversation((current) => ({
          ...current,
          [activeConversationId]: messages,
        }));
        if (result.conversation) {
          setConversations((current) => upsertAiConversation(current, result.conversation));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!ignore) setLoadingMessages(false);
      });
    return () => {
      ignore = true;
    };
  }, [activeConversationId]);

  function updateConversationMessages(conversationId, updater) {
    const key = String(conversationId);
    setMessagesByConversation((current) => {
      const previous = current[key] || [];
      const next = typeof updater === 'function' ? updater(previous) : updater;
      return { ...current, [key]: next };
    });
  }

  function replaceConversationId(oldId, conversation) {
    const normalized = normalizeAiConversation(conversation);
    if (!normalized?.id) return String(oldId);
    const oldKey = String(oldId);
    const nextId = normalized.id;
    setConversations((current) => upsertAiConversation(current.filter((item) => item.id !== oldKey), normalized));
    setMessagesByConversation((current) => {
      if (oldKey === nextId) return current;
      const moved = current[oldKey] || [];
      const { [oldKey]: _removed, ...rest } = current;
      return { ...rest, [nextId]: moved };
    });
    setActiveConversationId((current) => (current === oldKey ? nextId : current));
    return nextId;
  }

  function startNewConversation() {
    setActiveConversationId(null);
    setQuestion('');
    setError('');
    setSidebarOpen(false);
  }

  function selectConversation(id) {
    setActiveConversationId(id);
    setQuestion('');
    setError('');
    setSidebarOpen(false);
  }

  async function renameConversation(conversation) {
    const title = window.prompt(aiText.renamePrompt, conversation.title || aiText.newChat);
    if (!title?.trim()) return;
    if (conversation.localOnly || conversation.id.startsWith('local-')) {
      setConversations((current) => current.map((item) => (
        item.id === conversation.id ? { ...item, title: title.trim() } : item
      )));
      return;
    }
    try {
      const result = await api.updateAiConversation(conversation.id, { title: title.trim() });
      setConversations((current) => upsertAiConversation(current, result.conversation));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(aiText.deletePrefix + (conversation.title || aiText.newChat) + aiText.deleteSuffix)) return;
    try {
      if (!conversation.localOnly && !conversation.id.startsWith('local-')) {
        await api.deleteAiConversation(conversation.id);
      }
      setConversations((current) => {
        const next = current.filter((item) => item.id !== conversation.id);
        setActiveConversationId((currentId) => (
          currentId === conversation.id ? next[0]?.id || null : currentId
        ));
        return next;
      });
      setMessagesByConversation((current) => {
        const { [conversation.id]: _removed, ...rest } = current;
        return rest;
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendQuestion(rawText) {
    const text = String(rawText || '').trim();
    if (!text || loading) return;

    let conversationId = activeConversationId;
    let localKey = activeConversation?.localKey || '';
    if (!conversationId) {
      conversationId = 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      localKey = conversationId;
      const localConversation = normalizeAiConversation({
        id: conversationId,
        localKey,
        scope,
        taskId,
        title: compactAiText(text, 48) || aiText.newChat,
        preview: text,
        localOnly: true,
      });
      setConversations((current) => upsertAiConversation(current, localConversation));
      setActiveConversationId(conversationId);
    }

    const previousMessages = messagesByConversation[conversationId] || [];
    const assistantMessage = createAiMessage('assistant', '', { streaming: true });
    updateConversationMessages(conversationId, [
      ...previousMessages,
      createAiMessage('user', text),
      assistantMessage,
    ]);
    setQuestion('');
    setLoading(true);
    setError('');

    let targetConversationId = conversationId;
    try {
      await api.streamAskWorkspace(text, {
        scope,
        taskId: scope === 'task' ? taskId : undefined,
        conversationId: targetConversationId.startsWith('local-') ? undefined : targetConversationId,
        localKey,
        messages: toAiHistory(previousMessages),
      }, {
        onConversation: (conversation) => {
          if (!conversation) return;
          targetConversationId = replaceConversationId(targetConversationId, conversation);
        },
        onSources: (nextSources) => {
          updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
            ...message,
            sources: nextSources || [],
          })));
        },
        onDelta: (delta) => {
          updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
            ...message,
            content: String(message.content || '') + delta,
          })));
        },
        onDone: (payload) => {
          if (payload?.conversation) {
            setConversations((current) => upsertAiConversation(current, payload.conversation));
          }
          updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
            ...message,
            streaming: false,
          })));
        },
      });
    } catch (err) {
      setError(err.message);
      updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
        ...message,
        content: message.content || aiText.failed,
        streaming: false,
      })));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    await sendQuestion(question);
  }

  return (
    <section className={'ai-shell ' + (compact ? 'compact ' : '') + (sidebarOpen ? 'history-open' : '')} aria-label={aiText.workspaceTitle}>
      {sidebarOpen && <button type="button" className="ai-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label={aiText.closeHistory} />}
      <AiConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        loading={loading}
        onNew={startNewConversation}
        onSelect={selectConversation}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onClose={() => setSidebarOpen(false)}
      />
      <section className="ai-chat-workspace">
        <header className="ai-chat-header">
          <button type="button" className="icon-button ai-history-toggle" onClick={() => setSidebarOpen(true)} title={aiText.history}>
            <ChevronLeft size={16} />
            <span>{aiText.history}</span>
          </button>
          <div>
            <p className="eyebrow">{compact ? aiText.taskAi : aiText.workspaceAi}</p>
            <h2>{activeConversation?.title || (compact ? aiText.taskTitle : aiText.workspaceTitle)}</h2>
          </div>
          <button type="button" className="ghost-button small" onClick={startNewConversation} disabled={loading}>
            <Plus size={14} />
            {aiText.newChat}
          </button>
        </header>
        <AiChatThread messages={activeMessages} onOpenSource={onOpenSource} />
        {loadingMessages && <p className="ai-loading-line">{aiText.loadingHistory}</p>}
        {error && <div className="form-error">{error}</div>}
        {compact && (
          <div className="ai-quick-actions" aria-label="浠诲姟 AI 蹇嵎鍔ㄤ綔">
            {taskAiQuickPrompts.map((item) => (
              <button
                type="button"
                key={item.id}
                className="ghost-button"
                disabled={loading}
                onClick={() => sendQuestion(item.prompt)}
              >
                <Sparkles size={13} />
                {item.label}
              </button>
            ))}
          </div>
        )}
        <form className="ai-composer" onSubmit={submit}>
          <textarea
            name={compact ? 'taskAiQuestion' : 'aiWorkspaceQuestion'}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={compact ? aiText.askTask : aiText.askWorkspace}
            rows="1"
          />
          <button type="submit" className="icon-button primary" disabled={loading || !question.trim()}>
            <Search size={16} />
            {loading ? aiText.generating : aiText.send}
          </button>
        </form>
      </section>
    </section>
  );
}

function AiWorkspaceView({ onOpenSource }) {
  return <AiConversationShell scope="workspace" onOpenSource={onOpenSource} />;
}

function TaskAiSummaryPanel({ taskId, addToast }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadSummary() {
    setLoading(true);
    setError('');
    try {
      const result = await api.getTaskAiSummary(taskId);
      setSummary(result);
      addToast?.('success', '瀹屾垚', 'AI 宸茬敓鎴愪换鍔¤繘灞曟€荤粨銆?);
    } catch (err) {
      setError(err.message);
      addToast?.('error', '鍑洪敊浜?, err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="task-ai-summary-panel">
      <div className="task-ai-suggestions-head">
        <div>
          <span>AI 澶嶇洏</span>
          <strong>浠诲姟杩涘睍鎬荤粨</strong>
        </div>
        <button type="button" className="ghost-button" onClick={loadSummary} disabled={loading}>
          <Sparkles size={14} />
          {loading ? '鐢熸垚涓?..' : summary ? '閲嶆柊鐢熸垚' : '鐢熸垚鎬荤粨'}
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      {summary?.html ? (
        <div className="task-ai-summary-result">
          <div
            className="ai-html-content"
            dangerouslySetInnerHTML={{ __html: toSafeAiHtml(summary.html) }}
          />
        </div>
      ) : (
        <p className="task-ai-summary-empty">姹囨€诲綋鍓嶄换鍔＄殑鐘舵€併€佹棩蹇椼€佺瑪璁板拰闄勪欢锛岀敓鎴愪竴寮犱究浜庡洖椤剧殑杩涘睍鍗＄墖銆?/p>
      )}
    </section>
  );
}

function TaskAiSuggestionPanel({ taskId, addToast }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestedIds, setRequestedIds] = useState(new Set());

  async function loadSuggestions() {
    setLoading(true);
    setError('');
    try {
      const result = await api.getTaskAiSuggestions(taskId, { limit: 5 });
      setSuggestions(result.suggestions || []);
      if (!result.suggestions?.length) {
        setError('AI 娌℃湁鎵惧埌閫傚悎鏂板缓鐨勫悗缁换鍔°€?);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createApproval(suggestion) {
    try {
      await api.createAiTaskSuggestionAction({
        ...suggestion,
        sourceTaskId: taskId,
        sourceReason: '鏍规嵁褰撳墠浠诲姟鐨勭姸鎬併€佹棩蹇椼€佺瑪璁板拰闄勪欢璧勬枡鐢熸垚鐨勫悗缁换鍔″缓璁?,
      });
      setRequestedIds((current) => new Set([...current, suggestion.id]));
      addToast?.('success', '宸插姞鍏ュ鎵?, '璇峰湪椤堕儴鈥滃鎵光€濋噷纭鍚庢墽琛屻€?);
    } catch (err) {
      addToast?.('error', '鍑洪敊浜?, err.message);
      setError(err.message);
    }
  }

  return (
    <section className="task-ai-suggestions">
      <div className="task-ai-suggestions-head">
        <div>
          <span>AI 寤鸿</span>
          <strong>鍚庣画浠诲姟</strong>
        </div>
        <button type="button" className="ghost-button" onClick={loadSuggestions} disabled={loading}>
          <Sparkles size={14} />
          {loading ? '鐢熸垚涓?..' : '鐢熸垚寤鸿'}
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      {suggestions.length > 0 && (
        <div className="task-ai-suggestion-list">
          {suggestions.map((suggestion) => {
            const requested = requestedIds.has(suggestion.id);
            return (
              <article className="task-ai-suggestion-card" key={suggestion.id}>
                <div>
                  <strong>{suggestion.title}</strong>
                  {suggestion.description && <p>{suggestion.description}</p>}
                  <span>{priorityLabels[suggestion.priority] || '涓?}浼樺厛绾?路 {suggestion.dueDate || '鏈缃埅姝?}</span>
                  {suggestion.tags?.length > 0 && <em>{suggestion.tags.join('锛?)}</em>}
                </div>
                <button
                  type="button"
                  className={requested ? 'ghost-button' : 'icon-button primary'}
                  disabled={requested}
                  onClick={() => createApproval(suggestion)}
                >
                  <ShieldCheck size={14} />
                  {requested ? '宸插姞鍏ュ鎵? : '鍔犲叆瀹℃壒'}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskAiPanel({ taskId, addToast }) {
  return (
    <section className="drawer-section ai-task-panel">
      <TaskAiSummaryPanel taskId={taskId} addToast={addToast} />
      <TaskAiSuggestionPanel taskId={taskId} addToast={addToast} />
      <AiConversationShell scope="task" taskId={taskId} compact />
    </section>
  );
}

function LogAttachmentSummary({ attachments = [] }) {
  if (!attachments.length) return null;

  return (
    <div className="timeline-attachment-summary">
      <span className="timeline-attachment-label">
        <Paperclip size={13} />
        {attachments.length} 涓檮浠?     </span>
      <div className="timeline-attachment-links">
        {attachments.map((attachment) => (
          <a key={attachment.id} href={attachment.downloadUrl} title={attachment.originalName}>
            {attachment.isImage ? <ImageIcon size={13} /> : <FileText size={13} />}
            <span>{attachment.originalName}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function AttachmentTextStatus({ attachment, kind, addToast, onChanged }) {
  const [running, setRunning] = useState(false);
  const label = attachmentTextStatusLabel(attachment);
  const isFailed = attachment.textStatus === 'failed';
  const isBusy = attachment.textStatus === 'pending' || attachment.textStatus === 'processing';

  async function reextract(event) {
    event.stopPropagation();
    setRunning(true);
    try {
      const result = await api.reextractAttachment(kind, attachment.id);
      if (result.status === 'completed') {
        addToast?.('success', '瀹屾垚', '闄勪欢璇嗗埆宸插畬鎴愩€?);
      } else {
        addToast?.('error', '鍑洪敊浜?, result.textError || '娌℃湁鎻愬彇鍒板彲鐢ㄦ枃鏈€?);
      }
      await onChanged?.();
    } catch (err) {
      addToast?.('error', '鍑洪敊浜?, err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={`attachment-text-status ${isFailed ? 'failed' : isBusy ? 'busy' : ''}`}>
      <span>{label}</span>
      {canReextractAttachment(attachment) && kind && (
        <button type="button" className="ghost-button tiny" onClick={reextract} disabled={running}>
          <RefreshCw size={12} />
          {running ? '璇嗗埆涓? : '閲嶈瘯'}
        </button>
      )}
    </div>
  );
}

function AttachmentPanel({ log, askConfirm, addToast, onChanged }) {
  return (
    <div className="attachment-panel">
      <div className="attachment-head">
        <div>
          <Paperclip size={14} />
          <span>闃舵闄勪欢</span>
        </div>
        <span>{log.attachments?.length || 0} 涓枃浠?/span>
      </div>
      {log.attachments?.length > 0 && (
        <div className="attachment-list">
          {log.attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              kind="log"
              askConfirm={askConfirm}
              addToast={addToast}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      <AttachmentUpload
        logId={log.id}
        addToast={addToast}
        onUploaded={onChanged}
        compact
      />
    </div>
  );
}

function AttachmentItem({ attachment, kind, askConfirm, addToast, onChanged }) {
  const [note, setNote] = useState(attachment.note || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote(attachment.note || '');
  }, [attachment.id, attachment.note]);

  async function saveNote() {
    setSaving(true);
    try {
      await api.updateAttachment(attachment.id, { note });
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAttachment() {
    const ok = await askConfirm('纭鍒犻櫎闄勪欢', `纭畾瑕佸垹闄も€?{attachment.originalName}鈥濆悧锛熼檮浠朵細杩涘叆鍥炴敹绔欙紝鍙仮澶嶃€俙);
    if (!ok) return;
    try {
      await api.deleteAttachment(attachment.id);
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <article className={attachment.isImage ? 'attachment-item image' : 'attachment-item'}>
      {attachment.isImage ? (
        <a href={attachment.previewUrl} target="_blank" rel="noreferrer" className="attachment-preview">
          <img src={attachment.previewUrl} alt={attachment.originalName} />
        </a>
      ) : (
        <div className="attachment-file-icon">
          <FileText size={20} />
        </div>
      )}
      <div className="attachment-info">
        <div className="attachment-name" title={attachment.originalName}>
          {attachment.originalName}
        </div>
        <div className="attachment-meta">
          <span>{formatFileSize(attachment.fileSize)}</span>
          <span>{attachment.mimeType}</span>
        </div>
        <AttachmentTextStatus
          attachment={attachment}
          kind={kind}
          addToast={addToast}
          onChanged={onChanged}
        />
        <div className="attachment-note-row">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="闄勪欢澶囨敞"
          />
          <button type="button" className="ghost-button tiny" onClick={saveNote} disabled={saving}>
            <Save size={12} />
          </button>
        </div>
      </div>
      <div className="attachment-actions">
        <a className="round-button small" href={attachment.downloadUrl} title="涓嬭浇鏂囦欢">
          <Download size={13} />
        </a>
        <button className="round-button small" type="button" onClick={removeAttachment} title="鍒犻櫎闄勪欢">
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function AttachmentUpload({ logId, addToast, onUploaded, compact = false }) {
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!files.length) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }

    setUploading(true);
    try {
      await api.uploadAttachments(logId, files, note);
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      setFiles([]);
      setNote('');
      formElement.reset();
      await onUploaded();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className={compact ? 'attachment-upload compact' : 'attachment-upload'} onSubmit={uploadFiles}>
      <label className="file-picker">
        <Upload size={15} />
        <span>{files.length ? `宸查€夋嫨 ${files.length} 涓枃浠禶 : '涓婁紶/閲嶆柊涓婁紶鏂囦欢'}</span>
        <input
          type="file"
          multiple
          accept={attachmentAccept}
          onChange={(event) => setFiles(Array.from(event.target.files || []))}
        />
      </label>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="鏈涓婁紶澶囨敞锛屽彲绋嶅悗鍗曠嫭淇敼"
      />
      <button className="ghost-button" disabled={uploading || !files.length}>
        <Upload size={14} />
        淇濆瓨闄勪欢
      </button>
    </form>
  );
}

function mergeNoteCategories(...groups) {
  const seen = new Set();
  const categories = [];

  groups.flat().forEach((item) => {
    const name = String(item?.name ?? item ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    categories.push(name);
  });

  return categories;
}

function DraggableNoteCard({ note, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    data: { type: 'note', note },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-category={note.category}
      className={`sidebar-note-card ${isDragging ? 'is-dragging' : ''}`}
      onClick={onEdit}
      {...attributes}
      {...listeners}
    >
      <div className="sidebar-note-card-head">
        <span className="note-category">{note.category}</span>
        <span className="note-date">{note.updatedAt ? note.updatedAt.slice(5, 10) : ''}</span>
      </div>
      <h4>{note.title}</h4>
      <p>{note.content}</p>
    </article>
  );
}

function SortableNoteItem({ note, askConfirm, addToast, onEdit, onChanged, onOpenTask, onDetach, onCreateLog, onCreateAiLog, isFocusTarget }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    data: { type: 'note', note },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <NoteItem
      ref={setNodeRef}
      style={style}
      note={note}
      askConfirm={askConfirm}
      addToast={addToast}
      onEdit={onEdit}
      onChanged={onChanged}
      onOpenTask={onOpenTask}
      onDetach={onDetach}
      onCreateLog={onCreateLog}
      onCreateAiLog={onCreateAiLog}
      dragAttributes={attributes}
      dragListeners={listeners}
      isDragging={isDragging}
      isFocusTarget={isFocusTarget}
    />
  );
}

function DroppableTaskItem({ task }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'task-target-' + task.id,
    data: { type: 'task-target', task },
  });

  return (
    <div
      ref={setNodeRef}
      className={`droppable-task-item ${isOver ? 'is-over' : ''} ${task.priority}-priority`}
    >
      <div className="task-item-title" title={task.title}>{task.title}</div>
      <div className="task-item-meta">
        <span className={`status-dot ${task.status}`}></span>
        <span>{statusLabels[task.status]}</span>
        <span>路</span>
        <span className="priority-label">{priorityLabels[task.priority]}</span>
      </div>
    </div>
  );
}

function StandaloneNotesView({
  notes,
  loading,
  loadNotes,
  askConfirm,
  addToast,
  tasks,
  noteCategories,
  onCategoriesChanged,
  onOpenTask,
  focusRequest,
}) {
  const [search, setSearch] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const [includeLinked, setIncludeLinked] = useState(false);
  const [pendingFocusNoteId, setPendingFocusNoteId] = useState(null);
  const [highlightNoteId, setHighlightNoteId] = useState(null);
  const noteInputRef = useRef(null);
  const focusClearTimerRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } })
  );

  const activeDragNote = useMemo(
    () => notes.find((note) => note.id === activeDragId),
    [activeDragId, notes],
  );

  useEffect(() => {
    return () => {
      if (focusClearTimerRef.current) {
        window.clearTimeout(focusClearTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusRequest?.noteId) return;
    const targetId = Number(focusRequest.noteId);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    const nextIncludeLinked = focusRequest.includeLinked !== false;

    setSearch('');
    setIncludeLinked(nextIncludeLinked);
    setPendingFocusNoteId(targetId);
    setHighlightNoteId(targetId);
    if (focusClearTimerRef.current) {
      window.clearTimeout(focusClearTimerRef.current);
    }
    focusClearTimerRef.current = window.setTimeout(() => {
      setHighlightNoteId(null);
    }, 3600);
    void loadNotes('', nextIncludeLinked);
  }, [focusRequest?.nonce]);

  useEffect(() => {
    if (!pendingFocusNoteId) return;
    const targetId = Number(pendingFocusNoteId);
    if (!notes.some((note) => Number(note.id) === targetId)) return;

    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-note-id="${targetId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingFocusNoteId(null);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [pendingFocusNoteId, notes]);

  function focusCreateNote() {
    setEditingNote(null);
    window.setTimeout(() => noteInputRef.current?.focus(), 0);
  }

  function handleDragStart(event) {
    setActiveDragId(Number(event.active.id));
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  async function handleDragEnd(event) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    if (String(over.id).startsWith('task-target-')) {
      const taskId = Number(over.id.replace('task-target-', ''));
      try {
        await api.updateNote(active.id, { taskId });
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
        await loadNotes(search, includeLinked);
      } catch (err) {
        addToast('error', '鍑洪敊浜?, err.message);
      }
      return;
    }

    if (active.id !== over.id) {
      const oldIndex = notes.findIndex((n) => n.id === Number(active.id));
      const newIndex = notes.findIndex((n) => n.id === Number(over.id));

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(notes, oldIndex, newIndex);
        const payload = reordered.map((note, index) => ({
          id: note.id,
          sortOrder: index,
        }));
        try {
          await api.reorderNotes(payload);
          addToast('info', '鎻愮ず', '鎿嶄綔宸插畬鎴愩€?);
          await loadNotes(search, includeLinked);
        } catch (err) {
          addToast('error', '鍑洪敊浜?, err.message);
          await loadNotes(search, includeLinked);
        }
      }
    }
  }

  async function switchNoteScope(nextIncludeLinked) {
    setIncludeLinked(nextIncludeLinked);
    await loadNotes(search, nextIncludeLinked);
  }

  function openLinkedTask(note) {
    const task = tasks.find((item) => item.id === note.taskId);
    if (!task) {
      addToast('info', '鎻愮ず', '鍏宠仈浠诲姟褰撳墠涓嶅湪浠诲姟鍒楄〃涓€?);
      return;
    }
    onOpenTask?.(task, 'notes');
  }

  async function detachNote(note) {
    const ok = await askConfirm('鍙栨秷浠诲姟鍏宠仈', `纭畾瑕佸皢鈥?{note.title || '鏈懡鍚嶇瑪璁?}鈥濅粠浠诲姟涓Щ鍑猴紝鍙樹负鐙珛绗旇鍚楋紵`);
    if (!ok) return;
    try {
      await api.updateNote(note.id, { taskId: null });
      addToast('success', '瀹屾垚', '绗旇宸插彇娑堝叧鑱斻€?);
      await loadNotes(search, includeLinked);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <section className="standalone-notes-view">
        <div className="notes-page-head">
          <div>
            <p className="eyebrow">鐙珛璁板綍</p>
            <h2>绗旇</h2>
          </div>
          <button type="button" className="icon-button primary" onClick={focusCreateNote}>
            <Plus size={16} />
            鍗曠嫭鍒涘缓绗旇
          </button>
        </div>

        <div className="notes-page-layout">
          <div className="notes-compose-panel">
            <NoteForm
              note={editingNote}
              inputRef={noteInputRef}
              addToast={addToast}
              noteCategories={noteCategories}
              onCancel={() => setEditingNote(null)}
              onSaved={async () => {
                setEditingNote(null);
                await loadNotes(search, includeLinked);
                await onCategoriesChanged?.();
              }}
            />
          </div>

          <div className="notes-list-panel">
            <div className="section-title-row">
              <h3>{includeLinked ? '鍏ㄩ儴绗旇' : '鍏ㄩ儴鐙珛绗旇'}</h3>
              <span>{notes.length} </span>
            </div>
            <div className="note-scope-tabs" role="group" aria-label="绗旇鑼冨洿">
              <button
                type="button"
                className={!includeLinked ? 'active' : ''}
                onClick={() => switchNoteScope(false)}
              >
                鐙珛绗旇
              </button>
              <button
                type="button"
                className={includeLinked ? 'active' : ''}
                onClick={() => switchNoteScope(true)}
              >
                鍏ㄩ儴绗旇
              </button>
            </div>
            <div className="note-search-row">
              <label>
                <Search size={15} />
                <input
                  value={search}
                  onChange={async (event) => {
                    const value = event.target.value;
                    setSearch(value);
                    await loadNotes(value, includeLinked);
                  }}
                  placeholder="鎼滅储鏍囬銆佸唴瀹广€佸垎绫绘垨鍏宠仈浠诲姟..."
                />
              </label>
            </div>
            <SortableContext items={notes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              <div className="note-list">
                {notes.map((note) => (
                  <SortableNoteItem
                    key={note.id}
                    note={note}
                    askConfirm={askConfirm}
                    addToast={addToast}
                    onEdit={() => {
                      setEditingNote(note);
                      window.setTimeout(() => noteInputRef.current?.focus(), 0);
                    }}
                    onChanged={() => loadNotes(search, includeLinked)}
                    onOpenTask={note.taskId ? () => openLinkedTask(note) : null}
                    onDetach={note.taskId ? () => detachNote(note) : null}
                    isFocusTarget={Number(note.id) === Number(highlightNoteId)}
                  />
                ))}
                {!notes.length && (
                  <div className="empty-column standalone-note-empty">
                    {loading ? '姝ｅ湪鍔犺浇绗旇...' : '鏆傛棤鐙珛绗旇'}
                  </div>
                )}
              </div>
            </SortableContext>
          </div>

          <div className="notebook-task-sidebar">
            <h3>
              <ClipboardList size={16} />
              <span>鎷栧姩鑷充换鍔″叧鑱?/span>
            </h3>
            <p className="hint">鎶婂乏渚х瑪璁版嫋鎷藉埌涓嬫柟浠诲姟涓婏紝鍗冲彲蹇€熷畬鎴愬叧鑱旓細</p>
            <div className="droppable-task-list">
              {tasks.filter(t => t.status !== 'done').map((task) => (
                <DroppableTaskItem
                  key={task.id}
                  task={task}
                />
              ))}
              {!tasks.filter(t => t.status !== 'done').length && (
                <div className="sidebar-notes-empty">
                  <span>鏆傛棤娲诲姩涓殑浠诲姟</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(.2, .9, .25, 1.2)' }}>
        {activeDragNote ? (
          <div className="note-card-drag-overlay" data-category={activeDragNote.category}>
            <div className="sidebar-note-card-head">
              <span className="note-category">{activeDragNote.category}</span>
              <span className="note-date">{activeDragNote.updatedAt ? activeDragNote.updatedAt.slice(5, 10) : ''}</span>
            </div>
            <h4>{activeDragNote.title}</h4>
            <p>{activeDragNote.content}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function NotesSection({
  task,
  notes,
  search,
  attachments,
  askConfirm,
  addToast,
  focusToken,
  noteCategories,
  onCategoriesChanged,
  onSearchChange,
  onChanged,
  onCreateLogFromNote,
  onCreateAiLogFromNote,
}) {
  const [editingNote, setEditingNote] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const noteTextareaRef = useRef(null);
  const sectionRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } })
  );

  const activeDragNote = useMemo(
    () => notes.find((note) => note.id === activeDragId),
    [activeDragId, notes],
  );

  function focusCreateNote() {
    setEditingNote(null);
    window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      noteTextareaRef.current?.focus();
    }, 0);
  }

  useEffect(() => {
    if (focusToken) {
      focusCreateNote();
    }
  }, [focusToken]);

  function handleDragStart(event) {
    setActiveDragId(Number(event.active.id));
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  async function handleDragEnd(event) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = notes.findIndex((n) => n.id === Number(active.id));
    const newIndex = notes.findIndex((n) => n.id === Number(over.id));

    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(notes, oldIndex, newIndex);
      const payload = reordered.map((note, index) => ({
        id: note.id,
        sortOrder: index,
      }));
      try {
        await api.reorderNotes(payload);
        addToast('info', '鎻愮ず', '鎿嶄綔宸插畬鎴愩€?);
        await onChanged();
      } catch (err) {
        addToast('error', '鍑洪敊浜?, err.message);
      }
    }
  }

  return (
    <section className="notes-section" ref={sectionRef}>
      <div className="section-title-row">
        <h3>浠诲姟绗旇锛堟暣浣撹褰曪級</h3>
        <div className="note-title-actions">
          <span>{notes.length} </span>
          <button type="button" className="icon-button note-create-button" onClick={focusCreateNote}>
            <Plus size={14} />
            鍒涘缓绗旇
          </button>
        </div>
      </div>
      <div className="note-search-row">
        <label>
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="鎼滅储鏍囬銆佸唴瀹广€佸垎绫绘垨鍏宠仈闄勪欢..."
          />
        </label>
      </div>
      <NoteForm
        task={task}
        attachments={attachments}
        note={editingNote}
        inputRef={noteTextareaRef}
        addToast={addToast}
        noteCategories={noteCategories}
        onCancel={() => setEditingNote(null)}
        onSaved={async () => {
          setEditingNote(null);
          await onChanged();
          await onCategoriesChanged?.();
        }}
      />
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
        <SortableContext items={notes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
          <div className="note-list">
            {notes.map((note) => (
              <SortableNoteItem
                key={note.id}
                note={note}
                askConfirm={askConfirm}
                addToast={addToast}
                onEdit={() => setEditingNote(note)}
                onChanged={onChanged}
                onCreateLog={onCreateLogFromNote ? () => onCreateLogFromNote(note) : null}
                onCreateAiLog={onCreateAiLogFromNote ? () => onCreateAiLogFromNote(note) : null}
              />
            ))}
            {!notes.length && <div className="empty-column">鏆傛棤绗旇</div>}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(.2, .9, .25, 1.2)' }}>
          {activeDragNote ? (
            <div className="note-card-drag-overlay" data-category={activeDragNote.category}>
              <div className="sidebar-note-card-head">
                <span className="note-category">{activeDragNote.category}</span>
                <span className="note-date">{activeDragNote.updatedAt ? activeDragNote.updatedAt.slice(11, 16) : ''}</span>
              </div>
              <h4>{activeDragNote.title}</h4>
              <p>{activeDragNote.content}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function RichNoteEditor({ value, onChange, pendingFiles, onPendingFilesChange, addToast }) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  function insertFiles(fileList) {
    const editor = editorRef.current;
    if (!editor) return;

    const remainingSlots = Math.max(0, 10 - pendingFiles.length);
    const files = Array.from(fileList || []).slice(0, remainingSlots);
    if (!files.length) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }

    if (files.length < Array.from(fileList || []).length) {
      addToast('info', '鎻愮ず', '鎿嶄綔宸插畬鎴愩€?);
    }

    const nextPending = files.map((file) => {
      const tempId = `pending-${Date.now()}-${crypto.randomUUID()}`;
      return {
        tempId,
        file,
        name: file.name || '绮樿创闄勪欢',
        size: file.size || 0,
        mimeType: file.type || 'application/octet-stream',
        previewUrl: URL.createObjectURL(file),
        isImage: String(file.type || '').startsWith('image/'),
      };
    });

    nextPending.forEach((item) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'fileAttachment',
          attrs: {
            tempId: item.tempId,
            name: item.name,
            size: item.size,
            mimeType: item.mimeType,
            previewUrl: item.previewUrl,
            downloadUrl: item.previewUrl,
            isImage: item.isImage,
          },
        })
        .run();
    });
    onPendingFilesChange([...pendingFiles, ...nextPending]);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Image,
      FileAttachmentNode,
    ],
    content: value || emptyRichDoc,
    editorProps: {
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        insertFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        insertFiles(files);
        return true;
      },
    },
    onUpdate({ editor: currentEditor }) {
      const json = currentEditor.getJSON();
      onChange(json, extractPlainTextFromDoc(json));
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(value || emptyRichDoc);
    if (current !== next) {
      editor.commands.setContent(value || emptyRichDoc, { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="rich-note-editor">
      <div className="rich-note-toolbar">
        <button
          type="button"
          className={editor?.isActive('bold') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="鍔犵矖"
        >
          B
        </button>
        <button
          type="button"
          className={editor?.isActive('italic') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="鏂滀綋"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="椤圭洰鍒楄〃"
        >
          鍒楄〃
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="涓婁紶闄勪欢"
        >
          <Paperclip size={14} />
          闄勪欢
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          onChange={(event) => {
            insertFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <EditorContent editor={editor} className="rich-note-content" />
      <div className="rich-note-hint">鍙洿鎺ョ矘璐村浘鐗囨垨鏂囦欢锛涘浘鐗囦細鏄剧ず鍦ㄦ鏂囬噷锛屾枃浠朵細鏄剧ず涓洪檮浠跺崱鐗?/div>
    </div>
  );
}

function RichNoteViewer({ contentJson, fallback }) {
  const doc = contentJson || textToRichDoc(fallback || '');

  const renderMarks = (text, marks = []) => {
    return marks.reduce((node, mark) => {
      if (mark.type === 'bold') return <strong>{node}</strong>;
      if (mark.type === 'italic') return <em>{node}</em>;
      if (mark.type === 'code') return <code>{node}</code>;
      if (mark.type === 'link') {
        return (
          <a href={mark.attrs?.href} target="_blank" rel="noreferrer">
            {node}
          </a>
        );
      }
      return node;
    }, text);
  };

    const renderNode = (node, index) => {
    if (!node) return null;
    if (node.type === 'text') return <span key={index}>{renderMarks(node.text, node.marks)}</span>;
    if (node.type === 'hardBreak') return <br key={index} />;
    if (node.type === 'paragraph') {
      return <p key={index}>{(node.content || []).map(renderNode)}</p>;
    }
    if (node.type === 'heading') {
      return <h4 key={index}>{(node.content || []).map(renderNode)}</h4>;
    }
    if (node.type === 'bulletList') {
      return <ul key={index}>{(node.content || []).map(renderNode)}</ul>;
    }
    if (node.type === 'orderedList') {
      return <ol key={index}>{(node.content || []).map(renderNode)}</ol>;
    }
    if (node.type === 'listItem') {
      return <li key={index}>{(node.content || []).map(renderNode)}</li>;
    }
    if (node.type === 'blockquote') {
      return <blockquote key={index}>{(node.content || []).map(renderNode)}</blockquote>;
    }
    if (node.type === 'codeBlock') {
      return (
        <pre key={index}>
          <code>{(node.content || []).map(renderNode)}</code>
        </pre>
      );
    }
    if (node.type === 'fileAttachment') {
      const attrs = node.attrs || {};
      return <RichAttachmentNode key={index} attachment={attrs} />;
    }
    if (node.type === 'image') {
      const attrs = node.attrs || {};
      return (
        <RichAttachmentNode
          key={index}
          attachment={{
            ...attrs,
            isImage: true,
            previewUrl: attrs.src,
            name: attrs.alt || attrs.title || '鍥剧墖',
          }}
        />
      );
    }
    return <div key={index}>{(node.content || []).map(renderNode)}</div>;
  };

  return <div className="rich-note-viewer">{(doc.content || []).map(renderNode)}</div>;
}

function RichAttachmentNode({ attachment }) {
  const name = attachment.name || attachment.originalName || '闄勪欢';
  const href = attachment.downloadUrl || attachment.previewUrl;
  const pending = Boolean(attachment.tempId);
  if (attachment.isImage && attachment.previewUrl) {
    return (
      <figure className={pending ? 'rich-attachment-node image pending' : 'rich-attachment-node image'}>
        <a href={attachment.previewUrl} target="_blank" rel="noreferrer">
          <img src={attachment.previewUrl} alt={name} />
        </a>
        <figcaption>{pending ? `${name} 路 寰呬繚瀛樹笂浼燻 : name}</figcaption>
      </figure>
    );
  }

  return (
    <a className={pending ? 'rich-attachment-node pending' : 'rich-attachment-node'} href={href} target="_blank" rel="noreferrer">
      <span className="rich-attachment-icon">
        <FileText size={16} />
      </span>
      <span className="rich-attachment-name">{name}</span>
      <span className="rich-attachment-size">{formatFileSize(attachment.size || attachment.fileSize)}</span>
      {pending && <span className="rich-attachment-pending">寰呬繚瀛?/span>}
    </a>
  );
}

function renderStreamInline(text) {
  const nodes = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;

  for (const match of String(text || '').matchAll(pattern)) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    nodes.push(<strong key={`b-${match.index}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < String(text || '').length) {
    nodes.push(<span key={`t-${lastIndex}`}>{String(text || '').slice(lastIndex)}</span>);
  }

  return nodes.length ? nodes : text;
}

function StreamNotePreview({ text }) {
  const lines = String(text || '').split(/\r?\n/);
  return (
    <div className="note-ai-format-stream" aria-live="polite">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="stream-line-gap" />;

        const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
        const markdownTitle = trimmed.match(/^\*\*([^*]{2,120})\*\*(?:\s+(.+))?$/);
        if (heading) {
          return <h4 key={index}>{renderStreamInline(heading[2])}</h4>;
        }
        if (markdownTitle && !/[锛?]/.test(trimmed)) {
          const title = `${markdownTitle[1]}${markdownTitle[2] ? ` ${markdownTitle[2]}` : ''}`;
          return <h4 key={index}>{title}</h4>;
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return <p key={index} className="stream-bullet">鈥?{renderStreamInline(bullet[1])}</p>;
        }

        return <p key={index}>{renderStreamInline(trimmed)}</p>;
      })}
    </div>
  );
}

function NoteAiFormatDrawer({
  open,
  loading,
  applying = false,
  error = '',
  original,
  result,
  streamText = '',
  instruction = '',
  onInstructionChange,
  onRetry,
  onApply,
  onClose,
}) {
  if (!open) return null;
  const hasResult = Boolean(result?.contentJson);

  return (
    <>
      <div className="drawer-overlay note-ai-format-overlay" onClick={onClose} />
      <aside className="note-ai-format-drawer" aria-label="AI鏁寸悊绗旇纭">
        <div className="note-ai-format-head">
          <div>
            <p className="eyebrow">AI 鎺掔増鏁寸悊</p>
            <h2>纭鏁寸悊缁撴灉</h2>
            <span>宸︿晶鏄師绗旇锛屽彸渚ф槸 AI 鏁寸悊鍚庣殑鍊欓€夊唴瀹广€傜‘璁ゅ墠涓嶄細瑕嗙洊鍘熸枃銆?/span>
          </div>
          <button type="button" className="round-button" onClick={onClose} title="鍏抽棴">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="note-ai-format-status">
            <Sparkles size={16} />
            AI 姝ｅ湪鏁寸悊绗旇...
          </div>
        )}
        {error && (
          <div className="note-ai-format-error">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <label className="note-ai-format-instruction">
          <span>鏁寸悊鎯虫硶锛堝彲閫夛級</span>
          <div className="note-ai-format-presets" aria-label="AI鏁寸悊棰勮">
            {noteFormatPresets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={instruction === preset.instruction ? 'active' : ''}
                onClick={() => onInstructionChange?.(preset.instruction)}
                disabled={loading || applying}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            value={instruction}
            onChange={(event) => onInstructionChange?.(event.target.value)}
            placeholder="渚嬪锛氭寜璐﹀彿鍒嗙粍銆佹暣鐞嗘垚娓呭崟銆佹妸閿欒鐘舵€佹斁鍓嶉潰銆佸彧淇濈暀鍏抽敭瀛楁銆備笉濉垯鎸夐粯璁ゆ柟寮忔暣鐞嗐€?
            disabled={loading || applying}
            rows={3}
          />
        </label>

        <div className="note-ai-format-compare">
          <section className="note-ai-format-panel">
            <div className="note-ai-format-panel-head">
              <span>鍘熺瑪璁?/span>
            </div>
            <RichNoteViewer contentJson={original?.contentJson} fallback={original?.content} />
          </section>
          <section className="note-ai-format-panel result">
            <div className="note-ai-format-panel-head">
              <span>鏁寸悊鍚?/span>
            </div>
            {hasResult ? (
              <RichNoteViewer contentJson={result.contentJson} fallback={result.content} />
            ) : streamText ? (
              <StreamNotePreview text={streamText} />
            ) : (
              <div className="note-ai-format-placeholder">
                {loading ? '绛夊緟 AI 寮€濮嬭緭鍑?..' : '鏆傛棤鏁寸悊缁撴灉'}
              </div>
            )}
          </section>
        </div>

        <div className="note-ai-format-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={applying}>
            鍙栨秷
          </button>
          <button type="button" className="ghost-button" onClick={() => onRetry?.(instruction)} disabled={loading || applying}>
            <RefreshCw size={14} />
            {hasResult || streamText ? '閲嶆柊鏁寸悊' : '寮€濮嬫暣鐞?}
          </button>
          <button
            type="button"
            className="icon-button primary"
            onClick={onApply}
            disabled={!hasResult || loading || applying}
          >
            <Check size={14} />
            {applying ? '姝ｅ湪搴旂敤...' : '搴旂敤鏁寸悊缁撴灉'}
          </button>
        </div>
      </aside>
    </>
  );
}

const noteVersionSourceLabels = {
  manual: '鎵嬪姩缂栬緫',
  ai_format: 'AI 鏁寸悊',
  restore: '鐗堟湰鍥為€€',
};

function snapshotToPreview(snapshot) {
  return {
    content: snapshot?.content || '',
    contentJson: snapshot?.contentJson || null,
  };
}

function NoteVersionDrawer({
  open,
  note,
  versions,
  selectedId,
  loading,
  restoring,
  error,
  onSelect,
  onRestore,
  onClose,
}) {
  if (!open) return null;
  const selected = versions.find((version) => version.id === selectedId) || versions[0] || null;
  const before = snapshotToPreview(selected?.before);
  const after = snapshotToPreview(selected?.after);

  return (
    <>
      <div className="drawer-overlay note-version-overlay" onClick={onClose} />
      <aside className="note-version-drawer" aria-label="绗旇鐗堟湰鍘嗗彶">
        <div className="note-version-head">
          <div>
            <p className="eyebrow">鐗堟湰鍘嗗彶</p>
            <h2>{note?.title || '鏈懡鍚嶇瑪璁?}</h2>
            <span>鏌ョ湅绗旇鍙樻洿鍓嶅悗鍐呭锛岄渶瑕佹椂鍙洖閫€鍒板彉鏇村墠鐗堟湰銆?/span>
          </div>
          <button type="button" className="round-button" onClick={onClose} title="鍏抽棴">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="note-ai-format-error">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <div className="note-version-layout">
          <section className="note-version-list" aria-label="鐗堟湰鍒楄〃">
            {loading ? (
              <div className="empty-column">姝ｅ湪鍔犺浇鐗堟湰...</div>
            ) : versions.length ? (
              versions.map((version) => (
                <button
                  type="button"
                  key={version.id}
                  className={selected?.id === version.id ? 'active' : ''}
                  onClick={() => onSelect(version.id)}
                >
                  <strong>{noteVersionSourceLabels[version.source] || '绗旇鏇存柊'}</strong>
                  <span>{version.createdAt}</span>
                  {version.changeNote && <em>{version.changeNote}</em>}
                </button>
              ))
            ) : (
              <div className="empty-column">鏆傛棤鐗堟湰璁板綍</div>
            )}
          </section>

          <div className="note-version-preview">
            <section className="note-ai-format-panel">
              <div className="note-ai-format-panel-head">
                <span>鍙樻洿鍓?/span>
              </div>
              {selected ? (
                <RichNoteViewer contentJson={before.contentJson} fallback={before.content} />
              ) : (
                <div className="note-ai-format-placeholder">閫夋嫨涓€涓増鏈煡鐪嬪唴瀹?/div>
              )}
            </section>
            <section className="note-ai-format-panel result">
              <div className="note-ai-format-panel-head">
                <span>鍙樻洿鍚?/span>
              </div>
              {selected ? (
                <RichNoteViewer contentJson={after.contentJson} fallback={after.content} />
              ) : (
                <div className="note-ai-format-placeholder">閫夋嫨涓€涓増鏈煡鐪嬪唴瀹?/div>
              )}
            </section>
          </div>
        </div>

        <div className="note-ai-format-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={restoring}>
            鍏抽棴
          </button>
          <button
            type="button"
            className="icon-button primary"
            onClick={() => selected && onRestore(selected)}
            disabled={!selected || restoring}
          >
            <RefreshCw size={14} />
            {restoring ? '姝ｅ湪鍥為€€...' : '鍥為€€鍒板彉鏇村墠'}
          </button>
        </div>
      </aside>
    </>
  );
}

function AttachmentCardList({ attachments = [], onDelete, emptyText = '鏆傛棤闄勪欢', kind, addToast, onChanged }) {
  if (!attachments.length) {
    return <div className="attachment-empty">{emptyText}</div>;
  }

  return (
    <div className="attachment-card-list">
      {attachments.map((attachment) => (
        <article className={attachment.isImage ? 'attachment-item image' : 'attachment-item'} key={attachment.id}>
          {attachment.isImage ? (
            <a href={attachment.previewUrl} target="_blank" rel="noreferrer" className="attachment-preview">
              <img src={attachment.previewUrl} alt={attachment.originalName} />
            </a>
          ) : (
            <div className="attachment-file-icon">
              <FileText size={20} />
            </div>
          )}
          <div className="attachment-info">
            <div className="attachment-name" title={attachment.originalName}>
              {attachment.originalName}
            </div>
            <div className="attachment-meta">
              <span>{formatFileSize(attachment.fileSize)}</span>
              <span>{attachment.mimeType}</span>
            </div>
            <AttachmentTextStatus
              attachment={attachment}
              kind={kind}
              addToast={addToast}
              onChanged={onChanged}
            />
          </div>
          <div className="attachment-actions">
            <a className="round-button small" href={attachment.downloadUrl} title="涓嬭浇鏂囦欢">
              <Download size={13} />
            </a>
            {onDelete && (
              <button
                className="round-button small"
                type="button"
                onClick={() => onDelete(attachment)}
                title="鍒犻櫎闄勪欢"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function TaskAttachmentsSection({ task, attachments, askConfirm, addToast, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const fileInputRef = useRef(null);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 10) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }

    setUploading(true);
    try {
      await api.uploadTaskAttachments(task.id, files);
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachment) {
    const ok = await askConfirm('纭鍒犻櫎闄勪欢', `纭畾瑕佸垹闄も€?{attachment.originalName}鈥濆悧锛熼檮浠朵細杩涘叆鍥炴敹绔欙紝鍙仮澶嶃€俙);
    if (!ok) return;
    try {
      await api.deleteTaskAttachment(attachment.id);
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <section className="task-attachments-section">
      <div
        className={`paste-upload-zone ${isActive ? 'active' : ''}`}
        tabIndex={0}
        role="button"
        onFocus={() => setIsActive(true)}
        onBlur={() => setIsActive(false)}
        onClick={() => fileInputRef.current?.click()}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files || []);
          if (!files.length) return;
          event.preventDefault();
          uploadFiles(files);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsActive(true);
        }}
        onDragLeave={() => setIsActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsActive(false);
          uploadFiles(event.dataTransfer.files);
        }}
      >
        <Paperclip size={22} />
        <strong>{uploading ? '姝ｅ湪涓婁紶...' : '鐐瑰嚮銆佹嫋鏀炬垨绮樿创浠诲姟闄勪欢'}</strong>
        <span>鍥剧墖鍙瑙堬紝PDF銆乄ord銆丒xcel 鍜屽帇缂╁寘浼氭樉绀轰笅杞介摼鎺?/span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          onChange={(event) => {
            uploadFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <AttachmentCardList
        attachments={attachments}
        onDelete={removeAttachment}
        emptyText="鏆傛棤浠诲姟闄勪欢"
        kind="task"
        addToast={addToast}
        onChanged={onChanged}
      />
    </section>
  );
}

function NoteForm({
  task = null,
  attachments = [],
  note,
  inputRef,
  addToast,
  noteCategories = [],
  onCancel,
  onSaved,
}) {
  const [form, setForm] = useState({
    title: '',
    category: '',
    content: '',
    contentJson: emptyRichDoc,
    attachmentId: '',
  });
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [appliedAiFormat, setAppliedAiFormat] = useState(null);
  const [customNoteTemplates, setCustomNoteTemplates] = useState(() => loadCustomNoteTemplates());
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [formatState, setFormatState] = useState({
    open: false,
    loading: false,
    error: '',
    original: null,
    result: null,
    streamText: '',
    instruction: '',
    payload: null,
  });
  const pendingFilesRef = useRef([]);
  const draftKey = useMemo(() => noteDraftStorageKey(task, note), [task?.id, note?.id]);
  const categoryOptions = useMemo(
    () => mergeNoteCategories(noteCategories, [form.category]),
    [noteCategories, form.category],
  );
  const availableNoteTemplates = useMemo(
    () => [...noteTemplates, ...customNoteTemplates],
    [customNoteTemplates],
  );
  const categoryListId = task ? `note-category-options-task-${task.id}` : 'note-category-options-standalone';

  useEffect(() => {
    setDraftReady(false);
    const initialForm = note
      ? {
          title: note.title || '',
          category: note.category || '',
          content: note.content || '',
          contentJson: noteToRichDoc(note),
          attachmentId: note.attachmentId ? String(note.attachmentId) : '',
        }
      : {
          title: '',
          category: '',
          content: '',
          contentJson: emptyRichDoc,
          attachmentId: '',
        };

    let restoredForm = initialForm;
    let restoredAt = null;
    try {
      const storedDraft = localStorage.getItem(draftKey);
      if (storedDraft) {
        const parsedDraft = JSON.parse(storedDraft);
        if (parsedDraft?.form && isMeaningfulNoteDraft(parsedDraft.form)) {
          restoredForm = normalizeDraftForm(parsedDraft.form);
          restoredAt = parsedDraft.savedAt;
        }
      }
    } catch {
      // A malformed or unavailable browser storage must never block note entry.
    }

    setForm(restoredForm);
    pendingFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setPendingFiles([]);
    setAppliedAiFormat(null);
    setDraftStatus(restoredAt ? `宸叉仮澶嶆湭鎻愪氦鑽夌 ${formatDraftTime(restoredAt)}` : '');
    setDraftReady(true);
  }, [draftKey, note?.id]);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      pendingFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  useEffect(() => {
    if (!draftReady || saving) return undefined;

    const draftForm = {
      ...form,
      contentJson: stripPendingAttachmentNodes(form.contentJson),
    };
    draftForm.content = extractPlainTextFromDoc(draftForm.contentJson);

    if (!isMeaningfulNoteDraft(draftForm)) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Ignore unavailable storage; note creation remains usable.
      }
      return undefined;
    }

    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt, form: draftForm }));
        setDraftStatus(`鑽夌宸茶嚜鍔ㄤ繚瀛?{formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('鑽夌鏃犳硶鑷姩淇濆瓨');
      }
    }, 800);

    return () => window.clearTimeout(timer);
  }, [draftKey, draftReady, form, saving]);

  function applyNoteTemplate(template) {
    const contentJson = textToRichDoc(template.content);
    setForm((current) => ({
      ...current,
      title: template.title,
      category: template.category,
      content: template.content,
      contentJson,
    }));
    setDraftStatus(`宸插鐢ㄦā鏉匡細${template.label}`);
  }

  function saveCurrentAsTemplate() {
    const label = templateName.trim() || form.title.trim();
    const template = normalizeCustomNoteTemplate({
      label,
      title: form.title || label,
      category: form.category,
      content: extractPlainTextFromDoc(form.contentJson) || form.content,
    });
    if (!template) {
      addToast('error', '鍑洪敊浜?, '璇峰厛濉啓妯℃澘鍚嶇О鍜岀瑪璁板唴瀹广€?);
      return;
    }
    const nextTemplates = [template, ...customNoteTemplates.filter((item) => item.label !== template.label)].slice(0, 20);
    setCustomNoteTemplates(nextTemplates);
    saveCustomNoteTemplates(nextTemplates);
    setTemplateName('');
    setTemplateFormOpen(false);
    setDraftStatus(`宸蹭繚瀛樻ā鏉匡細${template.label}`);
  }

  function deleteCustomNoteTemplate(templateId) {
    const nextTemplates = customNoteTemplates.filter((template) => template.id !== templateId);
    setCustomNoteTemplates(nextTemplates);
    saveCustomNoteTemplates(nextTemplates);
    setDraftStatus('鑷畾涔夋ā鏉垮凡鍒犻櫎');
  }

  function openFormAiFormat() {
    const payload = noteFormatPayloadFromForm(form, note);
    if (!String(payload.content || '').trim()) {
      addToast('error', 'AI鏁寸悊澶辫触', '璇峰厛杈撳叆绗旇鍐呭銆?);
      return;
    }
    const original = {
      content: payload.content,
      contentJson: cloneRichDoc(payload.contentJson),
    };
    setFormatState((current) => ({
      open: true,
      loading: false,
      error: '',
      original,
      result: null,
      streamText: '',
      instruction: current.instruction || '',
      payload,
    }));
  }

  async function runFormAiFormat(instruction = formatState.instruction, payload = formatState.payload) {
    if (!payload) return;
    const nextPayload = { ...payload, instruction: String(instruction || '').trim() };
    const original = formatState.original || {
      content: nextPayload.content,
      contentJson: cloneRichDoc(nextPayload.contentJson),
    };
    setFormatState((current) => ({
      ...current,
      open: true,
      loading: true,
      error: '',
      original,
      result: null,
      streamText: '',
      instruction: nextPayload.instruction,
      payload: nextPayload,
    }));
    try {
      let finalResult = null;
      await api.streamFormatNoteWithAi(nextPayload, {
        onDelta: (delta) => {
          setFormatState((current) => ({
            ...current,
            streamText: `${current.streamText || ''}${delta}`,
          }));
        },
        onDone: (done) => {
          finalResult = normalizeFormattedNoteResult(done);
          setFormatState({
            open: true,
            loading: false,
            error: '',
            original,
            result: finalResult,
            streamText: done?.streamText || '',
            instruction: nextPayload.instruction,
            payload: nextPayload,
          });
        },
      });
      if (!finalResult) {
        throw new Error('AI 鏁寸悊娌℃湁杩斿洖鍙敤缁撴灉銆?);
      }
    } catch (err) {
      setFormatState((current) => ({
        ...current,
        open: true,
        loading: false,
        error: err.message,
        original,
        result: null,
        payload: nextPayload,
      }));
    }
  }

  function applyFormAiFormat() {
    if (!formatState.result) return;
    const result = normalizeFormattedNoteResult(formatState.result);
    setForm((current) => ({
      ...current,
      content: result.content,
      contentJson: cloneRichDoc(result.contentJson),
    }));
    setAppliedAiFormat({
      instruction: formatState.instruction || '',
    });
    setDraftStatus('AI鏁寸悊缁撴灉宸插簲鐢紝璇风‘璁ゅ悗淇濆瓨');
    setFormatState((current) => ({ ...current, open: false }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }
    if (!form.content.trim()) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }

    setSaving(true);
    try {
      const category = form.category.trim();
      const baseContentJson = stripPendingAttachmentNodes(form.contentJson);
      const payload = {
        title: form.title,
        category: category || null,
        content: form.content,
        contentJson: baseContentJson,
        attachmentId: form.attachmentId ? Number(form.attachmentId) : null,
      };
      if (note && appliedAiFormat) {
        payload.changeSource = 'ai_format';
        payload.changeNote = appliedAiFormat.instruction
          ? `AI 鏁寸悊锛?{appliedAiFormat.instruction}`.slice(0, 255)
          : 'AI 鏁寸悊';
      }
      let savedNote;
      if (note) {
        savedNote = await api.updateNote(note.id, payload);
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      } else if (task) {
        savedNote = await api.createNote(task.id, payload);
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      } else {
        savedNote = await api.createStandaloneNote(payload);
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      }

      if (pendingFiles.length) {
        const uploaded = await api.uploadNoteAttachments(
          savedNote.id,
          pendingFiles.map((item) => item.file),
        );
        const newAttachments = uploaded.slice(-pendingFiles.length);
        const finalizedJson = replacePendingAttachmentNodes(form.contentJson, pendingFiles, newAttachments);
        savedNote = await api.updateNote(savedNote.id, {
          content: extractPlainTextFromDoc(finalizedJson),
          contentJson: finalizedJson,
        });
        addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      }

      pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingFiles([]);
      setAppliedAiFormat(null);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // The saved server record is authoritative even when browser storage is unavailable.
      }
      setDraftStatus('绗旇宸蹭繚瀛?);
      setForm({ title: '', category: '', content: '', contentJson: emptyRichDoc, attachmentId: '' });
      await onSaved();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <form className="note-form" onSubmit={submit}>
      <div className="note-form-head">
        <div className="note-form-title">
          {note ? <Edit3 size={15} /> : <Plus size={15} />}
          <h4>{note ? '缂栬緫绗旇' : task ? '鍒涘缓浠诲姟绗旇' : '鍒涘缓鐙珛绗旇'}</h4>
        </div>
        {draftStatus && (
          <span className="note-draft-status" aria-live="polite">
            <Clock3 size={13} />
            {draftStatus}
          </span>
        )}
      </div>
      {!note && (
        <div className="note-template-panel">
          <div className="note-template-panel-head">
            <span>甯哥敤妯℃澘</span>
            <button type="button" className="ghost-button tiny" onClick={() => setTemplateFormOpen((open) => !open)}>
              <Save size={12} />
              淇濆瓨褰撳墠涓烘ā鏉?            </button>
          </div>
          <div className="note-template-picks" aria-label="绗旇妯℃澘">
            {availableNoteTemplates.map((template) => (
              <span className={template.custom ? 'note-template-chip custom' : 'note-template-chip'} key={template.id}>
                <button
                  type="button"
                  onClick={() => applyNoteTemplate(template)}
                >
                  {template.label}
                </button>
                {template.custom && (
                  <button
                    type="button"
                    className="note-template-delete"
                    onClick={() => deleteCustomNoteTemplate(template.id)}
                    title="鍒犻櫎鑷畾涔夋ā鏉?
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
          {templateFormOpen && (
            <div className="note-template-save-row">
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="妯℃澘鍚嶇О锛屼緥濡傦細寮€鍙疯褰?
              />
              <button type="button" className="icon-button primary" onClick={saveCurrentAsTemplate}>
                <Save size={13} />
                淇濆瓨妯℃澘
              </button>
            </div>
          )}
        </div>
      )}
      <label className="note-title-field">
        鏍囬
        <input
          ref={inputRef}
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="渚嬪锛氫細璁鐐广€佸鎴峰弽棣堛€佸緟纭浜嬮」"
        />
      </label>
      <div className="note-form-grid">
        <div className="note-category-field">
          <label htmlFor={categoryListId}>鍒嗙被</label>
          <input
            id={categoryListId}
            list={`${categoryListId}-list`}
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            placeholder="杈撳叆鏂板垎绫绘垨閫夋嫨宸叉湁鍒嗙被"
          />
          <datalist id={`${categoryListId}-list`}>
            {categoryOptions.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <div className="category-helper">杈撳叆鏂扮殑鍒嗙被鍚嶇О锛屼繚瀛樼瑪璁板悗浼氳嚜鍔ㄥ垱寤?/div>
          <div className="category-picks" aria-label="宸叉湁绗旇鍒嗙被">
            {categoryOptions.slice(0, 8).map((category) => (
              <button
                type="button"
                key={category}
                className={form.category.trim() === category ? 'active' : ''}
                onClick={() => setForm({ ...form, category })}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        {task ? (
          <label>
            鍏宠仈闄勪欢
            <select
              value={form.attachmentId}
              onChange={(event) => setForm({ ...form, attachmentId: event.target.value })}
            >
              <option value="">涓嶅叧鑱旈檮</option>
              {attachments.map((attachment) => (
                <option key={attachment.id} value={attachment.id}>
                  {attachment.originalName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="standalone-note-scope">
            <span>淇濆瓨浣嶇疆</span>
            <strong>鐙珛绗旇</strong>
          </div>
        )}
      </div>
      <div className="note-editor-field">
        <span>绗旇鍐呭</span>
        <RichNoteEditor
          value={form.contentJson}
          pendingFiles={pendingFiles}
          onPendingFilesChange={setPendingFiles}
          addToast={addToast}
          onChange={(contentJson, content) => setForm((current) => ({ ...current, contentJson, content }))}
        />
        {pendingFiles.length > 0 && (
          <div className="note-pending-file-warning">
            <AlertTriangle size={13} />
            {pendingFiles.length} 涓檮浠跺皢鍦ㄧ偣鍑讳繚瀛樺悗涓婁紶
          </div>
        )}
      </div>
      <div className="note-form-actions">
        <button
          type="button"
          className="ghost-button ai-format-button"
          onClick={openFormAiFormat}
          disabled={saving || formatState.loading}
        >
          <Sparkles size={14} />
          AI鏁寸悊
        </button>
        {note && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            <X size={14} />
            鍙栨秷缂栬緫
          </button>
        )}
        <button className="icon-button primary" disabled={saving}>
          <Save size={15} />
          {note ? '淇濆瓨绗旇' : '娣诲姞绗旇'}
        </button>
      </div>
    </form>
    <NoteAiFormatDrawer
      open={formatState.open}
      loading={formatState.loading}
      error={formatState.error}
      original={formatState.original}
      result={formatState.result}
      streamText={formatState.streamText}
      instruction={formatState.instruction}
      onInstructionChange={(instruction) => setFormatState((current) => ({ ...current, instruction }))}
      onRetry={(instruction) => runFormAiFormat(instruction)}
      onApply={applyFormAiFormat}
      onClose={() => setFormatState((current) => ({ ...current, open: false }))}
    />
    </>
  );
}

const NoteItem = forwardRef(function NoteItem(
  {
    note,
    askConfirm,
    addToast,
    onEdit,
    onChanged,
    onOpenTask,
    onDetach,
    onCreateLog,
    onCreateAiLog,
    dragAttributes,
    dragListeners,
    isDragging = false,
    isFocusTarget = false,
    style,
  },
  ref,
) {
  const [formatState, setFormatState] = useState({
    open: false,
    loading: false,
    error: '',
    original: null,
    result: null,
    streamText: '',
    instruction: '',
    payload: null,
  });
  const [formatApplying, setFormatApplying] = useState(false);
  const [aiLogLoading, setAiLogLoading] = useState(false);
  const [versionState, setVersionState] = useState({
    open: false,
    loading: false,
    restoring: false,
    error: '',
    versions: [],
    selectedId: null,
  });

  async function openVersionHistory() {
    setVersionState({
      open: true,
      loading: true,
      restoring: false,
      error: '',
      versions: [],
      selectedId: null,
    });
    try {
      const versions = await api.getNoteVersions(note.id);
      setVersionState((current) => ({
        ...current,
        loading: false,
        versions,
        selectedId: versions[0]?.id || null,
      }));
    } catch (err) {
      setVersionState((current) => ({
        ...current,
        loading: false,
        error: err.message,
      }));
    }
  }

  function openNoteAiFormat() {
    const payload = noteFormatPayloadFromNote(note);
    if (!String(payload.content || '').trim()) {
      addToast('error', 'AI鏁寸悊澶辫触', '杩欐潯绗旇娌℃湁鍙暣鐞嗙殑鍐呭銆?);
      return;
    }
    const original = {
      content: payload.content,
      contentJson: cloneRichDoc(payload.contentJson),
    };
    setFormatState((current) => ({
      open: true,
      loading: false,
      error: '',
      original,
      result: null,
      streamText: '',
      instruction: current.instruction || '',
      payload,
    }));
  }

  async function runNoteAiFormat(instruction = formatState.instruction, payload = formatState.payload) {
    if (!payload) return;
    const nextPayload = { ...payload, instruction: String(instruction || '').trim() };
    const original = formatState.original || {
      content: nextPayload.content,
      contentJson: cloneRichDoc(nextPayload.contentJson),
    };
    setFormatState((current) => ({
      ...current,
      open: true,
      loading: true,
      error: '',
      original,
      result: null,
      streamText: '',
      instruction: nextPayload.instruction,
      payload: nextPayload,
    }));
    try {
      let finalResult = null;
      await api.streamFormatNoteWithAi(nextPayload, {
        onDelta: (delta) => {
          setFormatState((current) => ({
            ...current,
            streamText: `${current.streamText || ''}${delta}`,
          }));
        },
        onDone: (done) => {
          finalResult = normalizeFormattedNoteResult(done);
          setFormatState({
            open: true,
            loading: false,
            error: '',
            original,
            result: finalResult,
            streamText: done?.streamText || '',
            instruction: nextPayload.instruction,
            payload: nextPayload,
          });
        },
      });
      if (!finalResult) {
        throw new Error('AI 鏁寸悊娌℃湁杩斿洖鍙敤缁撴灉銆?);
      }
    } catch (err) {
      setFormatState((current) => ({
        ...current,
        open: true,
        loading: false,
        error: err.message,
        original,
        result: null,
        payload: nextPayload,
      }));
    }
  }

  async function applyNoteAiFormat() {
    if (!formatState.result) return;
    const result = normalizeFormattedNoteResult(formatState.result);
    setFormatApplying(true);
    try {
      await api.updateNote(note.id, {
        content: result.content,
        contentJson: result.contentJson,
        changeSource: 'ai_format',
        changeNote: formatState.instruction
          ? `AI 鏁寸悊锛?{formatState.instruction}`.slice(0, 255)
          : 'AI 鏁寸悊',
      });
      addToast('success', 'AI鏁寸悊宸插簲鐢?, '绗旇鎺掔増宸叉洿鏂般€?);
      setFormatState((current) => ({ ...current, open: false }));
      await onChanged();
    } catch (err) {
      addToast('error', 'AI鏁寸悊澶辫触', err.message);
    } finally {
      setFormatApplying(false);
    }
  }

  async function removeNote() {
    const ok = await askConfirm('纭鍒犻櫎绗旇', '纭畾瑕佸垹闄よ繖鏉＄瑪璁板悧锛熺瑪璁颁細杩涘叆鍥炴敹绔欙紝鍙仮澶嶃€?);
    if (!ok) return;
    try {
      await api.deleteNote(note.id);
      addToast('success', '宸茬Щ鍏ュ洖鏀剁珯', '鍙湪鍥炴敹绔欐仮澶嶈繖鏉＄瑪璁般€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function removeNoteAttachment(attachment) {
    const ok = await askConfirm('纭鍒犻櫎闄勪欢', `纭畾瑕佸垹闄も€?{attachment.originalName}鈥濆悧锛熼檮浠朵細杩涘叆鍥炴敹绔欙紝鍙仮澶嶃€俙);
    if (!ok) return;
    try {
      await api.deleteNoteAttachment(attachment.id);
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function restoreVersion(version) {
    const ok = await askConfirm('纭鍥為€€绗旇', `纭畾瑕佹妸鈥?{note.title || '鏈懡鍚嶇瑪璁?}鈥濆洖閫€鍒拌鐗堟湰鐨勫彉鏇村墠鍐呭鍚楋紵褰撳墠鍐呭浼氬厛淇濆瓨涓轰竴涓柊鐗堟湰銆俙);
    if (!ok) return;
    setVersionState((current) => ({ ...current, restoring: true, error: '' }));
    try {
      await api.restoreNoteVersion(note.id, version.id, 'before');
      addToast('success', '绗旇宸插洖閫€', '褰撳墠鍐呭宸插洖閫€锛屽苟淇濈暀浜嗗洖閫€鍓嶇増鏈€?);
      setVersionState((current) => ({ ...current, open: false, restoring: false }));
      await onChanged();
    } catch (err) {
      setVersionState((current) => ({
        ...current,
        restoring: false,
        error: err.message,
      }));
    }
  }

  async function createAiLogDraft() {
    if (!onCreateAiLog) return;
    setAiLogLoading(true);
    try {
      await onCreateAiLog();
      addToast('success', 'AI 鑽夌宸茬敓鎴?, '璇峰湪鏃ュ織椤电‘璁ゅ悗鍐嶄繚瀛樸€?);
    } catch (err) {
      addToast('error', 'AI 鐢熸垚鏃ュ織澶辫触', err.message);
    } finally {
      setAiLogLoading(false);
    }
  }

  return (
    <>
    <article
      ref={ref}
      style={style}
      data-note-id={note.id}
      data-category={note.category}
      className={`note-item ${isDragging ? 'is-dragging' : ''} ${isFocusTarget ? 'is-focus-target' : ''}`}
      {...(dragAttributes || {})}
      {...(dragListeners || {})}
    >
      <div className="note-item-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {dragAttributes && (
            <span
              className="note-drag-handle"
              title="闀挎寜绗旇浠绘剰浣嶇疆鎷栧姩鎺掑簭"
              aria-hidden="true"
            >
              <GripVertical size={13} />
            </span>
          )}
          <span className="note-category">{note.category}</span>
        </div>
        <span>{note.updatedAt}</span>
      </div>
      {note.taskId && (
        <div className="note-linked-task">
          <ClipboardList size={13} />
          <span title={note.taskTitle || '鍏宠仈浠诲姟'}>{note.taskTitle || '鍏宠仈浠诲姟'}</span>
          {note.taskStatus && <em>{statusLabels[note.taskStatus] || note.taskStatus}</em>}
        </div>
      )}
      <h4>{note.title || '鏈懡鍚嶇瑪璁?}</h4>
      <div className="note-preview-shell">
        <RichNoteViewer contentJson={note.contentJson} fallback={note.content} />
      </div>
      {note.attachment && (
        <div className="note-attachment">
          {note.attachment.isImage ? (
            <a
              href={note.attachment.previewUrl}
              target="_blank"
              rel="noreferrer"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <img src={note.attachment.previewUrl} alt={note.attachment.originalName} />
            </a>
          ) : (
            <div className="note-file-icon">
              <FileText size={17} />
            </div>
          )}
          <div>
            <strong>{note.attachment.originalName}</strong>
            <span>{formatFileSize(note.attachment.fileSize)}</span>
            <AttachmentTextStatus
              attachment={note.attachment}
              kind="log"
              addToast={addToast}
              onChanged={onChanged}
            />
          </div>
          <a
            className="round-button small"
            href={note.attachment.downloadUrl}
            title="涓嬭浇鍏宠仈闄勪欢"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Download size={13} />
          </a>
        </div>
      )}
      {note.attachments?.length > 0 && (
        <AttachmentCardList
          attachments={note.attachments}
          onDelete={removeNoteAttachment}
          kind="note"
          addToast={addToast}
          onChanged={onChanged}
        />
      )}
      <div className="note-actions">
        <button
          className="ghost-button ai-format-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openNoteAiFormat();
          }}
          disabled={formatState.loading || formatApplying}
        >
          <Sparkles size={13} />
          AI鏁寸悊
        </button>
        <button
          className="ghost-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openVersionHistory();
          }}
        >
          <Clock3 size={13} />
          鍘嗗彶
        </button>
        {note.taskId && onOpenTask && (
          <button
            className="ghost-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenTask();
            }}
          >
            <ExternalLink size={13} />
            鎵撳紑浠诲姟
          </button>
        )}
        {note.taskId && onCreateLog && (
          <button
            className="ghost-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCreateLog();
            }}
          >
            <ClipboardList size={13} />
            鐢熸垚鏃ュ織
          </button>
        )}
        {note.taskId && onCreateAiLog && (
          <button
            className="ghost-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              createAiLogDraft();
            }}
            disabled={aiLogLoading}
          >
            <Sparkles size={13} />
            {aiLogLoading ? '鐢熸垚涓?..' : 'AI鐢熸垚鏃ュ織'}
          </button>
        )}
        {note.taskId && onDetach && (
          <button
            className="ghost-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDetach();
            }}
          >
            <X size={13} />
            鍙栨秷鍏宠仈
          </button>
        )}
        <button
          className="ghost-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <Edit3 size={13} />
          缂栬緫
        </button>
        <button
          className="danger-button"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            removeNote();
          }}
        >
          <Trash2 size={13} />
          鍒犻櫎
        </button>
      </div>
    </article>
    <NoteAiFormatDrawer
      open={formatState.open}
      loading={formatState.loading}
      applying={formatApplying}
      error={formatState.error}
      original={formatState.original}
      result={formatState.result}
      streamText={formatState.streamText}
      instruction={formatState.instruction}
      onInstructionChange={(instruction) => setFormatState((current) => ({ ...current, instruction }))}
      onRetry={(instruction) => runNoteAiFormat(instruction)}
      onApply={applyNoteAiFormat}
      onClose={() => setFormatState((current) => ({ ...current, open: false }))}
    />
    <NoteVersionDrawer
      open={versionState.open}
      note={note}
      versions={versionState.versions}
      selectedId={versionState.selectedId}
      loading={versionState.loading}
      restoring={versionState.restoring}
      error={versionState.error}
      onSelect={(selectedId) => setVersionState((current) => ({ ...current, selectedId }))}
      onRestore={restoreVersion}
      onClose={() => setVersionState((current) => ({ ...current, open: false }))}
    />
    </>
  );
});

function LogComposer({ task, seed, onCreated, addToast }) {
  const [form, setForm] = useState(() => createLogForm(task));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [attachmentNote, setAttachmentNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [customTemplates, setCustomTemplates] = useState(() => loadCustomLogTemplates());
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const fileInputRef = useRef(null);
  const draftKey = useMemo(() => logDraftStorageKey(task.id), [task.id]);
  const availableTemplates = useMemo(() => [
    ...logTemplates,
    ...customTemplates,
  ], [customTemplates]);
  const inferredNextStep = useMemo(() => (
    form.nextStep.trim() ? '' : inferNextStepFromLogContent(form.content)
  ), [form.content, form.nextStep]);

  useEffect(() => {
    setDraftReady(false);
    const initial = createLogForm(task);
    let next = initial;
    let restoredAt = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.form && isMeaningfulLogDraft(draft.form)) {
          next = normalizeLogDraftForm(draft.form, task);
          restoredAt = draft.savedAt;
        }
      }
    } catch {
      // Browser storage is optional; logging remains available without it.
    }
    setForm(next);
    setDetailsOpen(Boolean(restoredAt && (next.nextStep || next.logDate !== initial.logDate || next.stage !== initial.stage)));
    setFiles([]);
    setAttachmentNote('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDraftStatus(restoredAt ? `宸叉仮澶嶆湭鎻愪氦鑽夌 ${formatDraftTime(restoredAt)}` : '');
    setDraftReady(true);
  }, [draftKey, task.id]);

  useEffect(() => {
    if (!seed?.id || !seed.form) return;
    const nextForm = normalizeLogDraftForm(seed.form, task);
    setForm(nextForm);
    setDetailsOpen(Boolean(seed.form.nextStep || seed.detailsOpen));
    setFiles([]);
    setAttachmentNote('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDraftStatus(seed.status || '宸茬敓鎴愭棩蹇楄崏绋匡紝璇风‘璁ゅ悗璁板綍銆?);
  }, [seed?.id]);

  useEffect(() => {
    if (!draftReady || saving) return undefined;
    if (!isMeaningfulLogDraft(form)) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Ignore unavailable local storage.
      }
      return undefined;
    }

    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt, form }));
        setDraftStatus(`鑽夌宸茶嚜鍔ㄤ繚瀛?{formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('鑽夌鏃犳硶鑷姩淇濆瓨');
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftKey, draftReady, form, saving]);

  function applyLogTemplate(template) {
    const nextContent = form.content.trim()
      ? `${form.content.trim()}\n\n${template.content}`
      : template.content;
    setForm({
      ...form,
      content: nextContent,
      hours: form.hours || template.hours,
      nextStep: form.nextStep || template.nextStep,
      stage: form.stage || task.status,
      progressSnapshot: form.progressSnapshot || String(progressForStatus(task.status, task.progress)),
    });
    setDetailsOpen(detailsOpen || template.detailsOpen);
    setDraftStatus(`宸插鐢ㄣ€?{template.label}銆嶆ā鏉縛);
  }

  function addCustomTemplate() {
    const template = normalizeCustomLogTemplate({
      id: `custom-${Date.now()}`,
      label: templateName,
      content: form.content,
      nextStep: form.nextStep,
      hours: form.hours,
      detailsOpen,
    });
    if (!template) {
      addToast('error', '鍑洪敊浜?, '璇峰厛濉啓妯℃澘鍚嶇О鍜屽伐浣滃唴瀹广€?);
      return;
    }
    const nextTemplates = [
      template,
      ...customTemplates.filter((item) => item.label !== template.label),
    ].slice(0, 12);
    setCustomTemplates(nextTemplates);
    saveCustomLogTemplates(nextTemplates);
    setTemplateName('');
    setTemplateFormOpen(false);
    setDraftStatus(`宸蹭繚瀛樸€?{template.label}銆嶆ā鏉縛);
  }

  function removeCustomTemplate(templateId) {
    const nextTemplates = customTemplates.filter((template) => template.id !== templateId);
    setCustomTemplates(nextTemplates);
    saveCustomLogTemplates(nextTemplates);
    setDraftStatus('宸插垹闄よ嚜瀹氫箟妯℃澘');
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.content.trim()) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }

    setSaving(true);
    try {
      const createdLog = await api.createLog(task.id, {
        ...form,
        hours: Number(form.hours || 0),
        progressSnapshot: Number(form.progressSnapshot || 0),
      });
      if (files.length) {
        await api.uploadAttachments(createdLog.id, files, attachmentNote);
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // The saved API record remains the source of truth.
      }
      setForm(createLogForm(task));
      setDetailsOpen(false);
      setFiles([]);
      setAttachmentNote('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setDraftStatus('鏃ュ織宸蹭繚瀛?);
      await onCreated();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="log-composer" onSubmit={submit}>
      <div className="log-composer-head">
        <div>
          <h3>璁板綍鏈杩涘睍</h3>
          <span>褰撳墠闃舵{statusLabels[task.status]} 路 褰撳墠浠诲姟杩涘害 {progressForStatus(task.status, task.progress)}%</span>
        </div>
        {draftStatus && <span className="note-draft-status" aria-live="polite"><Clock3 size={13} />{draftStatus}</span>}
      </div>
      <div className="log-template-row">
        <span>甯哥敤妯℃澘</span>
        <div className="log-template-picks" aria-label="鏃ュ織妯℃澘">
          {availableTemplates.map((template) => (
            <span className="log-template-chip" key={template.id}>
              <button
                type="button"
                onClick={() => applyLogTemplate(template)}
                title={template.custom ? '鑷畾涔夋ā鏉? : '榛樿妯℃澘'}
              >
                {template.label}
              </button>
              {template.custom && (
                <button
                  type="button"
                  className="log-template-delete"
                  onClick={() => removeCustomTemplate(template.id)}
                  title="鍒犻櫎鑷畾涔夋ā鏉?
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            className="log-template-save-trigger"
            onClick={() => setTemplateFormOpen(!templateFormOpen)}
          >
            <Save size={13} />
            淇濆瓨褰撳墠涓烘ā鏉?          </button>
        </div>
        {templateFormOpen && (
          <div className="log-template-save-row">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="妯℃澘鍚嶇О锛屼緥濡傦細瀹㈡埛鍥炶"
            />
            <button type="button" className="primary-button" onClick={addCustomTemplate}>
              淇濆瓨妯℃澘
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setTemplateFormOpen(false);
                setTemplateName('');
              }}
            >
              鍙栨秷
            </button>
          </div>
        )}
      </div>
      <label className="log-content-field">
        <span>宸ヤ綔鍐呭</span>
        <textarea
          required
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          placeholder="璁板綍鏈瀹屾垚鐨勪簨鎯呫€佹矡閫氱粨鏋溿€佸鐞嗚繃绋嬫垨闃舵缁撹"
        />
      </label>
      {inferredNextStep && (
        <div className="log-next-suggestion">
          <div>
            <Sparkles size={14} />
            <span>璇嗗埆鍒板彲鑳界殑涓嬩竴姝?/span>
          </div>
          <p>{inferredNextStep}</p>
          <button
            type="button"
            className="ghost-button tiny"
            onClick={() => {
              setForm({ ...form, nextStep: inferredNextStep });
              setDetailsOpen(true);
              setDraftStatus('宸插～鍏ヤ笅涓€姝ヨ鍒掞紝璁板綍鍚庡彲鍦ㄦ椂闂寸嚎杞负浠诲姟銆?);
            }}
          >
            濉叆涓嬩竴姝ヨ鍒?          </button>
        </div>
      )}
      <div className="log-quick-fields">
        <label>
          <span>鑰楁椂锛堝皬鏃讹級</span>
          <input
            type="number"
            min="0"
            step="0.25"
            value={form.hours}
            onChange={(event) => setForm({ ...form, hours: event.target.value })}
            placeholder="渚嬪 1.5"
          />
        </label>
        <label>
          <span>褰撴椂杩涘害</span>
          <div className="log-progress-input">
            <input
              type="number"
              min="0"
              max="100"
              value={form.progressSnapshot}
              onChange={(event) => setForm({ ...form, progressSnapshot: event.target.value })}
            />
            <span>%</span>
          </div>
        </label>
      </div>
      <div className="log-progress-presets" aria-label="杩涘害蹇嵎璁剧疆">
        {[0, 25, 50, 75, 100].map((value) => (
          <button
            type="button"
            key={value}
            className={Number(form.progressSnapshot) === value ? 'active' : ''}
            onClick={() => setForm({ ...form, progressSnapshot: String(value) })}
          >
            {value}%
          </button>
        ))}
      </div>
      <button type="button" className="log-details-toggle" onClick={() => setDetailsOpen(!detailsOpen)}>
        {detailsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {detailsOpen ? '鏀惰捣琛ュ厖璇︽儏' : '琛ュ厖鏃ユ湡銆佷笅涓€姝ュ拰闄勪欢'}
      </button>
      {detailsOpen && (
        <div className="log-extra-fields">
          <div className="form-grid">
            <label>
              鏃ユ湡
              <input
                type="date"
                value={form.logDate}
                onChange={(event) => setForm({ ...form, logDate: event.target.value })}
              />
            </label>
            <label>
              璁板綍闃舵
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
                {columnStatuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
          </div>
          <label>
            涓嬩竴姝ヨ鍒?            <input
              value={form.nextStep}
              onChange={(event) => setForm({ ...form, nextStep: event.target.value })}
              placeholder="涓嬩竴姝ヨ缁х画澶勭悊浠€涔?
            />
          </label>
          <div className="log-attachment-fields">
            <label className="file-picker">
              <Upload size={15} />
              <span>{files.length ? `宸查€夋嫨 ${files.length} 涓檮浠禶 : '閫夋嫨鏈樁娈靛浘鐗囨垨鏂囦欢'}</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={attachmentAccept}
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
            </label>
            <input
              value={attachmentNote}
              onChange={(event) => setAttachmentNote(event.target.value)}
              placeholder="闄勪欢澶囨敞锛屼緥濡傦細鍚堝悓鎵弿浠躲€佸鎴锋埅鍥俱€侀樁娈佃祫鏂?
            />
          </div>
          {files.length > 0 && (
            <div className="note-pending-file-warning"><AlertTriangle size={13} />{files.length} 涓檮浠跺皢鍦ㄦ彁浜ゆ棩蹇楀悗涓婁紶</div>
          )}
        </div>
      )}
      <button className="icon-button primary full" disabled={saving}>
        <Plus size={16} />
        {saving ? '姝ｅ湪璁板綍...' : '璁板綍鏃ュ織'}
      </button>
    </form>
  );
}

function LogSnapshotPreview({ title, snapshot }) {
  if (!snapshot) return null;
  return (
    <div className="log-version-snapshot">
      <strong>{title}</strong>
      <dl>
        <dt>鏃ユ湡</dt>
        <dd>{snapshot.logDate || '-'}</dd>
        <dt>闃舵</dt>
        <dd>{statusLabels[snapshot.stage] || snapshot.stage || '-'}</dd>
        <dt>鑰楁椂</dt>
        <dd>{Number(snapshot.hours || 0)}h</dd>
        <dt>杩涘害</dt>
        <dd>{Number(snapshot.progressSnapshot || 0)}%</dd>
      </dl>
      <p>{snapshot.content || '鏃犲唴瀹?}</p>
      {snapshot.nextStep && <em>涓嬩竴姝ワ細{snapshot.nextStep}</em>}
    </div>
  );
}

function LogVersionHistory({ versions, loading, error, onRefresh }) {
  return (
    <section className="log-version-history">
      <div className="section-title-row">
        <div>
          <span>缂栬緫鍘嗗彶</span>
          <h3>淇敼鍓嶅悗璁板綍</h3>
        </div>
        <button type="button" className="round-button small" onClick={onRefresh} title="鍒锋柊鍘嗗彶">
          <RefreshCw size={13} />
        </button>
      </div>
      {loading && <div className="empty-column">姝ｅ湪鍔犺浇缂栬緫鍘嗗彶...</div>}
      {error && <div className="notice">{error}</div>}
      {!loading && !error && !versions.length && (
        <div className="empty-column">鏆傛棤缂栬緫鍘嗗彶</div>
      )}
      {!loading && !error && versions.map((version, index) => (
        <details className="log-version-item" key={version.id} open={index === 0}>
          <summary>
            <span>{version.createdAt}</span>
            <em>{version.source === 'ai_format' ? 'AI 鏁寸悊' : version.source === 'restore' ? '鍥為€€' : '鎵嬪姩缂栬緫'}</em>
          </summary>
          {version.changeNote && <p className="log-version-note">{version.changeNote}</p>}
          <div className="log-version-snapshots">
            <LogSnapshotPreview title="淇敼鍓? snapshot={version.before} />
            <LogSnapshotPreview title="淇敼鍚? snapshot={version.after} />
          </div>
        </details>
      ))}
    </section>
  );
}

function LogEditDrawer({ task, log, askConfirm, addToast, onClose, onChanged }) {
  const [form, setForm] = useState(() => createLogForm(task, log));
  const [savedForm, setSavedForm] = useState(() => createLogForm(task, log));
  const [currentLog, setCurrentLog] = useState(log);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const draftKey = useMemo(() => logDraftStorageKey(task.id, log.id), [task.id, log.id]);

  async function loadLogVersions() {
    setVersionsLoading(true);
    setVersionsError('');
    try {
      const data = await api.getLogVersions(log.id);
      setVersions(data);
    } catch (err) {
      setVersionsError(err.message);
    } finally {
      setVersionsLoading(false);
    }
  }

  useEffect(() => {
    setDraftReady(false);
    const initial = createLogForm(task, log);
    let next = initial;
    let restoredAt = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.form && isMeaningfulLogDraft(draft.form)) {
          next = normalizeLogDraftForm(draft.form, task, log);
          restoredAt = draft.savedAt;
        }
      }
    } catch {
      // Editing remains available when local storage is unavailable.
    }
    setCurrentLog(log);
    setForm(next);
    setSavedForm(initial);
    setDraftStatus(restoredAt ? `宸叉仮澶嶆湭淇濆瓨淇敼 ${formatDraftTime(restoredAt)}` : '');
    setDraftReady(true);
  }, [draftKey, log.id]);

  useEffect(() => {
    loadLogVersions();
  }, [log.id]);

  useEffect(() => {
    if (!draftReady || saving) return undefined;
    const changed = JSON.stringify(form) !== JSON.stringify(savedForm);
    if (!changed) {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Ignore unavailable local storage.
      }
      return undefined;
    }
    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt, form }));
        setDraftStatus(`淇敼鑽夌宸蹭繚瀛?${formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('鑽夌鏃犳硶鑷姩淇濆瓨');
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftKey, draftReady, form, savedForm, saving]);

  async function saveLog(event) {
    event.preventDefault();
    if (!form.content.trim()) {
      addToast('error', '鍑洪敊浜?, '鎿嶄綔澶辫触锛岃绋嶅悗閲嶈瘯銆?);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateLog(log.id, {
        ...form,
        hours: Number(form.hours || 0),
        progressSnapshot: Number(form.progressSnapshot || 0),
      });
      setCurrentLog({ ...currentLog, ...updated, attachments: currentLog.attachments || [] });
      setSavedForm(form);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // The saved API record is authoritative.
      }
      setDraftStatus('淇敼宸蹭繚瀛?);
      await onChanged();
      await loadLogVersions();
      addToast('success', '瀹屾垚', '鎿嶄綔宸插畬鎴愩€?);
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshAttachments() {
    try {
      const logs = await api.getLogs(task.id);
      const refreshed = logs.find((item) => item.id === log.id);
      if (refreshed) setCurrentLog(refreshed);
      await onChanged();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  return (
    <>
      <div className="log-editor-overlay" onClick={onClose} />
      <aside className="log-editor-drawer" aria-label="缂栬緫宸ヤ綔鏃ュ織">
        <div className="log-editor-head">
          <div>
            <span className={`stage-pill ${currentLog.stage}`}>{statusLabels[currentLog.stage]}</span>
            <h2>缂栬緫宸ヤ綔鏃ュ織</h2>
            <p>淇敼鍘嗗彶璁板綍涓嶄細鏀瑰彉浠诲姟褰撳墠杩涘害</p>
          </div>
          <button className="round-button small" type="button" onClick={onClose} title="鍏抽棴缂栬緫">
            <X size={16} />
          </button>
        </div>
        <form className="log-edit-form" onSubmit={saveLog}>
          {draftStatus && <span className="note-draft-status" aria-live="polite"><Clock3 size={13} />{draftStatus}</span>}
          <div className="form-grid">
            <label>
              鏃ユ湡
              <input type="date" value={form.logDate} onChange={(event) => setForm({ ...form, logDate: event.target.value })} />
            </label>
            <label>
              闃舵
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
                {columnStatuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
          </div>
          <label>
            宸ヤ綔鍐呭
            <textarea required value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          </label>
          <div className="form-grid">
            <label>
              鑰楁椂锛堝皬鏃讹級
              <input type="number" min="0" step="0.25" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} />
            </label>
            <label>
              褰撴椂杩涘害锛?input type="number" min="0" max="100" value={form.progressSnapshot} onChange={(event) => setForm({ ...form, progressSnapshot: event.target.value })} />
            </label>
          </div>
          <label>
            涓嬩竴姝ヨ鍒?            <input
              value={form.nextStep}
              onChange={(event) => setForm({ ...form, nextStep: event.target.value })}
              placeholder="涓嬩竴姝ヨ缁х画澶勭悊浠€涔?
            />
          </label>
          <div className="log-edit-actions">
            <button className="ghost-button" type="button" onClick={onClose}><ChevronLeft size={15} />鍏抽棴</button>
            <button className="icon-button primary" disabled={saving}><Save size={15} />{saving ? '淇濆瓨涓?..' : '淇濆瓨淇敼'}</button>
          </div>
        </form>
        <LogVersionHistory
          versions={versions}
          loading={versionsLoading}
          error={versionsError}
          onRefresh={loadLogVersions}
        />
        <section className="log-editor-attachments">
          <div className="section-title-row">
            <div>
              <span>闄勪欢</span>
              <h3>闃舵鏂囦欢涓庡娉?/h3>
            </div>
            <span>{currentLog.attachments?.length || 0} 涓?/span>
          </div>
          <AttachmentPanel log={currentLog} askConfirm={askConfirm} addToast={addToast} onChanged={refreshAttachments} />
        </section>
      </aside>
    </>
  );
}

function SystemView({ addToast }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);

  async function loadBackups() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getBackups();
      setBackups(data.backups || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBackups();
  }, []);

  async function createBackupNow() {
    setBusy('create');
    setError('');
    setVerifyResult(null);
    try {
      const result = await api.createBackup();
      addToast?.('success', '澶囦唤瀹屾垚', `宸插垱寤哄浠斤細${result.backupDir}`);
      await loadBackups();
    } catch (err) {
      setError(err.message);
      addToast?.('error', '鍑洪敊浜?, err.message);
    } finally {
      setBusy('');
    }
  }

  async function verifyLatest() {
    setBusy('verify');
    setError('');
    try {
      const result = await api.verifyBackup(backups[0]?.backupDir || '');
      setVerifyResult(result);
      if (result.status === 'ok') {
        addToast?.('success', '鏍￠獙閫氳繃', '鏈€杩戝浠芥枃浠跺畬鏁淬€?);
      } else {
        addToast?.('error', '鏍￠獙鏈€氳繃', `鍙戠幇 ${result.problems?.length || 0} 涓棶棰樸€俙);
      }
    } catch (err) {
      setError(err.message);
      addToast?.('error', '鍑洪敊浜?, err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="system-page">
      <div className="system-head">
        <div>
          <span>鏁版嵁瀹夊叏</span>
          <h2>绯荤粺涓庡浠?/h2>
          <p>澶囦唤浼氬鍑?MySQL 鏍稿績琛ㄥ苟澶嶅埗 uploads 鏂囦欢锛涙仮澶嶄粛璇蜂娇鐢ㄥ懡浠よ棰勬紨纭鍚庢墽琛屻€?/p>
        </div>
        <div className="system-actions">
          <button type="button" className="ghost-button" onClick={loadBackups} disabled={loading || Boolean(busy)}>
            <RefreshCw size={15} />
            鍒锋柊
          </button>
          <button type="button" className="ghost-button" onClick={verifyLatest} disabled={loading || Boolean(busy) || !backups.length}>
            <ShieldCheck size={15} />
            {busy === 'verify' ? '鏍￠獙涓?..' : '鏍￠獙鏈€杩戝浠?}
          </button>
          <button type="button" className="icon-button primary" onClick={createBackupNow} disabled={Boolean(busy)}>
            <Save size={15} />
            {busy === 'create' ? '澶囦唤涓?..' : '鍒涘缓澶囦唤'}
          </button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {verifyResult && (
        <div className={verifyResult.status === 'ok' ? 'system-verify ok' : 'system-verify error'}>
          <strong>{verifyResult.status === 'ok' ? '澶囦唤鏍￠獙閫氳繃' : '澶囦唤鏍￠獙鍙戠幇闂'}</strong>
          <span>妫€鏌ユ枃浠?{verifyResult.checkedFiles || 0} 涓?路 闂 {verifyResult.problems?.length || 0} 涓?/span>
          {verifyResult.problems?.length > 0 && (
            <ul>
              {verifyResult.problems.slice(0, 6).map((item) => (
                <li key={item.path}>{item.path}锛歿item.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="backup-list">
        {loading && <div className="empty-column">姝ｅ湪鍔犺浇澶囦唤鍒楄〃</div>}
        {!loading && !backups.length && <div className="empty-column">鏆傛棤澶囦唤锛屽缓璁厛鍒涘缓涓€娆″浠姐€?/div>}
        {backups.map((backup) => {
          const totalRows = (backup.tables || []).reduce((sum, item) => sum + Number(item.rows || 0), 0);
          return (
            <article className="backup-card" key={backup.backupDir}>
              <div>
                <strong>{backup.name}</strong>
                <span>{backup.createdAtChina || backup.createdAt}</span>
              </div>
              <dl>
                <div>
                  <dt>鏁版嵁琛?/dt>
                  <dd>{backup.tables?.length || 0} 寮?路 {totalRows} 琛?/dd>
                </div>
                <div>
                  <dt>闄勪欢</dt>
                  <dd>{backup.uploads?.count || 0} 涓?路 {formatFileSize(backup.uploads?.totalBytes || 0)}</dd>
                </div>
                <div>
                  <dt>鏍￠獙鏂囦欢</dt>
                  <dd>{backup.files || 0} 涓?/dd>
                </div>
                <div>
                  <dt>鐩綍</dt>
                  <dd>{backup.backupDir}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function reportSummaryTypeLabel(type) {
  if (type === 'weekly') return '鍛ㄦ姤';
  if (type === 'stage') return '闃舵鎬荤粨';
  return '鏃ユ姤';
}

function ReportView({ dates, onDatesChange, addToast, onNoteSaved }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryType, setAiSummaryType] = useState('daily');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [savedSummaryNoteId, setSavedSummaryNoteId] = useState(null);

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getReport(dates.from, dates.to);
      setReport(data);
      setAiSummary(null);
      setAiError('');
      setSavedSummaryNoteId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [dates.from, dates.to]);

  async function generateAiSummary(type) {
    setAiSummaryType(type);
    setAiLoading(true);
    setAiError('');
    try {
      const data = await api.getAiReportSummary({
        from: dates.from,
        to: dates.to,
        type,
      });
      setAiSummary(data);
      setSavedSummaryNoteId(null);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  async function saveAiSummaryAsNote() {
    if (!aiSummary?.html || noteSaving) return;
    setNoteSaving(true);
    try {
      const label = reportSummaryTypeLabel(aiSummary.type || aiSummaryType);
      const plain = [
        `AI${label}`,
        `鏃堕棿鑼冨洿锛?{aiSummary.from} 鑷?${aiSummary.to}`,
        '',
        aiContentToPlainText(aiSummary.html),
      ].filter(Boolean).join('\n');
      const contentJson = textToRichDoc(plain);
      const note = await api.createStandaloneNote({
        title: `${label}锛?{aiSummary.from} 鑷?${aiSummary.to}`,
        category: 'AI姹囨€?,
        content: plain,
        contentJson,
      });
      setSavedSummaryNoteId(note.id);
      addToast?.('success', '宸蹭繚瀛?, 'AI 姹囨€诲凡淇濆瓨涓虹嫭绔嬬瑪璁般€?);
      await onNoteSaved?.(note);
    } catch (err) {
      addToast?.('error', '鍑洪敊浜?, err.message);
      setAiError(err.message);
    } finally {
      setNoteSaving(false);
    }
  }

  const markdownExportUrl = api.workspaceExportUrl({
    from: dates.from,
    to: dates.to,
    format: 'markdown',
  });
  const excelExportUrl = api.workspaceExportUrl({
    from: dates.from,
    to: dates.to,
    format: 'excel',
  });
  const pdfExportUrl = api.workspaceExportUrl({
    from: dates.from,
    to: dates.to,
    format: 'pdf',
  });

  return (
    <section className="report">
      <div className="report-toolbar">
        <label>
          <CalendarDays size={16} />
          <span></span>
          <input
            type="date"
            value={dates.from}
            onChange={(event) => onDatesChange({ ...dates, from: event.target.value })}
            style={{ width: 'auto' }}
          />
        </label>
        <label>
          <CalendarDays size={16} />
          <span></span>
          <input
            type="date"
            value={dates.to}
            onChange={(event) => onDatesChange({ ...dates, to: event.target.value })}
            style={{ width: 'auto' }}
          />
        </label>
        <button className="ghost-button" onClick={loadReport} disabled={loading}>
          <RefreshCw size={16} />
          鍒锋柊
        </button>
        <div className="report-export-actions" aria-label="瀵煎嚭褰撳墠姹囨€?>
          <a className="ghost-button" href={markdownExportUrl}>
            <Download size={16} />
            瀵煎嚭 Markdown
          </a>
          <a className="ghost-button" href={excelExportUrl}>
            <Download size={16} />
            瀵煎嚭 Excel
          </a>
          <a className="ghost-button" href={pdfExportUrl}>
            <Download size={16} />
            瀵煎嚭 PDF
          </a>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {report && (
        <>
          <section className="ai-report-summary-panel">
            <div className="ai-report-summary-head">
              <div>
                <span>AI 姹囨€?/span>
                <h2>鐢熸垚鏃ユ姤銆佸懆鎶ユ垨闃舵鎬荤粨</h2>
              </div>
              <div className="ai-report-actions">
                {[
                  ['daily', '鐢熸垚鏃ユ姤'],
                  ['weekly', '鐢熸垚鍛ㄦ姤'],
                  ['stage', '闃舵鎬荤粨'],
                ].map(([type, label]) => (
                  <button
                    type="button"
                    key={type}
                    className={aiSummaryType === type ? 'ghost-button active' : 'ghost-button'}
                    onClick={() => generateAiSummary(type)}
                    disabled={aiLoading}
                  >
                    <Sparkles size={14} />
                    {aiLoading && aiSummaryType === type ? '鐢熸垚涓?..' : label}
                  </button>
                ))}
              </div>
            </div>
            {aiError && <div className="notice">{aiError}</div>}
            {aiSummary && (
              <div className="ai-report-result">
                <div className="ai-report-result-head">
                  <span>{aiSummary.from} 鑷?{aiSummary.to}</span>
                  <div className="ai-report-result-actions">
                    <CopyButton
                      value={aiContentToPlainText(aiSummary.html)}
                      label="澶嶅埗鎬荤粨"
                      copiedLabel="宸插鍒?
                      className="ghost-button"
                    />
                    <button
                      type="button"
                      className={savedSummaryNoteId ? 'ghost-button active' : 'ghost-button'}
                      onClick={saveAiSummaryAsNote}
                      disabled={noteSaving || Boolean(savedSummaryNoteId)}
                    >
                      <Save size={14} />
                      {noteSaving ? '淇濆瓨涓?..' : savedSummaryNoteId ? '宸蹭繚瀛樹负绗旇' : '淇濆瓨涓虹瑪璁?}
                    </button>
                  </div>
                </div>
                <div
                  className="ai-html-content"
                  dangerouslySetInnerHTML={{ __html: toSafeAiHtml(aiSummary.html) }}
                />
              </div>
            )}
          </section>
          <div className="report-grid">
            <Stat label="璁板綍鏃ュ織鏉℃暟" value={report.logs.length} />
            <Stat label="绱鎶曞叆鏃堕暱" value={`${report.totalHours}h`} />
            <Stat label="娑夊強浠诲姟涓暟" value={report.byTask.length} />
            <Stat label="瀹屾垚鍏抽棴浠诲姟" value={report.completedTasks.length} />
          </div>
          <div className="report-sections">
            <ReportPanel title="瀹屾垚鍐呭">
              {report.logs.map((log) => (
                <div className="report-line" key={log.id}>
                  <strong>{log.taskTitle}</strong>
                  <span>{log.content}</span>
                  <em>{log.logDate} 路 {log.hours}h 路 褰撴椂杩涘害 {log.progressSnapshot}%</em>
                </div>
              ))}
              {!report.logs.length && <div className="empty-column">璇ユ椂鏈熸棤宸ヤ綔璁板綍</div>}
            </ReportPanel>
            <ReportPanel title="杩涜涓换鍔?>
              {report.activeTasks.map((task) => (
                <div className="report-line" key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{statusLabels[task.status]} 路 杩涘害宸茶揪 {task.progress}%</span>
                  <em>鎴鏃ユ湡{formatDate(task.dueDate)}</em>
                </div>
              ))}
              {!report.activeTasks.length && <div className="empty-column">鏃犳椿鍔ㄤ腑鐨勬湭瀹屾垚浠诲姟</div>}
            </ReportPanel>
            <ReportPanel title="涓嬩竴姝ヨ鍒?>
              {report.nextSteps.map((log) => (
                <div className="report-line" key={`${log.id}-next`}>
                  <strong>{log.taskTitle}</strong>
                  <span>{log.nextStep}</span>
                  <em>璺熻繘璁板綍鏃ユ湡{log.logDate}</em>
                </div>
              ))}
              {!report.nextSteps.length && <div className="empty-column">鏃犱笅涓€姝ュ緟鍔為」</div>}
            </ReportPanel>
          </div>
        </>
      )}
    </section>
  );
}

function ReportPanel({ title, children }) {
  return (
    <section className="report-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function attachmentItemKey(item) {
  return `${item.kind}:${item.id}`;
}

function AttachmentCenterView({ tasks, onOpenTask, onOpenNotes, addToast, askConfirm }) {
  const [filters, setFilters] = useState({
    kind: 'all',
    search: '',
    taskId: '',
    fileType: 'all',
    textStatus: 'all',
    from: '',
    to: '',
  });
  const [viewMode, setViewMode] = useState('list');
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [previewItem, setPreviewItem] = useState(null);

  async function loadAttachments(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const nextData = await api.getAttachmentCenter({ ...nextFilters, limit: 160 });
      setData(nextData);
      const visibleKeys = new Set((nextData.items || []).map(attachmentItemKey));
      setSelectedKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttachments(filters);
  }, [filters.kind, filters.taskId, filters.fileType, filters.textStatus]);

  function updateFilter(patch) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function openSource(item) {
    if (item.noteId) {
      onOpenNotes(item.noteId, { includeLinked: true });
      addToast('success', '宸插畾浣嶇瑪璁?, '宸茶烦杞埌闄勪欢鍏宠仈鐨勭瑪璁般€?);
      return;
    }
    if (item.taskId) {
      const task = tasks.find((entry) => entry.id === item.taskId);
      if (task) {
        onOpenTask(task, item.kind === 'task' ? 'attachments' : item.kind === 'log' ? 'logs' : 'notes');
        return;
      }
      addToast('info', '鎻愮ず', '褰撳墠绛涢€変笅鏈姞杞借浠诲姟锛屽彲鍦ㄧ湅鏉挎竻闄ょ瓫閫夊悗鍐嶆墦寮€銆?);
      return;
    }
  }

  const counts = useMemo(() => {
    const result = { all: data.items?.length || 0, task: 0, log: 0, note: 0 };
    (data.items || []).forEach((item) => {
      result[item.kind] = (result[item.kind] || 0) + 1;
    });
    return result;
  }, [data.items]);
  const imageItems = useMemo(() => (data.items || []).filter((item) => item.attachment?.isImage), [data.items]);
  const selectedItems = useMemo(
    () => (data.items || []).filter((item) => selectedKeys.has(attachmentItemKey(item))),
    [data.items, selectedKeys],
  );
  const allVisibleSelected = Boolean(data.items?.length) && data.items.every((item) => selectedKeys.has(attachmentItemKey(item)));

  function toggleAttachmentSelection(item) {
    const key = attachmentItemKey(item);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const keys = (data.items || []).map(attachmentItemKey);
      const shouldClear = keys.length && keys.every((key) => next.has(key));
      keys.forEach((key) => {
        if (shouldClear) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  }

  async function moveSelectedToTrash() {
    if (!selectedItems.length) return;
    const ok = askConfirm
      ? await askConfirm(
        '绉诲叆闄勪欢鍥炴敹绔?,
        `纭畾瑕佹妸閫変腑鐨?${selectedItems.length} 涓檮浠剁Щ鍏ュ洖鏀剁珯鍚楋紵鏂囦欢浼氫繚鐣欏湪鏈満锛屽彲鍦ㄥ洖鏀剁珯鎭㈠銆俙,
      )
      : true;
    if (!ok) return;
    try {
      const result = await api.moveAttachmentsToTrash(
        selectedItems.map((item) => ({ kind: item.kind, id: item.id })),
        '闄勪欢涓績鎵归噺绉诲叆鍥炴敹绔?,
      );
      setSelectedKeys(new Set());
      addToast('success', '宸茬Щ鍏ュ洖鏀剁珯', `宸插鐞?${result.moved || 0} 涓檮浠躲€俙);
      await loadAttachments();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  async function retrySelectedOcr() {
    if (!selectedItems.length) return;
    const retryItems = selectedItems.filter((item) => item.attachment?.textStatus !== 'processing');
    if (!retryItems.length) {
      addToast('info', '鏃犻渶閲嶈瘯', '閫変腑鐨勯檮浠跺綋鍓嶆鍦ㄨ瘑鍒腑銆?);
      return;
    }
    try {
      const results = await Promise.allSettled(
        retryItems.map((item) => api.reextractAttachment(item.kind, item.id)),
      );
      const okCount = results.filter((result) => result.status === 'fulfilled').length;
      const failCount = results.length - okCount;
      addToast(
        failCount ? 'warning' : 'success',
        '宸叉彁浜よ瘑鍒?,
        failCount ? `宸叉彁浜?${okCount} 涓紝${failCount} 涓彁浜ゅけ璐ャ€俙 : `宸叉彁浜?${okCount} 涓檮浠堕噸鏂拌瘑鍒€俙,
      );
      await loadAttachments();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    }
  }

  function openImagePreview(item) {
    if (item.attachment?.isImage && item.attachment?.previewUrl) {
      setPreviewItem(item);
    }
  }

  return (
    <section className="attachment-center-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">鏂囦欢璧勬枡</p>
          <h2>闄勪欢涓績</h2>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadAttachments()} disabled={loading}>
          <RefreshCw size={16} />
          鍒锋柊
        </button>
      </div>

      <div className="attachment-center-toolbar">
        <div className="attachment-kind-tabs" role="tablist" aria-label="闄勪欢绫诲瀷">
          {[
            ['all', '鍏ㄩ儴'],
            ['task', '浠诲姟闄勪欢'],
            ['log', '鏃ュ織闄勪欢'],
            ['note', '绗旇闄勪欢'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filters.kind === value ? 'active' : ''}
              onClick={() => updateFilter({ kind: value })}
            >
              {label}
              <span>{counts[value] || 0}</span>
            </button>
          ))}
        </div>
        <label className="attachment-search-field">
          <Search size={15} />
          <input
            value={filters.search}
            onChange={(event) => updateFilter({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') loadAttachments();
            }}
            placeholder="鎼滅储鏂囦欢鍚嶃€佸娉ㄦ垨鏉ユ簮..."
          />
        </label>
        <label>
          <span>浠诲姟</span>
          <select value={filters.taskId} onChange={(event) => updateFilter({ taskId: event.target.value })}>
            <option value="">鍏ㄩ儴浠诲姟</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </label>
        <label>
          <span>绫诲瀷</span>
          <select value={filters.fileType} onChange={(event) => updateFilter({ fileType: event.target.value })}>
            <option value="all">鍏ㄩ儴鏂囦欢</option>
            <option value="image">鍥剧墖</option>
            <option value="pdf">PDF</option>
            <option value="document">Word/鏂囨。</option>
            <option value="spreadsheet">Excel/琛ㄦ牸</option>
            <option value="archive">鍘嬬缉鍖?/option>
            <option value="other">鍏朵粬</option>
          </select>
        </label>
        <label>
          <span>璇嗗埆</span>
          <select value={filters.textStatus} onChange={(event) => updateFilter({ textStatus: event.target.value })}>
            <option value="all">鍏ㄩ儴鐘舵€?/option>
            <option value="completed">宸茶瘑鍒?/option>
            <option value="pending">寰呰瘑鍒?/option>
            <option value="processing">璇嗗埆涓?/option>
            <option value="failed">璇嗗埆澶辫触</option>
            <option value="unsupported">涓嶆敮鎸?/option>
            <option value="none">鏈叆闃?/option>
          </select>
        </label>
        <label>
          <span>寮€濮?/span>
          <input type="date" value={filters.from} onChange={(event) => updateFilter({ from: event.target.value })} />
        </label>
        <label>
          <span>缁撴潫</span>
          <input type="date" value={filters.to} onChange={(event) => updateFilter({ to: event.target.value })} />
        </label>
        <button className="ghost-button" type="button" onClick={() => loadAttachments()} disabled={loading}>
          <ListFilter size={15} />
          绛涢€?        </button>
        <div className="attachment-view-toggle" role="group" aria-label="闄勪欢鏄剧ず鏂瑰紡">
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            <ListFilter size={14} />
            鍒楄〃
          </button>
          <button
            type="button"
            className={viewMode === 'images' ? 'active' : ''}
            onClick={() => setViewMode('images')}
          >
            <ImageIcon size={14} />
            鍥剧墖澧?            <span>{imageItems.length}</span>
          </button>
        </div>
      </div>

      <div className="attachment-bulk-bar">
        <button className="ghost-button" type="button" onClick={toggleSelectAllVisible} disabled={!data.items?.length || loading}>
          <CheckCircle2 size={15} />
          {allVisibleSelected ? '鍙栨秷鍏ㄩ€? : '閫夋嫨褰撳墠椤?}
        </button>
        <span>宸查€夋嫨 {selectedItems.length} 涓檮浠?/span>
        <button
          className="danger-button"
          type="button"
          onClick={moveSelectedToTrash}
          disabled={!selectedItems.length || loading}
        >
          <Trash2 size={15} />
          绉诲叆鍥炴敹绔?        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={retrySelectedOcr}
          disabled={!selectedItems.length || loading}
        >
          <RefreshCw size={15} />
          閲嶈瘯璇嗗埆
        </button>
        {selectedItems.length > 0 && (
          <button className="ghost-button" type="button" onClick={() => setSelectedKeys(new Set())}>
            娓呯┖閫夋嫨
          </button>
        )}
      </div>

      {error && <div className="notice">{error}</div>}
      {loading ? (
        <div className="empty-column">姝ｅ湪璇诲彇闄勪欢...</div>
      ) : viewMode === 'images' ? (
        imageItems.length ? (
          <div className="attachment-image-wall">
            {imageItems.map((item) => (
              <AttachmentImageTile
                key={`${item.kind}-${item.id}`}
                item={item}
                onOpenSource={openSource}
                selected={selectedKeys.has(attachmentItemKey(item))}
                onToggleSelect={toggleAttachmentSelection}
                onPreviewImage={openImagePreview}
              />
            ))}
          </div>
        ) : (
          <div className="empty-column">褰撳墠绛涢€変笅鏆傛棤鍥剧墖</div>
        )
      ) : data.items?.length ? (
        <div className="attachment-center-grid">
          {data.items.map((item) => (
            <AttachmentCenterCard
              key={`${item.kind}-${item.id}`}
              item={item}
              onOpenSource={openSource}
              addToast={addToast}
              onChanged={loadAttachments}
              selected={selectedKeys.has(attachmentItemKey(item))}
              onToggleSelect={toggleAttachmentSelection}
              onPreviewImage={openImagePreview}
            />
          ))}
        </div>
      ) : (
        <div className="empty-column">鏆傛棤闄勪欢</div>
      )}
      {previewItem && (
        <div className="attachment-preview-overlay" role="dialog" aria-modal="true" onClick={() => setPreviewItem(null)}>
          <div className="attachment-preview-shell" onClick={(event) => event.stopPropagation()}>
            <div className="attachment-preview-head">
              <div>
                <strong>{previewItem.attachment?.originalName || '鍥剧墖棰勮'}</strong>
                <span>{previewItem.sourceTitle || previewItem.taskTitle || previewItem.sourceLabel}</span>
              </div>
              <div>
                <a className="ghost-button" href={previewItem.attachment?.downloadUrl}>
                  <Download size={15} />
                  涓嬭浇
                </a>
                <button className="round-button small" type="button" onClick={() => setPreviewItem(null)} title="鍏抽棴">
                  <X size={15} />
                </button>
              </div>
            </div>
            <img src={previewItem.attachment?.previewUrl} alt={previewItem.attachment?.originalName || '鍥剧墖棰勮'} />
          </div>
        </div>
      )}
    </section>
  );
}

function AttachmentImageTile({ item, onOpenSource, selected, onToggleSelect, onPreviewImage }) {
  const attachment = item.attachment || {};
  return (
    <article className={selected ? 'attachment-image-tile selected' : 'attachment-image-tile'}>
      <label className="attachment-image-select" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item)}
          aria-label={`閫夋嫨闄勪欢 ${attachment.originalName || item.id}`}
        />
      </label>
      <a
        href={attachment.previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          onPreviewImage(item);
        }}
      >
        <img src={attachment.previewUrl} alt={attachment.originalName} />
      </a>
      <div>
        <strong>{attachment.originalName || '鍥剧墖闄勪欢'}</strong>
        <span>{formatFileSize(attachment.fileSize)} 路 {item.sourceLabel}</span>
      </div>
      <div className="attachment-image-actions">
        <button type="button" onClick={() => onOpenSource(item)}>
          <ExternalLink size={13} />
          鏉ユ簮
        </button>
        <a href={attachment.downloadUrl}>
          <Download size={13} />
          涓嬭浇
        </a>
      </div>
    </article>
  );
}

function AttachmentCenterCard({ item, onOpenSource, addToast, onChanged, selected, onToggleSelect, onPreviewImage }) {
  const attachment = item.attachment || {};
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(attachment.note || '');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    setNoteDraft(attachment.note || '');
    setEditingNote(false);
  }, [attachment.id, attachment.note]);

  async function saveNote() {
    setSavingNote(true);
    try {
      await api.updateCenterAttachment(item.kind, item.id, { note: noteDraft });
      addToast('success', '宸蹭繚瀛?, '闄勪欢澶囨敞宸叉洿鏂般€?);
      setEditingNote(false);
      await onChanged?.();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <article className={selected ? 'attachment-center-card selected' : 'attachment-center-card'}>
      {attachment.isImage && attachment.previewUrl ? (
        <a
          className="attachment-center-preview"
          href={attachment.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            onPreviewImage(item);
          }}
        >
          <img src={attachment.previewUrl} alt={attachment.originalName} />
        </a>
      ) : (
        <div className="attachment-center-file">
          <FileText size={22} />
        </div>
      )}
      <div className="attachment-center-body">
        <div className="attachment-center-title">
          <span className={`recycle-kind ${item.kind}`}>
            {item.kind === 'task' ? '浠诲姟闄勪欢' : item.kind === 'log' ? '鏃ュ織闄勪欢' : '绗旇闄勪欢'}
          </span>
          <h3>{attachment.originalName || '鏈懡鍚嶉檮浠?}</h3>
        </div>
        <div className="attachment-center-meta">
          <span>{formatFileSize(attachment.fileSize)}</span>
          <span>{attachment.mimeType || '鏂囦欢'}</span>
          <span>涓婁紶锛歿item.createdAt || '-'}</span>
          {item.logDate && <span>鏃ュ織锛歿formatDate(item.logDate)}</span>}
          {item.noteCategory && <span>鍒嗙被锛歿item.noteCategory}</span>}
        </div>
        <button className="attachment-source-button" type="button" onClick={() => onOpenSource(item)}>
          <ExternalLink size={14} />
          <span>{item.sourceTitle || item.taskTitle || '鎵撳紑鏉ユ簮'}</span>
        </button>
        <div className="attachment-note-box">
          {editingNote ? (
            <>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="鍐欎竴鐐归檮浠跺娉?.."
                rows={3}
              />
              <div>
                <button className="primary-button" type="button" onClick={saveNote} disabled={savingNote}>
                  <Save size={13} />
                  {savingNote ? '淇濆瓨涓?..' : '淇濆瓨澶囨敞'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setNoteDraft(attachment.note || '');
                    setEditingNote(false);
                  }}
                  disabled={savingNote}
                >
                  鍙栨秷
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={attachment.note ? '' : 'muted'}>{attachment.note || '鏆傛棤澶囨敞'}</p>
              <button className="round-button small" type="button" onClick={() => setEditingNote(true)} title="缂栬緫澶囨敞">
                <Edit3 size={13} />
              </button>
            </>
          )}
        </div>
        <AttachmentTextStatus
          attachment={attachment}
          kind={item.kind}
          addToast={addToast}
          onChanged={onChanged}
        />
      </div>
      <div className="attachment-center-actions">
        <label className="attachment-select-box" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(item)}
            aria-label={`閫夋嫨闄勪欢 ${attachment.originalName || item.id}`}
          />
          <span>{selected ? '宸查€? : '閫夋嫨'}</span>
        </label>
        {attachment.previewUrl && (
          attachment.isImage ? (
            <button className="round-button small" type="button" onClick={() => onPreviewImage(item)} title="棰勮">
              <ExternalLink size={13} />
            </button>
          ) : (
            <a className="round-button small" href={attachment.previewUrl} target="_blank" rel="noopener noreferrer" title="棰勮">
              <ExternalLink size={13} />
            </a>
          )
        )}
        <a className="round-button small" href={attachment.downloadUrl} title="涓嬭浇">
          <Download size={13} />
        </a>
      </div>
    </article>
  );
}

function RecycleBinView({ askConfirm, addToast, onChanged }) {
  const [type, setType] = useState('all');
  const [trash, setTrash] = useState({ tasks: [], logs: [], notes: [], attachments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const items = useMemo(() => {
    const merged = [
      ...(trash.tasks || []),
      ...(trash.logs || []),
      ...(trash.notes || []),
      ...(trash.attachments || []),
    ];
    return merged.sort((left, right) => String(right.deletedAt || '').localeCompare(String(left.deletedAt || '')));
  }, [trash]);

  async function loadTrash(nextType = type) {
    setLoading(true);
    setError('');
    try {
      setTrash(await api.getTrash(nextType));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrash(type);
  }, [type]);

  async function restoreItem(item) {
    const key = `restore-${item.type}-${item.kind || 'item'}-${item.id}`;
    setBusyKey(key);
    try {
      if (item.type === 'attachment') {
        await api.restoreTrashAttachment(item.kind, item.id);
      } else {
        await api.restoreTrashItem(item.type, item.id);
      }
      addToast('success', '宸叉仮澶?, '椤圭洰宸蹭粠鍥炴敹绔欐仮澶嶃€?);
      await loadTrash();
      await onChanged?.();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setBusyKey('');
    }
  }

  async function deleteForever(item) {
    const ok = await askConfirm(
      '纭褰诲簳鍒犻櫎',
      `纭畾瑕佸交搴曞垹闄も€?{item.title}鈥濆悧锛熻繖浼氭竻鐞嗘暟鎹簱璁板綍鍜岀浉鍏抽檮浠舵枃浠讹紝鏃犳硶浠庡洖鏀剁珯鎭㈠銆俙,
    );
    if (!ok) return;
    const key = `delete-${item.type}-${item.kind || 'item'}-${item.id}`;
    setBusyKey(key);
    try {
      if (item.type === 'attachment') {
        await api.permanentlyDeleteTrashAttachment(item.kind, item.id);
      } else {
        await api.permanentlyDeleteTrashItem(item.type, item.id);
      }
      addToast('success', '宸插交搴曞垹闄?, '椤圭洰宸蹭粠鍥炴敹绔欐案涔呯Щ闄ゃ€?);
      await loadTrash();
      await onChanged?.();
    } catch (err) {
      addToast('error', '鍑洪敊浜?, err.message);
    } finally {
      setBusyKey('');
    }
  }

  const counts = {
    all: (trash.tasks?.length || 0) + (trash.logs?.length || 0) + (trash.notes?.length || 0) + (trash.attachments?.length || 0),
    task: trash.tasks?.length || 0,
    log: trash.logs?.length || 0,
    note: trash.notes?.length || 0,
    attachment: trash.attachments?.length || 0,
  };

  return (
    <section className="recycle-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">鏁版嵁淇濇姢</p>
          <h2>鍥炴敹绔?/h2>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadTrash()} disabled={loading}>
          <RefreshCw size={16} />
          鍒锋柊
        </button>
      </div>
      <div className="recycle-tabs" role="tablist" aria-label="鍥炴敹绔欑被鍨?>
        {[
          ['all', '鍏ㄩ儴'],
          ['task', '浠诲姟'],
          ['log', '鏃ュ織'],
          ['note', '绗旇'],
          ['attachment', '闄勪欢'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={type === value ? 'active' : ''}
            onClick={() => setType(value)}
          >
            {label}
            <span>{counts[value]}</span>
          </button>
        ))}
      </div>
      {error && <div className="notice">{error}</div>}
      {loading ? (
        <div className="empty-column">姝ｅ湪璇诲彇鍥炴敹绔?..</div>
      ) : items.length ? (
        <div className="recycle-list">
          {items.map((item) => (
            <article className="recycle-card" key={`${item.type}-${item.kind || 'item'}-${item.id}`}>
              <div className="recycle-card-main">
                <span className={`recycle-kind ${item.type}`}>
                  {item.type === 'task'
                    ? '浠诲姟'
                    : item.type === 'log'
                      ? '鏃ュ織'
                      : item.type === 'note'
                        ? '绗旇'
                        : item.kind === 'task'
                          ? '浠诲姟闄勪欢'
                          : item.kind === 'log'
                            ? '鏃ュ織闄勪欢'
                            : '绗旇闄勪欢'}
                </span>
                <h3>{item.title}</h3>
                <p>{item.summary || '鏆傛棤鎽樿'}</p>
                <div className="recycle-meta">
                  <span>鍒犻櫎鏃堕棿锛歿item.deletedAt || '-'}</span>
                  {item.attachment && (
                    <span>{formatFileSize(item.attachment.fileSize)} 路 {item.attachment.mimeType || '鏂囦欢'}</span>
                  )}
                  {item.taskTitle && <span>鎵€灞炰换鍔★細{item.taskTitle}</span>}
                  {item.logDate && <span>鏃ュ織鏃ユ湡锛歿formatDate(item.logDate)}</span>}
                  {item.noteTitle && <span>鎵€灞炵瑪璁帮細{item.noteTitle}</span>}
                  {item.noteCategory && <span>鍒嗙被锛歿item.noteCategory}</span>}
                  {item.category && <span>鍒嗙被锛歿item.category}</span>}
                  {item.status && <span>鐘舵€侊細{statusLabels[item.status] || item.status}</span>}
                  {item.priority && <span>浼樺厛绾э細{priorityLabels[item.priority] || item.priority}</span>}
                  {item.counts && (
                    <span>鍏宠仈锛氭棩蹇?{item.counts.logs} 路 绗旇 {item.counts.notes} 路 闄勪欢 {item.counts.attachments}</span>
                  )}
                  {item.taskDeletedAt && <span className="warning-text">鎵€灞炰换鍔′篃鍦ㄥ洖鏀剁珯锛岃鍏堟仮澶嶄换鍔?/span>}
                  {item.logDeletedAt && <span className="warning-text">鎵€灞炴棩蹇椾篃鍦ㄥ洖鏀剁珯锛岃鍏堟仮澶嶆棩蹇?/span>}
                  {item.noteDeletedAt && <span className="warning-text">鎵€灞炵瑪璁颁篃鍦ㄥ洖鏀剁珯锛岃鍏堟仮澶嶇瑪璁?/span>}
                </div>
              </div>
              <div className="recycle-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => restoreItem(item)}
                  disabled={Boolean(busyKey)}
                >
                  <RotateCcw size={15} />
                  {busyKey === `restore-${item.type}-${item.kind || 'item'}-${item.id}` ? '鎭㈠涓?..' : '鎭㈠'}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => deleteForever(item)}
                  disabled={Boolean(busyKey)}
                >
                  <Trash2 size={15} />
                  {busyKey === `delete-${item.type}-${item.kind || 'item'}-${item.id}` ? '鍒犻櫎涓?..' : '褰诲簳鍒犻櫎'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-column">鍥炴敹绔欎负绌?/div>
      )}
    </section>
  );
}

// Custom confirmation dialog component
function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="confirm-backdrop">
      <div className="confirm-modal">
        <div className="confirm-icon">
          <AlertTriangle size={24} />
        </div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="ghost-button" onClick={onCancel}>
            鍙栨秷
          </button>
          <button className="icon-button primary danger-button" onClick={onConfirm} style={{ background: 'var(--high)', borderColor: 'var(--high)', color: '#fff' }}>
            纭鍒犻櫎
          </button>
        </div>
      </div>
    </div>
  );
}

// Toast components
function ToastContainer({ toasts, onClose }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }) {
  let Icon = Info;
  if (toast.type === 'success') Icon = CheckCircle2;
  if (toast.type === 'error') Icon = AlertTriangle;

  return (
    <article className={`toast-card ${toast.type}`}>
      <div className="toast-icon">
        <Icon size={18} />
      </div>
      <div className="toast-content">
        <h4>{toast.title}</h4>
        <p>{toast.message}</p>
      </div>
      <button className="toast-close" onClick={() => onClose(toast.id)}>
        <X size={14} />
      </button>
    </article>
  );
}

function PasswordLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!password.trim()) {
      setError('璇疯緭鍏ヨ闂瘑鐮併€?);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const status = await api.loginWithPassword(password);
      setPassword('');
      onLogin(status);
    } catch (err) {
      setError(err.message || '鐧诲綍澶辫触锛岃绋嶅悗閲嶈瘯銆?);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel password-auth-panel" onSubmit={handleSubmit}>
        <ShieldCheck size={32} aria-hidden="true" />
        <h1>涓汉浠诲姟鍙?/h1>
        <p>璇疯緭鍏ヨ闂瘑鐮佸悗缁х画绠＄悊浠诲姟銆佺瑪璁板拰宸ヤ綔鏃ュ織銆?/p>
        <label className="auth-password-field">
          <span>璁块棶瀵嗙爜</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            placeholder="璇疯緭鍏ュ瘑鐮?
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? '楠岃瘉涓?..' : '杩涘叆浠诲姟鍙?}
        </button>
      </form>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    api.getAuthStatus()
      .then((status) => {
        if (active) setAuth(status);
      })
      .catch((error) => {
        if (active) setAuthError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authError) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <ClipboardList size={30} aria-hidden="true" />
          <h1>浠诲姟鍙版殏鏃舵棤娉曡繛</h1>
          <p>{authError}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            閲嶈瘯
          </button>
        </section>
      </main>
    );
  }

  if (!auth) {
    return <main className="auth-screen" aria-label="姝ｅ湪鍔犺浇浠诲姟鍙? />;
  }

  if (auth.mode === 'oidc' && !auth.authenticated) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <ClipboardList size={30} aria-hidden="true" />
          <h1>涓汉浠诲姟鍙?/h1>
          <p>璇峰厛瀹屾垚瀹夊叏鐧诲綍锛屽啀缁х画绠＄悊浠诲姟銆佺瑪璁板拰宸ヤ綔鏃ュ織</p>
          <a className="primary-button" href="/auth/login">鐧诲綍</a>
        </section>
      </main>
    );
  }

  if (auth.mode === 'password' && !auth.authenticated) {
    return <PasswordLogin onLogin={setAuth} />;
  }

  return <TaskBoardApp />;
}

export default App;
