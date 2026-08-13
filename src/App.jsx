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
  MessageCircle,
  QrCode,
  Unplug,
  Info,
  LayoutDashboard,
  ListFilter,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { api } from './api.js';

const columns = [
  { status: 'todo', title: '待办', icon: ClipboardList },
  { status: 'in_progress', title: '进行中', icon: Clock3 },
  { status: 'done', title: '已完成', icon: Check },
];

const priorityLabels = {
  low: '低',
  medium: '中',
  high: '高',
};

const statusLabels = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
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
    label: '账号记录',
    title: '账号记录',
    category: '账号',
    content: '账号名称：\n平台/用途：\n登录方式：\n关键网址：\n绑定信息：\n当前状态：\n注意事项：\n下一步：',
  },
  {
    id: 'contract',
    label: '合同记录',
    title: '合同记录',
    category: '合同',
    content: '合同名称：\n合作方：\n负责人：\n当前阶段：\n关键日期：\n待确认事项：\n附件说明：\n下一步：',
  },
  {
    id: 'customer',
    label: '客户沟通',
    title: '客户沟通记录',
    category: '客户',
    content: '客户/联系人：\n沟通时间：\n沟通渠道：\n核心诉求：\n已确认内容：\n待回复问题：\n风险/备注：\n下一步：',
  },
  {
    id: 'troubleshooting',
    label: '问题排查',
    title: '问题排查记录',
    category: '问题',
    content: '问题现象：\n影响范围：\n复现步骤：\n已尝试操作：\n排查结论：\n临时方案：\n待验证事项：\n下一步：',
  },
  {
    id: 'meeting',
    label: '会议纪要',
    title: '会议纪要',
    category: '会议纪要',
    content: '会议主题：\n参会人员：\n讨论要点：\n已确定事项：\n待办事项：\n负责人：\n截止时间：\n下一次跟进：',
  },
];

const noteFormatPresets = [
  {
    id: 'checklist',
    label: '按清单整理',
    instruction: '把内容整理成清晰的待办清单和已确认事项，保留原有事实，不新增信息。',
  },
  {
    id: 'grouped',
    label: '按分组整理',
    instruction: '按主题或对象分组整理，给每组加简短小标题，重复内容合并，不新增事实。',
  },
  {
    id: 'todos',
    label: '提取待办',
    instruction: '重点提取待办事项、负责人、截止时间和下一步，无法确认的字段标注为待确认。',
  },
  {
    id: 'key-info',
    label: '提取关键信息',
    instruction: '提取账号、链接、金额、时间、联系人、状态等关键字段，适合时整理成表格。',
  },
];

const logTemplates = [
  {
    id: 'follow-up',
    label: '日常跟进',
    content: '已跟进当前任务，确认了最新进展与阻塞点。',
    nextStep: '继续推进下一步，并同步关键结果。',
    hours: '0.5',
    detailsOpen: false,
  },
  {
    id: 'communication',
    label: '沟通记录',
    content: '已完成相关沟通，记录对方反馈、确认事项和待回复问题。',
    nextStep: '整理沟通结论，并跟进未确认事项。',
    hours: '0.5',
    detailsOpen: true,
  },
  {
    id: 'file-work',
    label: '文件整理',
    content: '已整理本阶段文件或图片资料，并补充附件说明。',
    nextStep: '检查资料是否完整，必要时继续补充或提交审核。',
    hours: '1',
    detailsOpen: true,
  },
  {
    id: 'issue',
    label: '问题处理',
    content: '已定位并处理当前问题，记录现象、原因和处理结果。',
    nextStep: '继续观察结果，确认问题是否复现。',
    hours: '1',
    detailsOpen: true,
  },
  {
    id: 'summary',
    label: '阶段总结',
    content: '本阶段已完成主要事项，整理了当前成果、剩余问题和下一步计划。',
    nextStep: '按计划进入下一阶段处理。',
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
    // 自定义模板只是辅助录入，保存失败不影响正式日志。
  }
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
    const name = HTMLAttributes.name || '附件';
    const size = formatFileSize(Number(HTMLAttributes.size || 0));

    if (HTMLAttributes.isImage && HTMLAttributes.previewUrl) {
      return [
        'figure',
        mergeAttributes(attrs),
        ['img', { src: HTMLAttributes.previewUrl, alt: name }],
        ['figcaption', {}, HTMLAttributes.tempId ? `${name} · 待保存上传` : name],
      ];
    }

    return [
      'div',
      mergeAttributes(attrs),
      ['span', { class: 'rich-attachment-icon' }, 'FILE'],
      ['span', { class: 'rich-attachment-name' }, name],
      ['span', { class: 'rich-attachment-size' }, size],
      ...(HTMLAttributes.tempId ? [['span', { class: 'rich-attachment-pending' }, '待保存']] : []),
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
  if (!value) return '未设置';
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
    return '当前 OCR 模型不支持图片输入';
  }
  if (/timeout|timed out/i.test(message)) return '识别超时，请稍后重试';
  if (/rate limit|quota/i.test(message)) return '模型额度或频率受限';
  return message.length > 36 ? `${message.slice(0, 36)}...` : message;
}

function attachmentTextStatusLabel(attachment) {
  const chars = Number(attachment.textChars || 0);
  if (attachment.textStatus === 'completed') {
    return `已识别${chars ? ` · ${chars} 字` : ''}${attachment.textTruncated ? ' · 已截断' : ''}`;
  }
  if (attachment.textStatus === 'processing' || attachment.textStatus === 'pending') return '识别中';
  if (attachment.textStatus === 'failed') {
    const reason = compactAttachmentTextError(attachment.textError);
    return `识别失败${reason ? `：${reason}` : ''}`;
  }
  if (attachment.textStatus === 'unsupported') return '暂不支持识别';
  return '未识别';
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
    /^(?:下一步|下步|后续|待办|todo|TODO|计划|需要跟进|继续跟进)\s*[：:，,、-]?\s*(.+)$/i,
    /^(?:需要|准备|继续|明天|稍后)\s*(.+)$/i,
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
  const askConfirm = (title, message, options = {}) => {
    return new Promise((resolve) => {
      setConfirmState({ title, message, ...options, resolve });
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
    }
  }

  async function loadActionRequests() {
    setActionRequestsLoading(true);
    try {
      const data = await api.getActionRequests({ status: 'pending' });
      setActionRequests(data);
    } catch (err) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      addToast('info', '提示', '这条日志没有下一步计划。');
      return;
    }
    const title = String(log.nextStep || '').trim().slice(0, 160);
    const description = [
      `来源任务：${task.title}`,
      `来源日志日期：${log.logDate}`,
      '',
      '原日志内容：',
      log.content || '',
      '',
      '下一步计划：',
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
    addToast('info', '已生成任务草稿', '请确认内容后保存。');
  }

  async function saveTask(payload) {
    try {
      const nextPayload = {
        ...payload,
        progress: progressForStatus(payload.status, payload.progress),
      };
      if (editingTask) {
        await api.updateTask(editingTask.id, nextPayload);
        addToast('success', '完成', '操作已完成。');
      } else {
        await api.createTask(nextPayload);
        addToast('success', '完成', '操作已完成。');
      }
      setIsTaskModalOpen(false);
      setEditingTask(null);
      setCreateTaskInitialValues(null);
      await loadTasks();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  async function deleteTask(task) {
    const ok = await askConfirm(
      '移入任务回收站',
      `确定要把“${task.title}”移入回收站吗？可在回收站恢复。`,
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteTask(task.id);
      setSelectedTask(null);
      setTaskDrawerInitialSection('progress');
      addToast('success', '已移入回收站', '可在回收站恢复这项任务。');
      await loadTasks();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
      addToast('info', '提示', '操作已完成。');
      await loadTasks();
    } catch (err) {
      addToast('error', '出错了', err.message);
      setTasks(taskBefore);
      await loadTasks();
    }
  }

  async function updateProgress(task, progress) {
    try {
      await api.updateTask(task.id, { progress });
      addToast('success', '完成', '操作已完成。');
      await loadTasks();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
      addToast('success', '完成', '操作已完成。');
      await loadTasks();
    } catch (err) {
      setTasks(before);
      addToast('error', '出错了', err.message);
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
        addToast('success', '完成', updated.title || '操作已完成。');
      } else {
        addToast('error', '出错了', updated.errorMessage || '操作失败。');
      }
      await loadActionRequests();
      await loadTasks();
      await loadStandaloneNotes();
      await loadNoteCategories();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  async function rejectAction(action) {
    try {
      await api.rejectActionRequest(action.id);
      addToast('info', '已拒绝', action.title || '该动作请求已拒绝。');
      await loadActionRequests();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">个人工作记录</p>
          <h1>助理任务台</h1>
        </div>
        <div className="top-actions">
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            aria-label="切换主题"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className={view === 'today' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('today')}
            title="今日工作台"
          >
            <Clock3 size={18} />
            <span>今日</span>
          </button>
          <button
            className={view === 'board' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('board')}
            title="任务看板"
          >
            <LayoutDashboard size={18} />
            <span>看板</span>
          </button>
          <button
            className={view === 'report' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('report')}
            title="日报周报"
          >
            <BarChart3 size={18} />
            <span>汇总</span>
          </button>
          <button
            className={view === 'notes' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('notes')}
            title="独立笔记"
          >
            <FileText size={18} />
            <span>笔记</span>
          </button>
          <button
            className={view === 'attachments' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('attachments')}
            title="附件中心"
          >
            <Paperclip size={18} />
            <span>附件</span>
          </button>
          <button
            className={view === 'ai' ? 'icon-button ai-search-button active' : 'icon-button ai-search-button'}
            onClick={() => setView('ai')}
            title="AI"
          >
            <Search size={18} />
            <span>智能检索</span>
          </button>
          <button
            className={view === 'trash' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('trash')}
            title="回收站"
          >
            <Trash2 size={18} />
            <span>回收站</span>
          </button>
          <button
            className={view === 'system' ? 'icon-button active' : 'icon-button'}
            onClick={() => setView('system')}
            title="设置"
          >
            <Settings size={18} />
            <span>设置</span>
          </button>
          <button
            className={actionRequests.length ? 'icon-button approval-button has-pending' : 'icon-button approval-button'}
            onClick={() => setIsApprovalsOpen(true)}
            title="AI 与外部操作审批"
          >
            <ShieldCheck size={18} />
            <span>审批</span>
            {actionRequests.length > 0 && <em>{actionRequests.length}</em>}
          </button>
          <button className="icon-button primary" onClick={() => openCreateTask('todo')} title="新建任务">
            <Plus size={18} />
            <span>新建</span>
          </button>
        </div>
      </header>

      <main className="workspace">

        {error && (
          <div className="notice">
            <span>{error}</span>
            <button className="ghost-button" onClick={() => loadTasks()}>
              <RefreshCw size={16} />
              重试
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
              <section className="board" aria-label="任务看板">
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
          <SettingsView addToast={addToast} askConfirm={askConfirm} />
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
          confirmText={confirmState.confirmText}
          tone={confirmState.tone}
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
        <span>筛选</span>
      </div>
      <label>
        <Flag size={16} />
        <select
          id="task-priority-filter"
          name="priority"
          value={draft.priority}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
        >
          <option value="">全部优先级</option>
          <option value="high">高优先级</option>
          <option value="medium">中优先级</option>
          <option value="low">低优先级</option>
        </select>
      </label>
      <label>
        <Search size={16} />
        <input
          id="task-tag-filter"
          name="tag"
          value={draft.tag}
          onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          placeholder="搜索标签..."
        />
      </label>
      <button className="ghost-button" onClick={() => onChange(draft)}>
        <Search size={16} />
        应用
      </button>
      <button className="ghost-button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={16} />
        刷新
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

  const rangeLabel = dates.from === dates.to ? dates.from : `${dates.from} 至 ${dates.to}`;

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
      addToast('info', '提示', '当前没有可记录日志的未完成任务。');
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
          <p className="eyebrow">今日工作台</p>
          <h2>{rangeLabel}</h2>
          <span>任务、日志、笔记和附件的当前处理视图</span>
        </div>
        <div className="range-switch" role="group" aria-label="工作台日期范围">
          <button type="button" className={mode === 'today' ? 'active' : ''} onClick={() => selectRange('today')}>
            今天
          </button>
          <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => selectRange('week')}>
            本周
          </button>
          <button type="button" className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
            自定义
          </button>
        </div>
      </div>

      <div className="workbench-toolbar">
        <label>
          <CalendarDays size={16} />
          <span>开始</span>
          <input type="date" value={dates.from} onChange={(event) => updateCustomDate('from', event.target.value)} />
        </label>
        <label>
          <CalendarDays size={16} />
          <span>结束</span>
          <input type="date" value={dates.to} onChange={(event) => updateCustomDate('to', event.target.value)} />
        </label>
        <button type="button" className="ghost-button" onClick={() => loadWorkbench()} disabled={loading}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>

      <div className="workbench-quick-actions" aria-label="快捷入口">
        <button type="button" onClick={onCreateTask}>
          <Plus size={18} />
          <span>新建任务</span>
        </button>
        <button type="button" onClick={openFirstLogTarget}>
          <Clock3 size={18} />
          <span>写日志</span>
        </button>
        <button type="button" onClick={onOpenNotes}>
          <FileText size={18} />
          <span>新建笔记</span>
        </button>
        <button type="button" onClick={onOpenAi}>
          <Sparkles size={18} />
          <span>打开 AI</span>
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="workbench-metrics">
        <WorkbenchMetric label="未完成任务" value={data?.metrics?.activeTasks || 0} />
        <WorkbenchMetric label="范围日志" value={data?.metrics?.logs || 0} />
        <WorkbenchMetric label="投入耗时" value={`${data?.metrics?.totalHours || 0}h`} />
        <WorkbenchMetric label="新增附件" value={data?.metrics?.attachments || 0} />
      </div>

      {loading && !data ? (
        <div className="empty-column workbench-loading">正在加载工作台...</div>
      ) : (
        <>
          <div className="workbench-task-grid">
            <WorkbenchPanel title="待处理" count={data?.todoTasks?.length || 0}>
              {(data?.todoTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'progress')} />
              ))}
              {!data?.todoTasks?.length && <div className="empty-column">暂无任务</div>}
            </WorkbenchPanel>
            <WorkbenchPanel title="进行中" count={data?.inProgressTasks?.length || 0}>
              {(data?.inProgressTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'logs')} />
              ))}
              {!data?.inProgressTasks?.length && <div className="empty-column">暂无任务</div>}
            </WorkbenchPanel>
            <WorkbenchPanel title="即将截止" count={data?.dueTasks?.length || 0}>
              {(data?.dueTasks || []).map((task) => (
                <WorkbenchTaskItem key={task.id} task={task} onOpen={() => onOpenTask(task, 'progress')} dueFocus />
              ))}
              {!data?.dueTasks?.length && <div className="empty-column">暂无任务</div>}
            </WorkbenchPanel>
          </div>

          <div className="workbench-lower-grid">
            <WorkbenchPanel title="工作日志" count={data?.logs?.length || 0}>
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
                  <em>{log.logDate} · {log.hours}h · {statusLabels[log.stage] || log.stage}</em>
                </button>
              ))}
              {!data?.logs?.length && <div className="empty-column">暂无工作日志</div>}
            </WorkbenchPanel>

            <WorkbenchPanel title="最近笔记" count={data?.recentNotes?.length || 0}>
              {(data?.recentNotes || []).map((note) => (
                <button
                  type="button"
                  className="workbench-record"
                  key={note.id}
                  onClick={() => {
                    onOpenNotes(note.id, { includeLinked: true });
                  }}
                >
                  <strong>{note.title || '未命名笔记'}</strong>
                  <span>{note.content || '暂无正文'}</span>
                  <em>{note.category || '未分类'} · {formatDate(note.updatedAt)}</em>
                </button>
              ))}
              {!data?.recentNotes?.length && <div className="empty-column">暂无笔记</div>}
            </WorkbenchPanel>

            <WorkbenchPanel title="附件记录" count={data?.attachments?.length || 0}>
              {(data?.attachments || []).map((item) => (
                <div className="workbench-attachment" key={`${item.kind}-${item.attachment.id}`}>
                  <button type="button" onClick={() => openAttachmentSource(item)}>
                    <Paperclip size={16} />
                    <span>
                      <strong>{item.attachment.originalName}</strong>
                      <em>{item.sourceLabel} · {item.sourceTitle || '未命名来源'}</em>
                    </span>
                  </button>
                  <a href={item.attachment.downloadUrl} target="_blank" rel="noreferrer">
                    下载
                  </a>
                </div>
              ))}
              {!data?.attachments?.length && <div className="empty-column">暂无附件</div>}
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
        <span>{task.description || '暂无说明'}</span>
      </div>
      <div className="workbench-task-meta">
        <span className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</span>
        <span className={`status-chip ${task.status}`}>{statusLabels[task.status]}</span>
        <span className={overdue ? 'due overdue' : 'due'}>{dueFocus && overdue ? '逾期 ' : ''}{formatDate(task.dueDate)}</span>
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
            title={`在“${column.title}”中新建任务`}
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
              暂无任务
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
          <span>状态</span>
          <strong>未开始</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="progress-line">
      <div>
        <span>{task.status === 'done' ? '已完成' : '进行中'}</span>
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
      { status: 'in_progress', label: '开始', icon: Clock3 },
    ],
    in_progress: [
      { status: 'done', label: '完成', icon: CheckCircle2 },
      { status: 'todo', label: '退回', icon: ChevronLeft },
    ],
    done: [
      { status: 'in_progress', label: '重开', icon: RefreshCw },
    ],
  }[task.status] || [];

  if (!actions.length) return null;

  return (
    <div className="status-actions" aria-label="任务状态流转">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.status}
            type="button"
            className={`flow-button to-${action.status}`}
            title={`移动到 ${statusLabels[action.status]}`}
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
          <h2>{task ? '编辑任务' : '新建任务'}</h2>
          <button type="button" className="round-button small" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label>
          标题
          <input
            required
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="任务标题..."
          />
        </label>
        <label>
          说明
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="对任务的具体描述细节..."
          />
        </label>
        <div className="form-grid">
          <label>
            优先级
            <select
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            >
              <option value="high">{priorityLabels.high}</option>
              <option value="medium">{priorityLabels.medium}</option>
              <option value="low">{priorityLabels.low}</option>
            </select>
          </label>
          <label>
            状态
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="todo">待办</option>
              <option value="in_progress">进行中</option>
              <option value="done">已完成</option>
            </select>
          </label>
          <label>
            截止日期
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </label>
          <label>
            进度
            {form.status === 'todo' ? (
              <div className="locked-progress">待办任务默认未开始</div>
            ) : form.status === 'done' ? (
              <div className="locked-progress">已完成任务默认 100%</div>
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
          标签
          <input
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            placeholder="例如：合同、客户、紧急"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            <ChevronLeft size={16} />
            取消
          </button>
          <button type="submit" className="icon-button primary" disabled={saving}>
            <Save size={17} />
            保存
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
    }
  }

  async function loadNotes(search = noteSearch) {
    try {
      const data = await api.getNotes(task.id, { search });
      setNotes(data);
    } catch (err) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
    }
  }

  async function loadTaskFiles() {
    try {
      const data = await api.getTaskAttachments(task.id);
      setTaskFiles(data);
    } catch (err) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      `来源笔记：${note.title || '未命名笔记'}`,
      note.category ? `分类：${note.category}` : '',
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
        nextStep: `继续跟进「${note.title || '这条笔记'}」中记录的事项。`,
      },
      detailsOpen: true,
      status: '已根据笔记生成日志草稿，请确认后再记录。',
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
      status: 'AI 已生成日志草稿，请确认后再记录。',
    });
    setActiveSection('logs');
  }

  async function removeLog(log) {
    const ok = await askConfirm(
      '移入日志回收站',
      '确定要把这条工作记录日志移入回收站吗？可在回收站恢复。',
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteLog(log.id);
      addToast('success', '已移入回收站', '可在回收站恢复这条日志。');
      await loadLogs();
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className={`priority ${task.priority}`} style={{ marginBottom: '8px' }}>
              {priorityLabels[task.priority]}优先级
            </span>
            <h2>{task.title}</h2>
          </div>
          <button className="round-button small" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-meta">
          <span>{statusLabels[task.status]}</span>
          <span>截止：{formatDate(task.dueDate)}</span>
          <span className="note-meta">笔记：{notes.length} 条</span>
        </div>
        {task.description && <p className="drawer-desc">{task.description}</p>}
        <div className="drawer-actions">
          <button className="ghost-button" onClick={onEdit}>
            <Edit3 size={15} />
            编辑任务
          </button>
          <button className="danger-button" onClick={onDelete}>
            <Trash2 size={15} />
            删除任务
          </button>
        </div>

        <div className="drawer-tabs" role="tablist" aria-label="任务详情">
          <button
            type="button"
            className={activeSection === 'progress' ? 'active' : ''}
            onClick={() => setActiveSection('progress')}
          >
            进度
          </button>
          <button
            type="button"
            className={activeSection === 'logs' ? 'active' : ''}
            onClick={() => setActiveSection('logs')}
          >
            日志 {logs.length}
          </button>
          <button
            type="button"
            className={activeSection === 'notes' ? 'active' : ''}
            onClick={() => setActiveSection('notes')}
          >
            笔记 {notes.length}
          </button>
          <button
            type="button"
            className={activeSection === 'attachments' ? 'active' : ''}
            onClick={() => setActiveSection('attachments')}
          >
            附件 {taskFiles.length}
          </button>
          <button
            type="button"
            className={activeSection === 'ai' ? 'active' : ''}
            onClick={() => setActiveSection('ai')}
          >
            智能
          </button>
        </div>

        {activeSection === 'progress' && (
          <section className="drawer-section">
            <div className="drawer-status-flow">
              <span>状态流转</span>
              <StatusActions task={task} onMove={onMove} />
            </div>
            <section className={`progress-editor ${task.status !== 'in_progress' ? 'locked' : ''}`}>
              {task.status === 'todo' ? (
                <>
                  <div>
                    <span>任务进度</span>
                    <strong>未开始</strong>
                  </div>
                  <p className="progress-hint">待办任务先从上方切换到进行中，再开始记录百分比</p>
                </>
              ) : task.status === 'done' ? (
                <>
                  <div>
                    <span>任务进度</span>
                    <strong>100%</strong>
                  </div>
                  <div className="progress-track large">
                    <span style={{ width: '100%' }} />
                  </div>
                  <p className="progress-hint">已完成任务固定为 100%，需要继续处理可先重开</p>
                </>
              ) : (
                <>
                  <div>
                    <span>调整任务进度</span>
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
                    保存进度
                  </button>
                </>
              )}
            </section>
          </section>
        )}

        {activeSection === 'logs' && (
          <section className="drawer-section">
            <LogComposer task={task} seed={logComposerSeed} onCreated={async () => {
              addToast('success', '完成', '操作已完成。');
              setLogComposerSeed(null);
              await loadLogs();
              await onChanged();
            }} addToast={addToast} />

            <section className="logs">
              <div className="logs-head">
                <div>
                  <h3>历史工作日志</h3>
                  <span>{logs.length} 条记录· {logHours.toFixed(2).replace(/\.00$/, '')} 小时</span>
                </div>
                <button
                  type="button"
                  className="round-button small"
                  title="重置日志筛选"
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
                    placeholder="搜索日志内容、下一步计划..."
                  />
                </label>
                <label>
                  <span>开</span>
                  <input
                    type="date"
                    value={logFilters.from}
                    onChange={(event) => setLogFilters({ ...logFilters, from: event.target.value })}
                  />
                </label>
                <label>
                  <span>结束</span>
                  <input
                    type="date"
                    value={logFilters.to}
                    onChange={(event) => setLogFilters({ ...logFilters, to: event.target.value })}
                  />
                </label>
                <label>
                  <span>阶段</span>
                  <select
                    value={logFilters.stage}
                    onChange={(event) => setLogFilters({ ...logFilters, stage: event.target.value })}
                  >
                    <option value="">全部阶段</option>
                    {columnStatuses.map((status) => (
                      <option value={status} key={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>最少耗时</span>
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
                  <span>最多耗时</span>
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
                          <span className={`stage-pill ${log.stage}`}>{statusLabels[log.stage] || '阶段记录'}</span>
                          <span className="date">{log.logDate}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="hours">{log.hours}h</span>
                          <button
                            className="round-button small"
                            type="button"
                            onClick={() => setEditingLog(log)}
                            title="编辑日志"
                            style={{ width: '24px', height: '24px', minHeight: '24px' }}
                          >
                            <Edit3 size={12} />
                          </button>
                          <button className="round-button small" onClick={() => removeLog(log)} title="删除日志" style={{ width: '24px', height: '24px', minHeight: '24px' }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="timeline-body">{log.content}</div>
                      <div className="timeline-foot">
                        <span>当时进度 {log.progressSnapshot}%</span>
                        {log.nextStep && <span className="next">下一步：{log.nextStep}</span>}
                        {log.nextStep && onCreateTaskFromLog && (
                          <button
                            type="button"
                            className="ghost-button tiny log-next-task-button"
                            onClick={() => onCreateTaskFromLog(task, log)}
                            title="把下一步计划转为任务草稿"
                          >
                            <Plus size={12} />
                            转为任务
                          </button>
                        )}
                      </div>
                      <LogAttachmentSummary attachments={log.attachments} />
                    </article>
                  </div>
                ))}
              </div>
              {!logs.length && <div className="empty-column">没有匹配的工作日志</div>}
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
  create_task: '创建任务',
  update_task: '更新任务',
  create_log: '新增日志',
  update_log: '编辑日志',
  create_note: '新增笔记',
  update_note: '编辑笔记',
  attach_weixin_media_to_task: '保存微信附件到任务',
  attach_weixin_media_to_note: '保存微信附件到笔记',
  create_note_with_weixin_media: '保存微信附件为笔记',
};

function tagsToText(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean).join('，');
  return String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).join('，');
}

function ActionPayloadSummary({ action }) {
  const payload = action.payload || {};
  const rows = [];

  if (action.actionType === 'create_task') {
    rows.push(
      ['任务标题', payload.title],
      ['优先级', priorityLabels[payload.priority] || payload.priority || '中'],
      ['状态', statusLabels[payload.status] || '待办'],
      ['截止日期', formatDate(payload.dueDate)],
      ['标签', tagsToText(payload.tags)],
      ['来源任务', payload.sourceTaskId ? `任务 #${payload.sourceTaskId}` : '当前 AI 建议'],
      ['来源说明', payload.sourceReason],
      ['任务说明', payload.description],
    );
  } else if (action.actionType === 'update_task') {
    rows.push(
      ['任务 ID', payload.taskId],
      ['新标题', payload.title],
      ['状态', statusLabels[payload.status] || payload.status],
      ['进度', payload.progress === undefined ? '' : `${payload.progress}%`],
      ['优先级', priorityLabels[payload.priority] || payload.priority],
      ['截止日期', formatDate(payload.dueDate)],
      ['任务说明', payload.description],
      ['来源说明', payload.sourceReason],
    );
  } else if (action.actionType === 'create_log' || action.actionType === 'update_log') {
    rows.push(
      ['任务 ID', payload.taskId],
      ['日志 ID', payload.logId],
      ['日期', formatDate(payload.logDate)],
      ['阶段', statusLabels[payload.stage] || payload.stage],
      ['耗时', payload.hours === undefined ? '' : `${payload.hours} 小时`],
      ['进度快照', payload.progressSnapshot === undefined ? '' : `${payload.progressSnapshot}%`],
      ['日志内容', payload.content],
      ['下一步', payload.nextStep],
      ['来源说明', payload.sourceReason],
    );
  } else if (action.actionType === 'create_note' || action.actionType === 'update_note') {
    rows.push(
      ['任务 ID', payload.taskId],
      ['笔记 ID', payload.noteId],
      ['标题', payload.title],
      ['分类', payload.category],
      ['笔记内容', payload.content],
      ['来源说明', payload.sourceReason],
    );
  } else if (action.actionType === 'attach_weixin_media_to_task') {
    rows.push(
      ['任务 ID', payload.taskId],
      ['微信附件', payload.originalName],
      ['文件大小', formatFileSize(payload.fileSize)],
      ['附件说明', payload.note],
      ['临时文件 ID', payload.tempMediaId],
      ['来源说明', payload.sourceReason],
    );
  } else if (action.actionType === 'attach_weixin_media_to_note') {
    rows.push(
      ['笔记 ID', payload.noteId],
      ['微信附件', payload.originalName],
      ['文件大小', formatFileSize(payload.fileSize)],
      ['附件说明', payload.note],
      ['临时文件 ID', payload.tempMediaId],
      ['来源说明', payload.sourceReason],
    );
  } else if (action.actionType === 'create_note_with_weixin_media') {
    rows.push(
      ['笔记标题', payload.title],
      ['笔记内容', payload.content],
      ['微信附件', payload.originalName],
      ['文件大小', formatFileSize(payload.fileSize)],
      ['临时文件 ID', payload.tempMediaId],
      ['来源说明', payload.sourceReason],
    );
  } else {
    rows.push(
      ['动作类型', actionTypeLabels[action.actionType] || action.actionType],
      ['目标类型', action.targetType || payload.targetType],
      ['目标 ID', action.targetId || payload.taskId || payload.logId || payload.noteId],
      ['来源说明', payload.sourceReason],
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
      <section className="approval-modal" role="dialog" aria-modal="true" aria-label="操作审批">
        <div className="modal-head">
          <div>
            <h2>操作审批</h2>
            <p>AI 或外部智能体提出的写入动作会先停在这里，批准后才会修改任务台</p>
          </div>
          <button type="button" className="round-button small" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="approval-toolbar">
          <span>{loading ? '正在刷新...' : `待审批 ${actions.length} 条`}</span>
          <button type="button" className="ghost-button" onClick={onRefresh}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        <div className="approval-list">
          {!actions.length && !loading && (
            <div className="approval-empty">
              <ShieldCheck size={22} />
              <strong>暂无待审批</strong>
              <span>OpenClaw 提交新的写入请求后会出现在这里。</span>
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
                    <p>创建时间：{action.createdAt} · 请求来源：{action.requestedBy || action.source}</p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button tiny"
                    onClick={() => setExpandedId(expanded ? null : action.id)}
                    title={expanded ? '收起详情' : '查看详情'}
                  >
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {expanded ? '收起 JSON' : '查看 JSON'}
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
                    拒绝
                  </button>
                  <button type="button" className="icon-button primary" onClick={() => onApprove(action)}>
                    <Check size={15} />
                    批准执行
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
    intent: '',
    grounded: undefined,
    facts: [],
    suggestions: [],
    actionRequests: [],
    streaming: false,
    error: false,
    stopped: false,
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
    .replace(/[)\]}>,，。；;?!！？]+$/g, '');
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

function CopyButton({ value, label = '复制', copiedLabel = '已复制', className = 'ghost-button tiny', title }) {
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
            <strong>{link.label || '链接'}</strong>
            <small>{displayActionUrl(link.url)}</small>
          </span>
          <div className="ai-action-card-actions">
            <a className="ghost-button tiny" href={link.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              打开
            </a>
            <CopyButton value={link.url} label="复制链接" />
          </div>
        </div>
      ))}
      {normalizedFiles.map((file) => {
        return (
          <div className="ai-action-card" key={`${file.kind || 'file'}-${file.id || file.downloadUrl}`}>
            {file.isImage ? <ImageIcon size={16} /> : <Paperclip size={16} />}
            <span>
              <strong>{file.fileName || '附件'}</strong>
              <small>{file.mimeType || '文件'}</small>
            </span>
            <div className="ai-action-card-actions">
              {file.previewUrl && (
                <a className="ghost-button tiny" href={file.previewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  预览
                </a>
              )}
              {file.downloadUrl && (
                <a className="ghost-button tiny" href={file.downloadUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download size={14} />
                  下载
                </a>
              )}
              <CopyButton value={file.fileName || file.downloadUrl} label="复制文件名" />
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
      <CopyButton value={plainText} label="复制全文" className="ghost-button small" />
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
  if (type === 'task') return '任务';
  if (type === 'log') return '日志';
  if (type === 'note') return source.taskId ? '任务笔记' : '独立笔记';
  if (type === 'task_attachment') return '任务附件';
  if (type === 'log_attachment') return '日志附件';
  if (type === 'note_attachment') return source.taskId ? '任务笔记附件' : '独立笔记附件';
  return '资料';
}

function AiSourceList({ sources = [], onOpenSource }) {
  if (!sources.length) return <p className="ai-empty">暂无可引用的资料。</p>;

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
                  {source.matchedFields?.length ? <b>匹配：{source.matchedFields.join('、')}</b> : null}
                </em>
                <small>{source.excerpt}</small>
              </span>
            </button>
            <div className="ai-source-actions">
              {onOpenSource && (
                <button type="button" className="ghost-button tiny" onClick={() => onOpenSource(source)}>
                  <ExternalLink size={14} />
                  打开来源
                </button>
              )}
              <CopyButton value={source.copyText || source.excerpt || source.label} label="复制来源" />
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
  newChat: '新对话',
  history: '历史对话',
  closeHistory: '关闭历史',
  noContent: '暂无内容',
  emptyHistory: '还没有历史对话。',
  rename: '重命名',
  delete: '删除',
  startTitle: '从当前任务台开始问',
  startHint: '回答优先使用当前 MySQL 中的任务、日志、笔记和附件识别文字；数据库事实与 AI 建议会分开显示。',
  you: '你',
  thinking: '正在整理回答',
  sources: '查看来源',
  loadingHistory: '正在载入历史...',
  renamePrompt: '重命名对话',
  deletePrefix: '删除对话“',
  deleteSuffix: '”？',
  failed: '这次回答没有成功，请稍后重试。',
  stopped: '已停止生成',
  taskAi: '任务 AI',
  workspaceAi: 'AI 工作区',
  taskTitle: '任务智能问答',
  workspaceTitle: '智能检索',
  askTask: '问问这个任务的进展、缺口或下一步...',
  askWorkspace: '询问任务、日志、笔记或附件里的内容...',
  generating: '生成中',
  send: '发送',
};

const taskAiQuickPrompts = [
  {
    id: 'task-summary',
    label: '总结进展',
    prompt: '请基于当前任务的状态、说明、关键日志、任务笔记和附件资料，生成一个可嵌入页面的安全 HTML 任务进展总结。请包含：当前状态、已完成内容、关键日志、附件/资料、风险或阻塞、下一步计划。可以使用数据面板、列表或表格，但不要编造资料。',
  },
  {
    id: 'next-steps',
    label: '提取下一步',
    prompt: '请只根据当前任务已有资料，提取接下来最应该处理的下一步计划。请用安全 HTML 输出，按优先级列出待办事项、原因、建议截止时间或需要确认的信息；无法确认的内容请标注“待确认”。',
  },
  {
    id: 'task-review',
    label: '任务复盘',
    prompt: '请对当前任务做一份简洁复盘，使用安全 HTML 输出。请包含目标、过程摘要、已完成成果、遗留问题、可复用经验和后续建议；不要新增事实。',
  },
];

const workspaceAiQuickPrompts = [
  { id: 'incomplete', label: '未完成任务', prompt: '我还有哪些任务没有完成？' },
  { id: 'today-logs', label: '今日日志', prompt: '今天做了什么？请汇总今天的工作日志和耗时。' },
  { id: 'week-progress', label: '本周进展', prompt: '本周进展怎么样？请按任务汇总本周日志和耗时。' },
  { id: 'attachments', label: '查附件', prompt: '请帮我查找最近与任务相关的附件资料。' },
  { id: 'notes', label: '查笔记', prompt: '请帮我查找当前笔记中的重点内容。' },
  { id: 'next-steps', label: '生成下一步', prompt: '请根据当前工作内容和最近日志，先列出数据库事实，再单独给出下一步建议。' },
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
    intent: message.intent || '',
    grounded: message.grounded,
    facts: message.facts || [],
    suggestions: message.suggestions || [],
    actionRequests: message.actionRequests || [],
    createdAt: message.createdAt,
  });
}

function upsertAiConversation(list, conversation) {
  const normalized = normalizeAiConversation(conversation);
  if (!normalized?.id) return list;
  const without = list.filter((item) => item.id !== normalized.id && item.localKey !== normalized.localKey);
  return [normalized, ...without].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function AiPendingActionCard({ action, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = action.status || 'pending';

  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      const updated = decision === 'approve'
        ? await api.approveActionRequest(action.id)
        : await api.rejectActionRequest(action.id, '在 AI 对话中拒绝');
      onChanged?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={'ai-pending-action ' + status}>
      <div className="ai-pending-action-head">
        <span className="ai-pending-action-icon"><ShieldCheck size={17} /></span>
        <div>
          <small>{status === 'pending' ? '等待你的确认' : status === 'applied' ? '已执行' : status === 'rejected' ? '已拒绝' : '执行失败'}</small>
          <strong>{action.title || actionTypeLabels[action.actionType] || '待审批操作'}</strong>
        </div>
      </div>
      <ActionPayloadSummary action={action} />
      {error && <p className="ai-pending-action-error" role="alert">{error}</p>}
      {status === 'pending' && (
        <div className="ai-pending-action-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={() => decide('reject')}>
            <X size={14} />
            拒绝
          </button>
          <button type="button" className="icon-button primary" disabled={busy} onClick={() => decide('approve')}>
            <Check size={14} />
            {busy ? '处理中...' : '确认执行'}
          </button>
        </div>
      )}
    </article>
  );
}

function AiPendingActions({ actions = [], onChanged }) {
  if (!actions.length) return null;
  return (
    <section className="ai-pending-actions" aria-label="待审批操作">
      {actions.map((action) => (
        <AiPendingActionCard key={action.id} action={action} onChanged={onChanged} />
      ))}
    </section>
  );
}

function AiChatThread({ messages, onOpenSource, onRetry, onActionChanged }) {
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
      {messages.map((message, index) => (
        <article className={'ai-chat-message ' + message.role} key={message.id}>
          <span className="ai-chat-role">{message.role === 'user' ? '我' : 'AI'}</span>
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
          {message.role === 'assistant' && message.intent && (
            <span className="ai-answer-basis">
              {message.grounded === false ? '资料不足' : '基于任务台数据库'}
            </span>
          )}
          <AiMessageTools message={message} />
          {message.role === 'assistant' && (
            <AiPendingActions
              actions={message.actionRequests || []}
              onChanged={(action) => onActionChanged?.(message.id, action)}
            />
          )}
          {message.role === 'assistant' && message.error && (
            <button
              type="button"
              className="ghost-button ai-retry-button"
              onClick={() => onRetry?.([...messages.slice(0, index)].reverse().find((item) => item.role === 'user')?.content || '')}
            >
              <RotateCcw size={14} />
              重新生成
            </button>
          )}
          {message.role === 'assistant' && message.stopped && <span className="ai-stopped-label">{aiText.stopped}</span>}
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
  const streamControllerRef = useRef(null);

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

  function updateMessageAction(messageId, updatedAction) {
    if (!activeConversationId) return;
    updateConversationMessages(activeConversationId, (current) => updateAiMessage(current, messageId, (message) => ({
      ...message,
      actionRequests: (message.actionRequests || []).map((action) => (
        action.id === updatedAction.id ? updatedAction : action
      )),
    })));
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
    const streamController = new AbortController();
    streamControllerRef.current = streamController;

    let targetConversationId = conversationId;
    try {
      await api.streamAskWorkspace(text, {
        scope,
        taskId: scope === 'task' ? taskId : undefined,
        conversationId: targetConversationId.startsWith('local-') ? undefined : targetConversationId,
        localKey,
        messages: toAiHistory(previousMessages),
      }, {
        signal: streamController.signal,
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
        onIntent: (intent) => {
          updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
            ...message,
            intent,
          })));
        },
        onActionRequests: (actionRequests) => {
          updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
            ...message,
            actionRequests: actionRequests || [],
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
            intent: payload?.intent || message.intent,
            grounded: payload?.grounded,
            facts: payload?.facts || [],
            suggestions: payload?.suggestions || [],
            actionRequests: payload?.actionRequests?.length ? payload.actionRequests : message.actionRequests,
          })));
        },
      });
    } catch (err) {
      const stopped = err.name === 'AbortError';
      if (!stopped) setError(err.message);
      updateConversationMessages(targetConversationId, (current) => updateAiMessage(current, assistantMessage.id, (message) => ({
        ...message,
        content: stopped ? message.content : (message.content || aiText.failed),
        streaming: false,
        error: !stopped,
        stopped,
      })));
    } finally {
      if (streamControllerRef.current === streamController) streamControllerRef.current = null;
      setLoading(false);
    }
  }

  function stopGenerating() {
    streamControllerRef.current?.abort();
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
        <AiChatThread
          messages={activeMessages}
          onOpenSource={onOpenSource}
          onRetry={sendQuestion}
          onActionChanged={updateMessageAction}
        />
        {loadingMessages && <p className="ai-loading-line">{aiText.loadingHistory}</p>}
        {error && <div className="form-error">{error}</div>}
        <div className="ai-quick-actions" aria-label={compact ? '任务 AI 快捷动作' : '工作区 AI 快捷动作'}>
            {(compact ? taskAiQuickPrompts : workspaceAiQuickPrompts).map((item) => (
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
        <form className="ai-composer" onSubmit={submit}>
          <textarea
            name={compact ? 'taskAiQuestion' : 'aiWorkspaceQuestion'}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendQuestion(question);
              }
            }}
            placeholder={compact ? aiText.askTask : aiText.askWorkspace}
            rows="1"
          />
          <button
            type={loading ? 'button' : 'submit'}
            className={loading ? 'icon-button ai-stop-button' : 'icon-button primary'}
            disabled={!loading && !question.trim()}
            onClick={loading ? stopGenerating : undefined}
          >
            {loading ? <Square size={15} /> : <Search size={16} />}
            {loading ? '停止' : aiText.send}
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
      addToast?.('success', '完成', 'AI 已生成任务进展总结。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '出错了', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="task-ai-summary-panel">
      <div className="task-ai-suggestions-head">
        <div>
          <span>AI 复盘</span>
          <strong>任务进展总结</strong>
        </div>
        <button type="button" className="ghost-button" onClick={loadSummary} disabled={loading}>
          <Sparkles size={14} />
          {loading ? '生成中...' : summary ? '重新生成' : '生成总结'}
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
        <p className="task-ai-summary-empty">汇总当前任务的状态、日志、笔记和附件，生成一张便于回顾的进展卡片。</p>
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
        setError('AI 没有找到适合新建的后续任务。');
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
        sourceReason: '根据当前任务的状态、日志、笔记和附件资料生成的后续任务建议',
      });
      setRequestedIds((current) => new Set([...current, suggestion.id]));
      addToast?.('success', '已加入审批', '请在顶部“审批”里确认后执行。');
    } catch (err) {
      addToast?.('error', '出错了', err.message);
      setError(err.message);
    }
  }

  return (
    <section className="task-ai-suggestions">
      <div className="task-ai-suggestions-head">
        <div>
          <span>AI 建议</span>
          <strong>后续任务</strong>
        </div>
        <button type="button" className="ghost-button" onClick={loadSuggestions} disabled={loading}>
          <Sparkles size={14} />
          {loading ? '生成中...' : '生成建议'}
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
                  <span>{priorityLabels[suggestion.priority] || '中'}优先级 · {suggestion.dueDate || '未设置截止'}</span>
                  {suggestion.tags?.length > 0 && <em>{suggestion.tags.join('，')}</em>}
                </div>
                <button
                  type="button"
                  className={requested ? 'ghost-button' : 'icon-button primary'}
                  disabled={requested}
                  onClick={() => createApproval(suggestion)}
                >
                  <ShieldCheck size={14} />
                  {requested ? '已加入审批' : '加入审批'}
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
        {attachments.length} 个附件      </span>
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
        addToast?.('success', '完成', '附件识别已完成。');
      } else {
        addToast?.('error', '出错了', result.textError || '没有提取到可用文本。');
      }
      await onChanged?.();
    } catch (err) {
      addToast?.('error', '出错了', err.message);
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
          {running ? '识别中' : '重试'}
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
          <span>阶段附件</span>
        </div>
        <span>{log.attachments?.length || 0} 个文件</span>
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
      addToast('success', '完成', '操作已完成。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAttachment() {
    const ok = await askConfirm(
      '移入附件回收站',
      `确定要把“${attachment.originalName}”移入回收站吗？可在回收站恢复。`,
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteAttachment(attachment.id);
      addToast('success', '完成', '操作已完成。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
            placeholder="附件备注"
          />
          <button type="button" className="ghost-button tiny" onClick={saveNote} disabled={saving}>
            <Save size={12} />
          </button>
        </div>
      </div>
      <div className="attachment-actions">
        <a className="round-button small" href={attachment.downloadUrl} title="下载文件">
          <Download size={13} />
        </a>
        <button className="round-button small" type="button" onClick={removeAttachment} title="删除附件">
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
      return;
    }

    setUploading(true);
    try {
      await api.uploadAttachments(logId, files, note);
      addToast('success', '完成', '操作已完成。');
      setFiles([]);
      setNote('');
      formElement.reset();
      await onUploaded();
    } catch (err) {
      addToast('error', '出错了', err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className={compact ? 'attachment-upload compact' : 'attachment-upload'} onSubmit={uploadFiles}>
      <label className="file-picker">
        <Upload size={15} />
        <span>{files.length ? `已选择 ${files.length} 个文件` : '上传/重新上传文件'}</span>
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
        placeholder="本次上传备注，可稍后单独修改"
      />
      <button className="ghost-button" disabled={uploading || !files.length}>
        <Upload size={14} />
        保存附件
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
        <span>·</span>
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
  const [isNoteFormOpen, setIsNoteFormOpen] = useState(false);
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
    setIsNoteFormOpen(true);
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
        addToast('success', '完成', '操作已完成。');
        await loadNotes(search, includeLinked);
      } catch (err) {
        addToast('error', '出错了', err.message);
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
          addToast('info', '提示', '操作已完成。');
          await loadNotes(search, includeLinked);
        } catch (err) {
          addToast('error', '出错了', err.message);
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
      addToast('info', '提示', '关联任务当前不在任务列表中。');
      return;
    }
    onOpenTask?.(task, 'notes');
  }

  async function detachNote(note) {
    const ok = await askConfirm(
      '取消任务关联',
      `确定要将“${note.title || '未命名笔记'}”从任务中移出，变为独立笔记吗？`,
      { confirmText: '取消关联', tone: 'primary' },
    );
    if (!ok) return;
    try {
      await api.updateNote(note.id, { taskId: null });
      addToast('success', '完成', '笔记已取消关联。');
      await loadNotes(search, includeLinked);
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <section className="standalone-notes-view">
        <div className="notes-page-head">
          <div>
            <p className="eyebrow">独立记录</p>
            <h2>笔记</h2>
          </div>
          <button type="button" className="icon-button primary" onClick={focusCreateNote}>
            <Plus size={16} />
            单独创建笔记
          </button>
        </div>

        <div className="notes-page-layout compact">
          <div className="notes-list-panel">
            <div className="section-title-row">
              <h3>{includeLinked ? '全部笔记' : '全部独立笔记'}</h3>
              <span>{notes.length} </span>
            </div>
            <div className="note-scope-tabs" role="group" aria-label="笔记范围">
              <button
                type="button"
                className={!includeLinked ? 'active' : ''}
                onClick={() => switchNoteScope(false)}
              >
                独立笔记
              </button>
              <button
                type="button"
                className={includeLinked ? 'active' : ''}
                onClick={() => switchNoteScope(true)}
              >
                全部笔记
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
                  placeholder="搜索标题、内容、分类或关联任务..."
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
                      setIsNoteFormOpen(true);
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
                    {loading ? '正在加载笔记...' : '暂无独立笔记'}
                  </div>
                )}
              </div>
            </SortableContext>
          </div>

          <div className="notebook-task-sidebar">
            <h3>
              <ClipboardList size={16} />
              <span>拖动至任务关联</span>
            </h3>
            <p className="hint">把左侧笔记拖拽到下方任务上，即可快速完成关联：</p>
            <div className="droppable-task-list">
              {tasks.filter(t => t.status !== 'done').map((task) => (
                <DroppableTaskItem
                  key={task.id}
                  task={task}
                />
              ))}
              {!tasks.filter(t => t.status !== 'done').length && (
                <div className="sidebar-notes-empty">
                  <span>暂无活动中的任务</span>
                </div>
              )}
            </div>
          </div>
        </div>
        {isNoteFormOpen && (
          <SettingsModal
            title={editingNote ? '编辑笔记' : '创建独立笔记'}
            description="笔记内容和附件在弹窗里集中处理，列表页保持清爽。"
            onClose={() => {
              setEditingNote(null);
              setIsNoteFormOpen(false);
            }}
            wide
          >
            <NoteForm
              note={editingNote}
              inputRef={noteInputRef}
              addToast={addToast}
              noteCategories={noteCategories}
              onCancel={() => {
                setEditingNote(null);
                setIsNoteFormOpen(false);
              }}
              onSaved={async () => {
                setEditingNote(null);
                setIsNoteFormOpen(false);
                await loadNotes(search, includeLinked);
                await onCategoriesChanged?.();
              }}
            />
          </SettingsModal>
        )}
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
        addToast('info', '提示', '操作已完成。');
        await onChanged();
      } catch (err) {
        addToast('error', '出错了', err.message);
      }
    }
  }

  return (
    <section className="notes-section" ref={sectionRef}>
      <div className="section-title-row">
        <h3>任务笔记（整体记录）</h3>
        <div className="note-title-actions">
          <span>{notes.length} </span>
          <button type="button" className="icon-button note-create-button" onClick={focusCreateNote}>
            <Plus size={14} />
            创建笔记
          </button>
        </div>
      </div>
      <div className="note-search-row">
        <label>
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索标题、内容、分类或关联附件..."
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
            {!notes.length && <div className="empty-column">暂无笔记</div>}
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
      return;
    }

    if (files.length < Array.from(fileList || []).length) {
      addToast('info', '提示', '操作已完成。');
    }

    const nextPending = files.map((file) => {
      const tempId = `pending-${Date.now()}-${crypto.randomUUID()}`;
      return {
        tempId,
        file,
        name: file.name || '粘贴附件',
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
          title="加粗"
        >
          B
        </button>
        <button
          type="button"
          className={editor?.isActive('italic') ? 'active' : ''}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="斜体"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="项目列表"
        >
          列表
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="上传附件"
        >
          <Paperclip size={14} />
          附件
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
      <div className="rich-note-hint">可直接粘贴图片或文件；图片会显示在正文里，文件会显示为附件卡片</div>
    </div>
  );
}

function RichNoteViewer({ contentJson, fallback }) {
  const doc = contentJson || textToRichDoc(fallback || '');

  const stopViewerLinkToggle = (event) => event.stopPropagation();

  const renderMarks = (text, marks = []) => {
    return marks.reduce((node, mark) => {
      if (mark.type === 'bold') return <strong>{node}</strong>;
      if (mark.type === 'italic') return <em>{node}</em>;
      if (mark.type === 'code') return <code>{node}</code>;
      if (mark.type === 'link') {
        return (
          <a
            href={mark.attrs?.href}
            target="_blank"
            rel="noreferrer"
            onPointerDown={stopViewerLinkToggle}
            onClick={stopViewerLinkToggle}
          >
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
            name: attrs.alt || attrs.title || '图片',
          }}
        />
      );
    }
    return <div key={index}>{(node.content || []).map(renderNode)}</div>;
  };

  return <div className="rich-note-viewer">{(doc.content || []).map(renderNode)}</div>;
}

function RichAttachmentNode({ attachment }) {
  const name = attachment.name || attachment.originalName || '附件';
  const href = attachment.downloadUrl || attachment.previewUrl;
  const pending = Boolean(attachment.tempId);
  if (attachment.isImage && attachment.previewUrl) {
    return (
      <figure className={pending ? 'rich-attachment-node image pending' : 'rich-attachment-node image'}>
        <a
          href={attachment.previewUrl}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <img src={attachment.previewUrl} alt={name} />
        </a>
        <figcaption>{pending ? `${name} · 待保存上传` : name}</figcaption>
      </figure>
    );
  }

  return (
    <a
      className={pending ? 'rich-attachment-node pending' : 'rich-attachment-node'}
      href={href}
      target="_blank"
      rel="noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="rich-attachment-icon">
        <FileText size={16} />
      </span>
      <span className="rich-attachment-name">{name}</span>
      <span className="rich-attachment-size">{formatFileSize(attachment.size || attachment.fileSize)}</span>
      {pending && <span className="rich-attachment-pending">待保存</span>}
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
        if (markdownTitle && !/[：:]/.test(trimmed)) {
          const title = `${markdownTitle[1]}${markdownTitle[2] ? ` ${markdownTitle[2]}` : ''}`;
          return <h4 key={index}>{title}</h4>;
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return <p key={index} className="stream-bullet">• {renderStreamInline(bullet[1])}</p>;
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
      <aside className="note-ai-format-drawer" aria-label="AI整理笔记确认">
        <div className="note-ai-format-head">
          <div>
            <p className="eyebrow">AI 排版整理</p>
            <h2>确认整理结果</h2>
            <span>左侧是原笔记，右侧是 AI 整理后的候选内容。确认前不会覆盖原文。</span>
          </div>
          <button type="button" className="round-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="note-ai-format-status">
            <Sparkles size={16} />
            AI 正在整理笔记...
          </div>
        )}
        {error && (
          <div className="note-ai-format-error">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <label className="note-ai-format-instruction">
          <span>整理想法（可选）</span>
          <div className="note-ai-format-presets" aria-label="AI整理预设">
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
            placeholder="例如：按账号分组、整理成清单、把错误状态放前面、只保留关键字段。不填则按默认方式整理。"
            disabled={loading || applying}
            rows={3}
          />
        </label>

        <div className="note-ai-format-compare">
          <section className="note-ai-format-panel">
            <div className="note-ai-format-panel-head">
              <span>原笔记</span>
            </div>
            <RichNoteViewer contentJson={original?.contentJson} fallback={original?.content} />
          </section>
          <section className="note-ai-format-panel result">
            <div className="note-ai-format-panel-head">
              <span>整理后</span>
            </div>
            {hasResult ? (
              <RichNoteViewer contentJson={result.contentJson} fallback={result.content} />
            ) : streamText ? (
              <StreamNotePreview text={streamText} />
            ) : (
              <div className="note-ai-format-placeholder">
                {loading ? '等待 AI 开始输出...' : '暂无整理结果'}
              </div>
            )}
          </section>
        </div>

        <div className="note-ai-format-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={applying}>
            取消
          </button>
          <button type="button" className="ghost-button" onClick={() => onRetry?.(instruction)} disabled={loading || applying}>
            <RefreshCw size={14} />
            {hasResult || streamText ? '重新整理' : '开始整理'}
          </button>
          <button
            type="button"
            className="icon-button primary"
            onClick={onApply}
            disabled={!hasResult || loading || applying}
          >
            <Check size={14} />
            {applying ? '正在应用...' : '应用整理结果'}
          </button>
        </div>
      </aside>
    </>
  );
}

const noteVersionSourceLabels = {
  manual: '手动编辑',
  ai_format: 'AI 整理',
  restore: '版本回退',
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
      <aside className="note-version-drawer" aria-label="笔记版本历史">
        <div className="note-version-head">
          <div>
            <p className="eyebrow">版本历史</p>
            <h2>{note?.title || '未命名笔记'}</h2>
            <span>查看笔记变更前后内容，需要时可回退到变更前版本。</span>
          </div>
          <button type="button" className="round-button" onClick={onClose} title="关闭">
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
          <section className="note-version-list" aria-label="版本列表">
            {loading ? (
              <div className="empty-column">正在加载版本...</div>
            ) : versions.length ? (
              versions.map((version) => (
                <button
                  type="button"
                  key={version.id}
                  className={selected?.id === version.id ? 'active' : ''}
                  onClick={() => onSelect(version.id)}
                >
                  <strong>{noteVersionSourceLabels[version.source] || '笔记更新'}</strong>
                  <span>{version.createdAt}</span>
                  {version.changeNote && <em>{version.changeNote}</em>}
                </button>
              ))
            ) : (
              <div className="empty-column">暂无版本记录</div>
            )}
          </section>

          <div className="note-version-preview">
            <section className="note-ai-format-panel">
              <div className="note-ai-format-panel-head">
                <span>变更前</span>
              </div>
              {selected ? (
                <RichNoteViewer contentJson={before.contentJson} fallback={before.content} />
              ) : (
                <div className="note-ai-format-placeholder">选择一个版本查看内容</div>
              )}
            </section>
            <section className="note-ai-format-panel result">
              <div className="note-ai-format-panel-head">
                <span>变更后</span>
              </div>
              {selected ? (
                <RichNoteViewer contentJson={after.contentJson} fallback={after.content} />
              ) : (
                <div className="note-ai-format-placeholder">选择一个版本查看内容</div>
              )}
            </section>
          </div>
        </div>

        <div className="note-ai-format-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={restoring}>
            关闭
          </button>
          <button
            type="button"
            className="icon-button primary"
            onClick={() => selected && onRestore(selected)}
            disabled={!selected || restoring}
          >
            <RefreshCw size={14} />
            {restoring ? '正在回退...' : '回退到变更前'}
          </button>
        </div>
      </aside>
    </>
  );
}

function AttachmentCardList({ attachments = [], onDelete, emptyText = '暂无附件', kind, addToast, onChanged }) {
  if (!attachments.length) {
    return <div className="attachment-empty">{emptyText}</div>;
  }

  return (
    <div
      className="attachment-card-list"
      data-note-no-toggle
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {attachments.map((attachment) => (
        <article className={attachment.isImage ? 'attachment-item image' : 'attachment-item'} key={attachment.id}>
          {attachment.isImage ? (
            <a
              href={attachment.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="attachment-preview"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
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
            <a
              className="round-button small"
              href={attachment.downloadUrl}
              title="下载文件"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Download size={13} />
            </a>
            {onDelete && (
              <button
                className="round-button small"
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(attachment);
                }}
                title="删除附件"
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
      addToast('error', '出错了', '操作失败，请稍后重试。');
      return;
    }

    setUploading(true);
    try {
      await api.uploadTaskAttachments(task.id, files);
      addToast('success', '完成', '操作已完成。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachment) {
    const ok = await askConfirm(
      '移入附件回收站',
      `确定要把“${attachment.originalName}”移入回收站吗？可在回收站恢复。`,
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteTaskAttachment(attachment.id);
      addToast('success', '完成', '操作已完成。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
        <strong>{uploading ? '正在上传...' : '点击、拖放或粘贴任务附件'}</strong>
        <span>图片可预览，PDF、Word、Excel 和压缩包会显示下载链接</span>
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
        emptyText="暂无任务附件"
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
    setDraftStatus(restoredAt ? `已恢复未提交草稿 ${formatDraftTime(restoredAt)}` : '');
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
        setDraftStatus(`草稿已自动保存${formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('草稿无法自动保存');
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
    setDraftStatus(`已套用模板：${template.label}`);
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
      addToast('error', '出错了', '请先填写模板名称和笔记内容。');
      return;
    }
    const nextTemplates = [template, ...customNoteTemplates.filter((item) => item.label !== template.label)].slice(0, 20);
    setCustomNoteTemplates(nextTemplates);
    saveCustomNoteTemplates(nextTemplates);
    setTemplateName('');
    setTemplateFormOpen(false);
    setDraftStatus(`已保存模板：${template.label}`);
  }

  function deleteCustomNoteTemplate(templateId) {
    const nextTemplates = customNoteTemplates.filter((template) => template.id !== templateId);
    setCustomNoteTemplates(nextTemplates);
    saveCustomNoteTemplates(nextTemplates);
    setDraftStatus('自定义模板已删除');
  }

  function openFormAiFormat() {
    const payload = noteFormatPayloadFromForm(form, note);
    if (!String(payload.content || '').trim()) {
      addToast('error', 'AI整理失败', '请先输入笔记内容。');
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
        throw new Error('AI 整理没有返回可用结果。');
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
    setDraftStatus('AI整理结果已应用，请确认后保存');
    setFormatState((current) => ({ ...current, open: false }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
      return;
    }
    if (!form.content.trim()) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
          ? `AI 整理：${appliedAiFormat.instruction}`.slice(0, 255)
          : 'AI 整理';
      }
      let savedNote;
      if (note) {
        savedNote = await api.updateNote(note.id, payload);
        addToast('success', '完成', '操作已完成。');
      } else if (task) {
        savedNote = await api.createNote(task.id, payload);
        addToast('success', '完成', '操作已完成。');
      } else {
        savedNote = await api.createStandaloneNote(payload);
        addToast('success', '完成', '操作已完成。');
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
        addToast('success', '完成', '操作已完成。');
      }

      pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingFiles([]);
      setAppliedAiFormat(null);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // The saved server record is authoritative even when browser storage is unavailable.
      }
      setDraftStatus('笔记已保存');
      setForm({ title: '', category: '', content: '', contentJson: emptyRichDoc, attachmentId: '' });
      await onSaved();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
          <h4>{note ? '编辑笔记' : task ? '创建任务笔记' : '创建独立笔记'}</h4>
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
            <span>常用模板</span>
            <button type="button" className="ghost-button tiny" onClick={() => setTemplateFormOpen((open) => !open)}>
              <Save size={12} />
              保存当前为模板
            </button>
          </div>
          <div className="note-template-picks" aria-label="笔记模板">
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
                    title="删除自定义模板"
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
                placeholder="模板名称，例如：开号记录"
              />
              <button type="button" className="icon-button primary" onClick={saveCurrentAsTemplate}>
                <Save size={13} />
                保存模板
              </button>
            </div>
          )}
        </div>
      )}
      <label className="note-title-field">
        标题
        <input
          ref={inputRef}
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="例如：会议要点、客户反馈、待确认事项"
        />
      </label>
      <div className="note-form-grid">
        <div className="note-category-field">
          <label htmlFor={categoryListId}>分类</label>
          <input
            id={categoryListId}
            list={`${categoryListId}-list`}
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            placeholder="输入新分类或选择已有分类"
          />
          <datalist id={`${categoryListId}-list`}>
            {categoryOptions.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <div className="category-helper">输入新的分类名称，保存笔记后会自动创建</div>
          <div className="category-picks" aria-label="已有笔记分类">
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
            关联附件
            <select
              value={form.attachmentId}
              onChange={(event) => setForm({ ...form, attachmentId: event.target.value })}
            >
              <option value="">不关联附</option>
              {attachments.map((attachment) => (
                <option key={attachment.id} value={attachment.id}>
                  {attachment.originalName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="standalone-note-scope">
            <span>保存位置</span>
            <strong>独立笔记</strong>
          </div>
        )}
      </div>
      <div className="note-editor-field">
        <span>笔记内容</span>
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
            {pendingFiles.length} 个附件将在点击保存后上传
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
          AI整理
        </button>
        {note && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            <X size={14} />
            取消编辑
          </button>
        )}
        <button className="icon-button primary" disabled={saving}>
          <Save size={15} />
          {note ? '保存笔记' : '添加笔记'}
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
  const [isExpanded, setIsExpanded] = useState(false);
  const skippedDragClickRef = useRef(false);
  const noteContentId = `note-content-${note.id}`;

  useEffect(() => {
    if (isDragging) {
      skippedDragClickRef.current = true;
      return undefined;
    }
    if (!skippedDragClickRef.current) return undefined;
    const timer = window.setTimeout(() => {
      skippedDragClickRef.current = false;
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isDragging]);

  function shouldIgnoreExpandToggle(target) {
    return Boolean(target?.closest?.('button,a,input,textarea,select,label,[data-note-no-toggle]'));
  }

  function toggleNoteExpanded() {
    setIsExpanded((current) => !current);
  }

  function handleNoteCardClick(event) {
    if (skippedDragClickRef.current) {
      skippedDragClickRef.current = false;
      return;
    }
    if (shouldIgnoreExpandToggle(event.target)) return;
    toggleNoteExpanded();
  }

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
      addToast('error', 'AI整理失败', '这条笔记没有可整理的内容。');
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
        throw new Error('AI 整理没有返回可用结果。');
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
          ? `AI 整理：${formatState.instruction}`.slice(0, 255)
          : 'AI 整理',
      });
      addToast('success', 'AI整理已应用', '笔记排版已更新。');
      setFormatState((current) => ({ ...current, open: false }));
      await onChanged();
    } catch (err) {
      addToast('error', 'AI整理失败', err.message);
    } finally {
      setFormatApplying(false);
    }
  }

  async function removeNote() {
    const ok = await askConfirm(
      '移入笔记回收站',
      '确定要把这条笔记移入回收站吗？可在回收站恢复。',
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteNote(note.id);
      addToast('success', '已移入回收站', '可在回收站恢复这条笔记。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  async function removeNoteAttachment(attachment) {
    const ok = await askConfirm(
      '移入附件回收站',
      `确定要把“${attachment.originalName}”移入回收站吗？可在回收站恢复。`,
      { confirmText: '移入回收站', tone: 'danger' },
    );
    if (!ok) return;
    try {
      await api.deleteNoteAttachment(attachment.id);
      addToast('success', '完成', '操作已完成。');
      await onChanged();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  async function restoreVersion(version) {
    const ok = await askConfirm(
      '确认回退笔记',
      `确定要把“${note.title || '未命名笔记'}”回退到该版本的变更前内容吗？当前内容会先保存为一个新版本。`,
      { confirmText: '确认回退', tone: 'primary' },
    );
    if (!ok) return;
    setVersionState((current) => ({ ...current, restoring: true, error: '' }));
    try {
      await api.restoreNoteVersion(note.id, version.id, 'before');
      addToast('success', '笔记已回退', '当前内容已回退，并保留了回退前版本。');
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
      addToast('success', 'AI 草稿已生成', '请在日志页确认后再保存。');
    } catch (err) {
      addToast('error', 'AI 生成日志失败', err.message);
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
      className={`note-item ${isExpanded ? 'is-expanded' : ''} ${isDragging ? 'is-dragging' : ''} ${isFocusTarget ? 'is-focus-target' : ''}`}
      aria-expanded={isExpanded}
      onClick={handleNoteCardClick}
      {...(dragAttributes || {})}
      {...(dragListeners || {})}
    >
      <div className="note-item-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {dragAttributes && (
            <span
              className="note-drag-handle"
              title="长按笔记任意位置拖动排序"
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
          <span title={note.taskTitle || '关联任务'}>{note.taskTitle || '关联任务'}</span>
          {note.taskStatus && <em>{statusLabels[note.taskStatus] || note.taskStatus}</em>}
        </div>
      )}
      <h4>{note.title || '未命名笔记'}</h4>
      <div id={noteContentId} className="note-preview-shell">
        <RichNoteViewer contentJson={note.contentJson} fallback={note.content} />
      </div>
      <button
        className="note-expand-toggle"
        type="button"
        data-note-no-toggle
        aria-expanded={isExpanded}
        aria-controls={noteContentId}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleNoteExpanded();
        }}
      >
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{isExpanded ? '收起' : '展开全文'}</span>
      </button>
      {note.attachment && (
        <div
          className="note-attachment"
          data-note-no-toggle
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {note.attachment.isImage ? (
            <a
              href={note.attachment.previewUrl}
              target="_blank"
              rel="noreferrer"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
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
            title="下载关联附件"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
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
          AI整理
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
          历史
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
            打开任务
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
            生成日志
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
            {aiLogLoading ? '生成中...' : 'AI生成日志'}
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
            取消关联
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
          编辑
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
          删除
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
    setDraftStatus(restoredAt ? `已恢复未提交草稿 ${formatDraftTime(restoredAt)}` : '');
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
    setDraftStatus(seed.status || '已生成日志草稿，请确认后记录。');
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
        setDraftStatus(`草稿已自动保存${formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('草稿无法自动保存');
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
    setDraftStatus(`已套用「${template.label}」模板`);
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
      addToast('error', '出错了', '请先填写模板名称和工作内容。');
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
    setDraftStatus(`已保存「${template.label}」模板`);
  }

  function removeCustomTemplate(templateId) {
    const nextTemplates = customTemplates.filter((template) => template.id !== templateId);
    setCustomTemplates(nextTemplates);
    saveCustomLogTemplates(nextTemplates);
    setDraftStatus('已删除自定义模板');
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.content.trim()) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      setDraftStatus('日志已保存');
      await onCreated();
    } catch (err) {
      addToast('error', '出错了', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="log-composer" onSubmit={submit}>
      <div className="log-composer-head">
        <div>
          <h3>记录本次进展</h3>
          <span>当前阶段{statusLabels[task.status]} · 当前任务进度 {progressForStatus(task.status, task.progress)}%</span>
        </div>
        {draftStatus && <span className="note-draft-status" aria-live="polite"><Clock3 size={13} />{draftStatus}</span>}
      </div>
      <div className="log-template-row">
        <span>常用模板</span>
        <div className="log-template-picks" aria-label="日志模板">
          {availableTemplates.map((template) => (
            <span className="log-template-chip" key={template.id}>
              <button
                type="button"
                onClick={() => applyLogTemplate(template)}
                title={template.custom ? '自定义模板' : '默认模板'}
              >
                {template.label}
              </button>
              {template.custom && (
                <button
                  type="button"
                  className="log-template-delete"
                  onClick={() => removeCustomTemplate(template.id)}
                  title="删除自定义模板"
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
            保存当前为模板
          </button>
        </div>
        {templateFormOpen && (
          <div className="log-template-save-row">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="模板名称，例如：客户回访"
            />
            <button type="button" className="primary-button" onClick={addCustomTemplate}>
              保存模板
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setTemplateFormOpen(false);
                setTemplateName('');
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>
      <label className="log-content-field">
        <span>工作内容</span>
        <textarea
          required
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          placeholder="记录本次完成的事情、沟通结果、处理过程或阶段结论"
        />
      </label>
      {inferredNextStep && (
        <div className="log-next-suggestion">
          <div>
            <Sparkles size={14} />
            <span>识别到可能的下一步</span>
          </div>
          <p>{inferredNextStep}</p>
          <button
            type="button"
            className="ghost-button tiny"
            onClick={() => {
              setForm({ ...form, nextStep: inferredNextStep });
              setDetailsOpen(true);
              setDraftStatus('已填入下一步计划，记录后可在时间线转为任务。');
            }}
          >
            填入下一步计划
          </button>
        </div>
      )}
      <div className="log-quick-fields">
        <label>
          <span>耗时（小时）</span>
          <input
            type="number"
            min="0"
            step="0.25"
            value={form.hours}
            onChange={(event) => setForm({ ...form, hours: event.target.value })}
            placeholder="例如 1.5"
          />
        </label>
        <label>
          <span>当时进度</span>
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
      <div className="log-progress-presets" aria-label="进度快捷设置">
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
        {detailsOpen ? '收起补充详情' : '补充日期、下一步和附件'}
      </button>
      {detailsOpen && (
        <div className="log-extra-fields">
          <div className="form-grid">
            <label>
              日期
              <input
                type="date"
                value={form.logDate}
                onChange={(event) => setForm({ ...form, logDate: event.target.value })}
              />
            </label>
            <label>
              记录阶段
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
                {columnStatuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
          </div>
          <label>
            下一步计划
            <input
              value={form.nextStep}
              onChange={(event) => setForm({ ...form, nextStep: event.target.value })}
              placeholder="下一步要继续处理什么"
            />
          </label>
          <div className="log-attachment-fields">
            <label className="file-picker">
              <Upload size={15} />
              <span>{files.length ? `已选择 ${files.length} 个附件` : '选择本阶段图片或文件'}</span>
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
              placeholder="附件备注，例如：合同扫描件、客户截图、阶段资料"
            />
          </div>
          {files.length > 0 && (
            <div className="note-pending-file-warning"><AlertTriangle size={13} />{files.length} 个附件将在提交日志后上传</div>
          )}
        </div>
      )}
      <button className="icon-button primary full" disabled={saving}>
        <Plus size={16} />
        {saving ? '正在记录...' : '记录日志'}
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
        <dt>日期</dt>
        <dd>{snapshot.logDate || '-'}</dd>
        <dt>阶段</dt>
        <dd>{statusLabels[snapshot.stage] || snapshot.stage || '-'}</dd>
        <dt>耗时</dt>
        <dd>{Number(snapshot.hours || 0)}h</dd>
        <dt>进度</dt>
        <dd>{Number(snapshot.progressSnapshot || 0)}%</dd>
      </dl>
      <p>{snapshot.content || '无内容'}</p>
      {snapshot.nextStep && <em>下一步：{snapshot.nextStep}</em>}
    </div>
  );
}

function LogVersionHistory({ versions, loading, error, onRefresh }) {
  return (
    <section className="log-version-history">
      <div className="section-title-row">
        <div>
          <span>编辑历史</span>
          <h3>修改前后记录</h3>
        </div>
        <button type="button" className="round-button small" onClick={onRefresh} title="刷新历史">
          <RefreshCw size={13} />
        </button>
      </div>
      {loading && <div className="empty-column">正在加载编辑历史...</div>}
      {error && <div className="notice">{error}</div>}
      {!loading && !error && !versions.length && (
        <div className="empty-column">暂无编辑历史</div>
      )}
      {!loading && !error && versions.map((version, index) => (
        <details className="log-version-item" key={version.id} open={index === 0}>
          <summary>
            <span>{version.createdAt}</span>
            <em>{version.source === 'ai_format' ? 'AI 整理' : version.source === 'restore' ? '回退' : '手动编辑'}</em>
          </summary>
          {version.changeNote && <p className="log-version-note">{version.changeNote}</p>}
          <div className="log-version-snapshots">
            <LogSnapshotPreview title="修改前" snapshot={version.before} />
            <LogSnapshotPreview title="修改后" snapshot={version.after} />
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
    setDraftStatus(restoredAt ? `已恢复未保存修改 ${formatDraftTime(restoredAt)}` : '');
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
        setDraftStatus(`修改草稿已保存 ${formatDraftTime(savedAt)}`);
      } catch {
        setDraftStatus('草稿无法自动保存');
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draftKey, draftReady, form, savedForm, saving]);

  async function saveLog(event) {
    event.preventDefault();
    if (!form.content.trim()) {
      addToast('error', '出错了', '操作失败，请稍后重试。');
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
      setDraftStatus('修改已保存');
      await onChanged();
      await loadLogVersions();
      addToast('success', '完成', '操作已完成。');
    } catch (err) {
      addToast('error', '出错了', err.message);
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
      addToast('error', '出错了', err.message);
    }
  }

  return (
    <>
      <div className="log-editor-overlay" onClick={onClose} />
      <aside className="log-editor-drawer" aria-label="编辑工作日志">
        <div className="log-editor-head">
          <div>
            <span className={`stage-pill ${currentLog.stage}`}>{statusLabels[currentLog.stage]}</span>
            <h2>编辑工作日志</h2>
            <p>修改历史记录不会改变任务当前进度</p>
          </div>
          <button className="round-button small" type="button" onClick={onClose} title="关闭编辑">
            <X size={16} />
          </button>
        </div>
        <form className="log-edit-form" onSubmit={saveLog}>
          {draftStatus && <span className="note-draft-status" aria-live="polite"><Clock3 size={13} />{draftStatus}</span>}
          <div className="form-grid">
            <label>
              日期
              <input type="date" value={form.logDate} onChange={(event) => setForm({ ...form, logDate: event.target.value })} />
            </label>
            <label>
              阶段
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
                {columnStatuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
          </div>
          <label>
            工作内容
            <textarea required value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          </label>
          <div className="form-grid">
            <label>
              耗时（小时）
              <input type="number" min="0" step="0.25" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} />
            </label>
            <label>
              当时进度：<input type="number" min="0" max="100" value={form.progressSnapshot} onChange={(event) => setForm({ ...form, progressSnapshot: event.target.value })} />
            </label>
          </div>
          <label>
            下一步计划
            <input
              value={form.nextStep}
              onChange={(event) => setForm({ ...form, nextStep: event.target.value })}
              placeholder="下一步要继续处理什么"
            />
          </label>
          <div className="log-edit-actions">
            <button className="ghost-button" type="button" onClick={onClose}><ChevronLeft size={15} />关闭</button>
            <button className="icon-button primary" disabled={saving}><Save size={15} />{saving ? '保存中...' : '保存修改'}</button>
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
              <span>附件</span>
              <h3>阶段文件与备注</h3>
            </div>
            <span>{currentLog.attachments?.length || 0} 个</span>
          </div>
          <AttachmentPanel log={currentLog} askConfirm={askConfirm} addToast={addToast} onChanged={refreshAttachments} />
        </section>
      </aside>
    </>
  );
}

function SystemView({ addToast, compact = false }) {
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
      addToast?.('success', '备份完成', `已创建备份：${result.backupDir}`);
      await loadBackups();
    } catch (err) {
      setError(err.message);
      addToast?.('error', '出错了', err.message);
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
        addToast?.('success', '校验通过', '最近备份文件完整。');
      } else {
        addToast?.('error', '校验未通过', `发现 ${result.problems?.length || 0} 个问题。`);
      }
    } catch (err) {
      setError(err.message);
      addToast?.('error', '出错了', err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={compact ? 'system-page compact' : 'system-page'}>
      <div className="system-head">
        <div>
          {!compact && (
            <>
              <span>数据安全</span>
              <h2>系统与备份</h2>
            </>
          )}
          <p>备份会导出 MySQL 核心表并复制 uploads 文件；恢复仍请使用命令行预演确认后执行。</p>
        </div>
        <div className="system-actions">
          <button type="button" className="ghost-button" onClick={loadBackups} disabled={loading || Boolean(busy)}>
            <RefreshCw size={15} />
            刷新
          </button>
          <button type="button" className="ghost-button" onClick={verifyLatest} disabled={loading || Boolean(busy) || !backups.length}>
            <ShieldCheck size={15} />
            {busy === 'verify' ? '校验中...' : '校验最近备份'}
          </button>
          <button type="button" className="icon-button primary" onClick={createBackupNow} disabled={Boolean(busy)}>
            <Save size={15} />
            {busy === 'create' ? '备份中...' : '创建备份'}
          </button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {verifyResult && (
        <div className={verifyResult.status === 'ok' ? 'system-verify ok' : 'system-verify error'}>
          <strong>{verifyResult.status === 'ok' ? '备份校验通过' : '备份校验发现问题'}</strong>
          <span>检查文件 {verifyResult.checkedFiles || 0} 个 · 问题 {verifyResult.problems?.length || 0} 个</span>
          {verifyResult.problems?.length > 0 && (
            <ul>
              {verifyResult.problems.slice(0, 6).map((item) => (
                <li key={item.path}>{item.path}：{item.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="backup-list">
        {loading && <div className="empty-column">正在加载备份列表</div>}
        {!loading && !backups.length && <div className="empty-column">暂无备份，建议先创建一次备份。</div>}
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
                  <dt>数据表</dt>
                  <dd>{backup.tables?.length || 0} 张 · {totalRows} 行</dd>
                </div>
                <div>
                  <dt>附件</dt>
                  <dd>{backup.uploads?.count || 0} 个 · {formatFileSize(backup.uploads?.totalBytes || 0)}</dd>
                </div>
                <div>
                  <dt>校验文件</dt>
                  <dd>{backup.files || 0} 个</dd>
                </div>
                <div>
                  <dt>目录</dt>
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

function SettingsView({ addToast, askConfirm }) {
  const emptyAiForm = {
    indexingEnabled: false,
    litellmBaseUrl: '',
    litellmApiKey: '',
    litellmChatModel: '',
    litellmEmbeddingModel: '',
    qdrantUrl: '',
    qdrantApiKey: '',
    qdrantCollection: 'assistant_task_board',
    ocrBaseUrl: '',
    ocrApiKey: '',
    ocrModel: '',
    ocrMaxPdfPages: 20,
    ocrMinTextChars: 80,
  };
  const [settings, setSettings] = useState(null);
  const [aiForm, setAiForm] = useState(emptyAiForm);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [updateBranch, setUpdateBranch] = useState('main');
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStreamState, setUpdateStreamState] = useState('idle');
  const [weixinStatus, setWeixinStatus] = useState(null);
  const [weixinStreamState, setWeixinStreamState] = useState('idle');
  const [weixinVerifyCode, setWeixinVerifyCode] = useState('');
  const [settingsModal, setSettingsModal] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const updateLogRef = useRef(null);

  function applySettings(data) {
    setSettings(data);
    setUpdateStatus(data.update || null);
    setWeixinStatus(data.weixin || null);
    setUpdateBranch(data.update?.branch || 'main');
    setAiForm({
      indexingEnabled: Boolean(data.ai?.indexingEnabled),
      litellmBaseUrl: data.ai?.litellm?.baseUrl || '',
      litellmApiKey: '',
      litellmChatModel: data.ai?.litellm?.chatModel || '',
      litellmEmbeddingModel: data.ai?.litellm?.embeddingModel || '',
      qdrantUrl: data.ai?.qdrant?.url || '',
      qdrantApiKey: '',
      qdrantCollection: data.ai?.qdrant?.collection || 'assistant_task_board',
      ocrBaseUrl: data.ai?.ocr?.baseUrl || '',
      ocrApiKey: '',
      ocrModel: data.ai?.ocr?.model || '',
      ocrMaxPdfPages: data.ai?.ocr?.maxPdfPages || 20,
      ocrMinTextChars: data.ai?.ocr?.minTextChars || 80,
    });
  }

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      applySettings(await api.getSettings());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshUpdateStatus() {
    try {
      const status = await api.getOnlineUpdateStatus();
      setUpdateStatus(status);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!updateStatus?.running || settingsModal === 'update') return undefined;
    const timer = window.setInterval(refreshUpdateStatus, 1800);
    return () => window.clearInterval(timer);
  }, [updateStatus?.running, settingsModal]);

  useEffect(() => {
    if (settingsModal !== 'update') return undefined;
    checkForUpdates({ silent: true });
    return undefined;
  }, [settingsModal]);

  useEffect(() => {
    if (settingsModal !== 'update') {
      setUpdateStreamState('idle');
      return undefined;
    }
    if (!window.EventSource) {
      setUpdateStreamState('polling');
      const timer = window.setInterval(refreshUpdateStatus, 2000);
      refreshUpdateStatus();
      return () => window.clearInterval(timer);
    }

    let closed = false;
    let pollTimer = null;
    const source = new EventSource('/api/settings/update/events');
    setUpdateStreamState('connecting');

    function applyUpdateEvent(event) {
      if (closed) return;
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.state) setUpdateStatus(payload.state);
        setUpdateStreamState('connected');
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch {
        setUpdateStreamState('connected');
      }
    }

    function startFallbackPolling() {
      if (pollTimer) return;
      pollTimer = window.setInterval(refreshUpdateStatus, 2000);
      refreshUpdateStatus();
    }

    source.addEventListener('update.state', applyUpdateEvent);
    source.addEventListener('update.log', applyUpdateEvent);
    source.addEventListener('update.done', applyUpdateEvent);
    source.addEventListener('update.error', applyUpdateEvent);
    source.onerror = () => {
      if (closed) return;
      setUpdateStreamState('reconnecting');
      startFallbackPolling();
    };

    return () => {
      closed = true;
      source.close();
      if (pollTimer) window.clearInterval(pollTimer);
      setUpdateStreamState('idle');
    };
  }, [settingsModal]);

  useEffect(() => {
    if (settingsModal !== 'update') return;
    const node = updateLogRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [settingsModal, updateStatus?.logs?.length]);

  useEffect(() => {
    if (settingsModal !== 'weixin') {
      setWeixinStreamState('idle');
      return undefined;
    }

    let closed = false;
    let pollTimer = null;
    const refresh = async () => {
      try {
        setWeixinStatus(await api.getWeixinStatus());
      } catch {
        // EventSource reconnects automatically; polling is only a fallback.
      }
    };

    if (!window.EventSource) {
      setWeixinStreamState('polling');
      pollTimer = window.setInterval(refresh, 2000);
      refresh();
      return () => window.clearInterval(pollTimer);
    }

    const source = new EventSource('/api/settings/weixin/events');
    setWeixinStreamState('connecting');
    const applyWeixinEvent = (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.state) setWeixinStatus(payload.state);
        setWeixinStreamState('connected');
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch {
        setWeixinStreamState('connected');
      }
    };
    source.addEventListener('weixin.state', applyWeixinEvent);
    source.addEventListener('weixin.log', applyWeixinEvent);
    source.onerror = () => {
      if (closed) return;
      setWeixinStreamState('reconnecting');
      if (!pollTimer) pollTimer = window.setInterval(refresh, 2000);
    };

    return () => {
      closed = true;
      source.close();
      if (pollTimer) window.clearInterval(pollTimer);
      setWeixinStreamState('idle');
    };
  }, [settingsModal]);

  function updateAiField(field, value) {
    setAiForm((current) => ({ ...current, [field]: value }));
  }

  function secretHint(secret) {
    if (!secret?.configured) return '当前未配置。';
    return `当前已配置：${secret.preview}。留空保持原值。`;
  }

  async function saveAiConfig(event) {
    event.preventDefault();
    setBusy('ai-save');
    setError('');
    try {
      const result = await api.updateAiSettings(aiForm);
      setSettings((current) => ({ ...current, ai: result.ai }));
      setAiForm((current) => ({
        ...current,
        litellmApiKey: '',
        ocrApiKey: '',
        qdrantApiKey: '',
      }));
      addToast?.('success', 'AI 配置已保存', '新配置已写入服务器 .env，新的请求会使用最新配置。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '保存失败', err.message);
    } finally {
      setBusy('');
    }
  }

  async function testAiConfig() {
    setBusy('ai-test');
    setError('');
    try {
      const result = await api.testAiSettings({
        baseUrl: aiForm.litellmBaseUrl,
        apiKey: aiForm.litellmApiKey,
        model: aiForm.litellmChatModel,
      });
      addToast?.('success', 'AI 连接正常', `响应耗时 ${result.elapsedMs || 0}ms。`);
    } catch (err) {
      setError(err.message);
      addToast?.('error', 'AI 连接失败', err.message);
    } finally {
      setBusy('');
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      addToast?.('error', '密码不一致', '两次输入的新密码不一致。');
      return;
    }
    setBusy('password');
    setError('');
    try {
      await api.updatePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      addToast?.('success', '访问密码已修改', '下次登录请使用新密码。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '修改失败', err.message);
    } finally {
      setBusy('');
    }
  }

  async function checkForUpdates({ silent = false } = {}) {
    setCheckingUpdate(true);
    setError('');
    try {
      const result = await api.checkOnlineUpdate({ branch: updateBranch || 'main' });
      setUpdateStatus(result.update || ((current) => ({ ...(current || {}), check: result.check })));
      if (!silent) {
        if (result.check?.status === 'ok' && result.check.hasUpdate) {
          addToast?.('success', '发现新版本', `远端 ${result.check.remoteShort}，本地 ${result.check.localShort}。`);
        } else if (result.check?.status === 'ok') {
          addToast?.('success', '已是最新', '当前服务器代码和 GitHub main 分支一致。');
        } else {
          addToast?.('error', '检查更新失败', result.check?.error || '请稍后重试。');
        }
      }
    } catch (err) {
      setError(err.message);
      if (!silent) addToast?.('error', '检查更新失败', err.message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function copyUpdateLogs() {
    const logs = (updateStatus?.logs || []).join('\n');
    if (!logs) return;
    try {
      await copyTextToClipboard(logs);
      addToast?.('success', '已复制日志', '在线更新日志已复制到剪贴板。');
    } catch (err) {
      addToast?.('error', '复制失败', err.message || '浏览器不允许复制。');
    }
  }

  async function startUpdate() {
    const branch = updateBranch || 'main';
    const confirmed = askConfirm
      ? await askConfirm(
          '确认在线更新',
          `系统会从 GitHub 拉取 ${branch} 分支、安装依赖并重新构建。不会删除数据库、附件或服务器 .env 配置；完成后会尝试重启 PM2 服务。`,
          { confirmText: '确认更新', tone: 'primary' },
        )
      : window.confirm('确认从 GitHub 在线更新吗？');
    if (!confirmed) return;

    setBusy('online-update');
    setError('');
    try {
      const status = await api.startOnlineUpdate({ branch });
      setUpdateStatus(status);
      addToast?.('info', '在线更新已开始', '可以在下方查看更新日志。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '启动更新失败', err.message);
    } finally {
      setBusy('');
    }
  }

  const updateTone = updateStatus?.status === 'completed'
    ? 'ok'
    : updateStatus?.status === 'failed'
      ? 'error'
      : updateStatus?.running
        ? 'running'
        : updateStatus?.check?.status === 'failed'
          ? 'error'
          : updateStatus?.check?.status === 'ok' && updateStatus.check.hasUpdate
            ? 'warning'
            : updateStatus?.check?.status === 'ok'
              ? 'ok'
              : 'idle';
  const updateStatusLabel = updateStatus?.running
    ? '更新中'
    : updateStatus?.status === 'completed'
      ? '已完成'
      : updateStatus?.status === 'failed'
        ? '失败'
        : updateStatus?.check?.status === 'ok' && updateStatus.check.hasUpdate
          ? '有新版本'
          : updateStatus?.check?.status === 'ok'
            ? '已是最新'
            : updateStatus?.check?.status === 'failed'
              ? '检查失败'
              : '待命';
  const updateCheck = updateStatus?.check || null;
  const updateHasNewVersion = updateCheck?.status === 'ok' && updateCheck.hasUpdate;
  const updateCheckedLatest = updateCheck?.status === 'ok' && updateCheck.hasUpdate === false;
  const updateCanStart = updateHasNewVersion && !updateStatus?.running && !checkingUpdate && !Boolean(busy);
  const updateProgress = Math.max(0, Math.min(100, Number(updateStatus?.progress || 0)));
  const updateSteps = Array.isArray(updateStatus?.steps) ? updateStatus.steps : [];
  const updateStreamLabel = updateStreamState === 'connected'
    ? '实时连接正常'
    : updateStreamState === 'connecting'
      ? '正在连接实时进度'
      : updateStreamState === 'reconnecting'
        ? '服务可能正在重启，正在重新连接'
        : updateStreamState === 'polling'
          ? '实时连接不可用，已使用轮询'
          : '未连接';
  const aiConfigured = Boolean(settings?.ai?.litellm?.apiKey?.configured);
  const weixinConnected = Boolean(weixinStatus?.connected && weixinStatus?.status === 'connected');
  const weixinConnecting = ['connecting', 'reconnecting', 'waiting_scan', 'scanned', 'verifying', 'verify_required']
    .includes(weixinStatus?.status);
  const weixinTone = weixinConnected
    ? 'ok'
    : weixinStatus?.status === 'error'
      ? 'error'
      : weixinConnecting
        ? 'running'
        : 'idle';
  const weixinLabel = weixinConnected
    ? '已连接'
    : weixinStatus?.status === 'waiting_scan'
      ? '等待扫码'
      : weixinStatus?.status === 'scanned'
        ? '已扫码'
        : weixinStatus?.status === 'verify_required'
          ? '需要验证码'
          : weixinStatus?.status === 'reconnecting'
            ? '正在重连'
            : weixinStatus?.status === 'error'
              ? '连接异常'
              : '未连接';
  const closeSettingsModal = () => setSettingsModal('');

  function formatUpdateTime(value) {
    if (!value) return '未记录';
    try {
      return new Date(value).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return value;
    }
  }

  async function startWeixinConnection() {
    setBusy('weixin-login');
    setError('');
    try {
      const status = await api.startWeixinLogin();
      setWeixinStatus(status);
      setWeixinVerifyCode('');
      addToast?.('info', '二维码已生成', '请用手机微信扫码并确认连接。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '生成二维码失败', err.message);
    } finally {
      setBusy('');
    }
  }

  async function verifyWeixinConnection(event) {
    event.preventDefault();
    setBusy('weixin-verify');
    setError('');
    try {
      setWeixinStatus(await api.submitWeixinVerifyCode(weixinVerifyCode));
      setWeixinVerifyCode('');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '验证码提交失败', err.message);
    } finally {
      setBusy('');
    }
  }

  async function disconnectWeixinConnection() {
    const confirmed = askConfirm
      ? await askConfirm(
          '断开微信连接',
          '断开后服务器会删除微信登录凭证，并清理尚未保存的微信临时图片和文件。',
          { confirmText: '确认断开', tone: 'danger' },
        )
      : window.confirm('确认断开微信连接吗？');
    if (!confirmed) return;
    setBusy('weixin-disconnect');
    try {
      setWeixinStatus(await api.disconnectWeixin());
      addToast?.('success', '微信已断开', '服务器凭证和临时附件已清理。');
    } catch (err) {
      setError(err.message);
      addToast?.('error', '断开失败', err.message);
    } finally {
      setBusy('');
    }
  }

  function updateStepState(step) {
    if (updateStatus?.status === 'failed' && updateStatus.phase === step.phase) return 'failed';
    if (updateStatus?.phase === step.phase && updateStatus?.running) return 'active';
    if (updateStatus?.status === 'completed' || updateProgress > step.progress) return 'done';
    return 'pending';
  }

  function renderAiConfigForm() {
    return (
      <form className="settings-form-grid" onSubmit={saveAiConfig}>
        <label>
          <span>LiteLLM Base URL</span>
          <input
            value={aiForm.litellmBaseUrl}
            onChange={(event) => updateAiField('litellmBaseUrl', event.target.value)}
            placeholder="https://example.com/v1"
          />
        </label>
        <label>
          <span>LiteLLM API Key</span>
          <input
            type="password"
            value={aiForm.litellmApiKey}
            onChange={(event) => updateAiField('litellmApiKey', event.target.value)}
            placeholder="留空保持原值"
            autoComplete="new-password"
          />
          <em>{secretHint(settings?.ai?.litellm?.apiKey)}</em>
        </label>
        <label>
          <span>聊天模型</span>
          <input
            value={aiForm.litellmChatModel}
            onChange={(event) => updateAiField('litellmChatModel', event.target.value)}
            placeholder="mimo-v2.5-pro"
          />
        </label>
        <label>
          <span>Embedding 模型</span>
          <input
            value={aiForm.litellmEmbeddingModel}
            onChange={(event) => updateAiField('litellmEmbeddingModel', event.target.value)}
            placeholder="embedding model"
          />
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={aiForm.indexingEnabled}
            onChange={(event) => updateAiField('indexingEnabled', event.target.checked)}
          />
          <span>启用向量索引 Worker</span>
        </label>
        <label>
          <span>Qdrant URL</span>
          <input
            value={aiForm.qdrantUrl}
            onChange={(event) => updateAiField('qdrantUrl', event.target.value)}
            placeholder="http://127.0.0.1:6333"
          />
        </label>
        <label>
          <span>Qdrant API Key</span>
          <input
            type="password"
            value={aiForm.qdrantApiKey}
            onChange={(event) => updateAiField('qdrantApiKey', event.target.value)}
            placeholder="留空保持原值"
            autoComplete="new-password"
          />
          <em>{secretHint(settings?.ai?.qdrant?.apiKey)}</em>
        </label>
        <label>
          <span>Qdrant Collection</span>
          <input
            value={aiForm.qdrantCollection}
            onChange={(event) => updateAiField('qdrantCollection', event.target.value)}
            placeholder="assistant_task_board"
          />
        </label>
        <label>
          <span>OCR Base URL</span>
          <input
            value={aiForm.ocrBaseUrl}
            onChange={(event) => updateAiField('ocrBaseUrl', event.target.value)}
            placeholder="留空时复用 LiteLLM"
          />
        </label>
        <label>
          <span>OCR API Key</span>
          <input
            type="password"
            value={aiForm.ocrApiKey}
            onChange={(event) => updateAiField('ocrApiKey', event.target.value)}
            placeholder="留空保持原值"
            autoComplete="new-password"
          />
          <em>{secretHint(settings?.ai?.ocr?.apiKey)}</em>
        </label>
        <label>
          <span>OCR 模型</span>
          <input
            value={aiForm.ocrModel}
            onChange={(event) => updateAiField('ocrModel', event.target.value)}
            placeholder="留空时复用聊天模型"
          />
        </label>
        <label>
          <span>PDF OCR 页数上限</span>
          <input
            type="number"
            min="1"
            max="100"
            value={aiForm.ocrMaxPdfPages}
            onChange={(event) => updateAiField('ocrMaxPdfPages', event.target.value)}
          />
        </label>
        <label>
          <span>触发 OCR 的最少文本字数</span>
          <input
            type="number"
            min="1"
            max="2000"
            value={aiForm.ocrMinTextChars}
            onChange={(event) => updateAiField('ocrMinTextChars', event.target.value)}
          />
        </label>
        <div className="settings-form-actions">
          <button type="button" className="ghost-button" onClick={testAiConfig} disabled={Boolean(busy)}>
            <Sparkles size={15} />
            {busy === 'ai-test' ? '测试中...' : '测试 AI 连接'}
          </button>
          <button type="submit" className="icon-button primary" disabled={Boolean(busy)}>
            <Save size={15} />
            {busy === 'ai-save' ? '保存中...' : '保存 AI 配置'}
          </button>
        </div>
      </form>
    );
  }

  function renderPasswordForm() {
    return (
      <form className="settings-stack-form" onSubmit={savePassword}>
        <label>
          <span>当前密码</span>
          <input
            type="password"
            value={passwordForm.currentPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
            autoComplete="current-password"
            disabled={!settings?.auth?.passwordEnabled}
          />
        </label>
        <label>
          <span>新密码</span>
          <input
            type="password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
            autoComplete="new-password"
            disabled={!settings?.auth?.passwordEnabled}
          />
        </label>
        <label>
          <span>确认新密码</span>
          <input
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
            autoComplete="new-password"
            disabled={!settings?.auth?.passwordEnabled}
          />
        </label>
        <button type="submit" className="icon-button primary" disabled={Boolean(busy) || !settings?.auth?.passwordEnabled}>
          <ShieldCheck size={15} />
          {busy === 'password' ? '修改中...' : '保存新密码'}
        </button>
        {!settings?.auth?.passwordEnabled && (
          <p className="settings-help-text">当前不是密码登录模式，需要先在服务器 .env 中启用 AUTH_MODE=password。</p>
        )}
      </form>
    );
  }

  function renderUpdatePanel() {
    const checkTone = updateCheck?.status === 'failed'
      ? 'error'
      : updateHasNewVersion
        ? 'warning'
        : updateCheckedLatest
          ? 'ok'
          : 'idle';
    const checkLabel = updateCheck?.status === 'failed'
      ? '检查失败'
      : updateHasNewVersion
        ? '发现新版本'
        : updateCheckedLatest
          ? '已是最新'
          : '未检查';
    const startButtonText = updateStatus?.running
      ? '更新中...'
      : updateCheckedLatest
        ? '已是最新'
        : updateCheck?.status === 'ok'
          ? '从 GitHub 更新'
          : '请先检查更新';

    return (
      <div className="settings-stack-form update-workflow">
        <label>
          <span>更新分支</span>
          <input
            value={updateBranch}
            onChange={(event) => setUpdateBranch(event.target.value)}
            placeholder="main"
            disabled={updateStatus?.running}
          />
        </label>
        <section className={`update-check-panel ${checkTone}`} aria-live="polite">
          <div className="update-check-head">
            <div>
              <span>检查结果</span>
              <strong>{checkLabel}</strong>
            </div>
            <span className={`settings-status-pill ${checkTone}`}>{checkLabel}</span>
          </div>
          <dl className="update-check-grid">
            <div><dt>本地版本</dt><dd>{updateCheck?.localShort || '未检查'}</dd></div>
            <div><dt>远端版本</dt><dd>{updateCheck?.remoteShort || '未检查'}</dd></div>
            <div><dt>当前分支</dt><dd>{updateCheck?.currentBranch || updateBranch || 'main'}</dd></div>
            <div><dt>检查时间</dt><dd>{formatUpdateTime(updateCheck?.checkedAt)}</dd></div>
            <div><dt>工作区</dt><dd>{updateCheck?.dirty ? '有未提交改动' : updateCheck?.status === 'ok' ? '干净' : '未检查'}</dd></div>
            <div><dt>实时状态</dt><dd>{updateStreamLabel}</dd></div>
          </dl>
          {updateCheck?.error && <p className="settings-error-text">{updateCheck.error}</p>}
          {updateCheck?.dirty && (
            <p className="settings-help-text">检测到服务器工作区有未提交改动，更新可能被 Git 阻止。</p>
          )}
        </section>
        <section className="update-progress-panel" aria-live="polite">
          <div className="update-progress-head">
            <div>
              <span>{updateStatus?.currentStep || '待命'}</span>
              <strong>{updateStatus?.running ? '正在更新' : updateStatusLabel}</strong>
            </div>
            <strong>{updateProgress}%</strong>
          </div>
          <div className="update-progress-track" aria-label={`更新进度 ${updateProgress}%`}>
            <span style={{ width: `${updateProgress}%` }} />
          </div>
          <div className="update-step-list">
            {updateSteps.map((step) => {
              const state = updateStepState(step);
              return (
                <div key={step.phase} className={`update-step ${state}`}>
                  {state === 'done' ? <CheckCircle2 size={14} /> : state === 'failed' ? <AlertTriangle size={14} /> : state === 'active' ? <RefreshCw size={14} /> : <Clock3 size={14} />}
                  <span>{step.label}</span>
                </div>
              );
            })}
          </div>
        </section>
        <div className="settings-inline-actions">
          <button type="button" className="ghost-button" onClick={() => checkForUpdates()} disabled={Boolean(busy) || checkingUpdate || updateStatus?.running}>
            <RefreshCw size={15} />
            {checkingUpdate ? '检查中...' : '检查更新'}
          </button>
          <button type="button" className="icon-button primary" onClick={startUpdate} disabled={!updateCanStart}>
            <Download size={15} />
            {startButtonText}
          </button>
          <button type="button" className="ghost-button" onClick={refreshUpdateStatus} disabled={Boolean(busy)}>
            <Clock3 size={15} />
            刷新状态
          </button>
          <button type="button" className="ghost-button" onClick={copyUpdateLogs} disabled={!(updateStatus?.logs || []).length}>
            <Copy size={15} />
            复制日志
          </button>
        </div>
        {!updateCheck && <p className="settings-help-text">打开弹窗会自动检查一次；也可以手动点击“检查更新”。</p>}
        {updateCheckedLatest && <p className="settings-help-text">当前服务器已经是 GitHub 上该分支的最新版本。</p>}
        {updateStatus?.error && <p className="settings-error-text">{updateStatus.error}</p>}
        <div className="settings-update-log" aria-label="在线更新日志" ref={updateLogRef}>
          {(updateStatus?.logs || []).length
            ? updateStatus.logs.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)
            : <span>暂无更新日志。</span>}
        </div>
      </div>
    );
  }

  function renderWeixinPanel() {
    const streamLabel = weixinStreamState === 'connected'
      ? '实时状态正常'
      : weixinStreamState === 'reconnecting'
        ? '正在重新连接状态通道'
        : weixinStreamState === 'polling'
          ? '已使用轮询刷新'
          : '正在连接状态通道';
    return (
      <div className="weixin-settings-panel">
        <section className={`weixin-connection-banner ${weixinTone}`}>
          <div className="weixin-status-icon"><MessageCircle size={22} /></div>
          <div>
            <span>个人微信私聊</span>
            <strong>{weixinLabel}</strong>
            <p>{weixinConnected ? '微信消息会使用当前任务台数据库和 AI 配置回答。' : '使用微信 ClawBot 扫码授权，不需要安装 OpenClaw。'}</p>
          </div>
          <span className={`settings-status-pill ${weixinTone}`}>{weixinLabel}</span>
        </section>

        {weixinStatus?.qrDataUrl && (
          <section className="weixin-qr-section" aria-live="polite">
            <div className="weixin-qr-frame">
              <img src={weixinStatus.qrDataUrl} alt="微信扫码连接二维码" />
            </div>
            <div className="weixin-qr-copy">
              <span>微信扫码连接</span>
              <h3>{weixinStatus?.status === 'scanned' ? '已扫码，请在手机上确认' : '打开微信扫一扫'}</h3>
              <p>请使用能看到 ClawBot 插件的微信扫码。二维码和登录 token 都由服务器处理。</p>
              {weixinStatus?.qrExpiresAt && <small>二维码有效至 {formatUpdateTime(weixinStatus.qrExpiresAt)}</small>}
            </div>
          </section>
        )}

        {weixinStatus?.needsVerifyCode && (
          <form className="weixin-verify-form" onSubmit={verifyWeixinConnection}>
            <label>
              <span>手机验证码</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={weixinVerifyCode}
                onChange={(event) => setWeixinVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="输入手机微信显示的数字"
                autoComplete="one-time-code"
              />
            </label>
            <button type="submit" className="icon-button primary" disabled={!weixinVerifyCode || Boolean(busy)}>
              <ShieldCheck size={15} />
              {busy === 'weixin-verify' ? '验证中...' : '提交验证码'}
            </button>
          </form>
        )}

        <dl className="weixin-status-grid">
          <div><dt>账号</dt><dd>{weixinStatus?.accountId ? `${weixinStatus.accountId.slice(0, 8)}...` : '未连接'}</dd></div>
          <div><dt>接收方式</dt><dd>仅扫码账号私聊</dd></div>
          <div><dt>最近接收</dt><dd>{formatUpdateTime(weixinStatus?.lastInboundAt)}</dd></div>
          <div><dt>最近回复</dt><dd>{formatUpdateTime(weixinStatus?.lastOutboundAt)}</dd></div>
          <div><dt>临时文件</dt><dd>{weixinStatus?.temporaryMediaTtlHours || 24} 小时清理</dd></div>
          <div><dt>状态通道</dt><dd>{streamLabel}</dd></div>
        </dl>

        <div className="settings-inline-actions">
          <button type="button" className="icon-button primary" onClick={startWeixinConnection} disabled={Boolean(busy)}>
            <QrCode size={16} />
            {busy === 'weixin-login' ? '生成中...' : weixinConnected ? '重新登录' : '扫码连接'}
          </button>
          <button type="button" className="ghost-button danger" onClick={disconnectWeixinConnection} disabled={Boolean(busy) || (!weixinStatus?.connected && !weixinStatus?.accountId)}>
            <Unplug size={16} />
            {busy === 'weixin-disconnect' ? '断开中...' : '断开连接'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={async () => {
              try {
                setWeixinStatus(await api.getWeixinStatus());
              } catch (err) {
                setError(err.message);
              }
            }}
            disabled={Boolean(busy)}
          >
            <RefreshCw size={15} />
            刷新状态
          </button>
        </div>
        {weixinStatus?.error && <p className="settings-error-text">{weixinStatus.error}</p>}
        <div className="weixin-policy-note">
          <Info size={16} />
          <p>图片和文件默认只用于当前问答。明确发送“保存到任务 #编号”“保存到笔记 #编号”或“保存为笔记”后，系统才会生成待审批操作。</p>
        </div>
        <div className="settings-update-log weixin-log" aria-label="微信连接日志">
          {(weixinStatus?.logs || []).length
            ? weixinStatus.logs.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)
            : <span>暂无连接日志。</span>}
        </div>
      </div>
    );
  }

  return (
    <section className="settings-page">
      <div className="settings-hero">
        <div>
          <span>配置中心</span>
          <h2>设置</h2>
          <p>管理 AI 网关、微信连接、访问密码、在线更新和本地备份。敏感配置只保存在服务器，不会下发到前端。</p>
        </div>
        <button type="button" className="ghost-button" onClick={loadSettings} disabled={loading || Boolean(busy)}>
          <RefreshCw size={15} />
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {error && <div className="notice">{error}</div>}
      {loading && <div className="empty-column">正在加载设置...</div>}

      {!loading && (
        <>
          <div className="settings-overview-grid">
            <SettingsEntryCard
              icon={Sparkles}
              eyebrow="AI"
              title="大模型与检索配置"
              status={aiConfigured ? '已配置' : '未配置'}
              statusClassName={aiConfigured ? 'ok' : 'warning'}
              actionLabel="打开 AI 配置"
              onOpen={() => setSettingsModal('ai')}
            >
              <dl className="settings-summary-list">
                <div><dt>聊天模型</dt><dd>{settings?.ai?.litellm?.chatModel || '未设置'}</dd></div>
                <div><dt>向量索引</dt><dd>{settings?.ai?.indexingEnabled ? '已启用' : '未启用'}</dd></div>
                <div><dt>OCR 模型</dt><dd>{settings?.ai?.ocr?.effectiveModel || settings?.ai?.ocr?.model || '未设置'}</dd></div>
              </dl>
            </SettingsEntryCard>
            <SettingsEntryCard
              icon={MessageCircle}
              eyebrow="消息通道"
              title="微信对话"
              status={weixinLabel}
              statusClassName={weixinTone}
              actionLabel={weixinConnected ? '管理微信连接' : '扫码连接微信'}
              onOpen={() => setSettingsModal('weixin')}
            >
              <dl className="settings-summary-list">
                <div><dt>登录方式</dt><dd>ClawBot 扫码</dd></div>
                <div><dt>消息范围</dt><dd>个人私聊</dd></div>
                <div><dt>临时文件</dt><dd>{weixinStatus?.temporaryMediaTtlHours || 24} 小时</dd></div>
              </dl>
            </SettingsEntryCard>
            <SettingsEntryCard
              icon={ShieldCheck}
              eyebrow="安全"
              title="访问密码"
              status={settings?.auth?.passwordEnabled ? '密码登录' : '未启用'}
              statusClassName={settings?.auth?.passwordEnabled ? 'ok' : 'warning'}
              actionLabel="修改密码"
              onOpen={() => setSettingsModal('password')}
            >
              <p className="settings-card-copy">修改进入任务台的访问密码，密码不会下发到前端。</p>
            </SettingsEntryCard>
            <SettingsEntryCard
              icon={Download}
              eyebrow="部署"
              title="GitHub 在线更新"
              status={updateStatusLabel}
              statusClassName={updateTone}
              actionLabel="查看更新"
              onOpen={() => setSettingsModal('update')}
            >
              <dl className="settings-summary-list">
                <div><dt>分支</dt><dd>{updateBranch || 'main'}</dd></div>
                <div><dt>版本</dt><dd>{updateHasNewVersion ? '有新版本' : updateCheckedLatest ? '已是最新' : '未检查'}</dd></div>
                <div><dt>本地</dt><dd>{updateCheck?.localShort || '未检查'}</dd></div>
                <div><dt>远端</dt><dd>{updateCheck?.remoteShort || '未检查'}</dd></div>
              </dl>
            </SettingsEntryCard>
            <SettingsEntryCard
              icon={Save}
              eyebrow="数据安全"
              title="系统备份"
              status="独立管理"
              statusClassName="idle"
              actionLabel="打开备份"
              onOpen={() => setSettingsModal('backup')}
            >
              <p className="settings-card-copy">创建备份、校验最近备份，并查看备份记录。</p>
            </SettingsEntryCard>
          </div>

          {settingsModal === 'ai' && (
            <SettingsModal title="大模型与检索配置" description="调整 AI 网关、向量索引、OCR 和检索服务配置。" onClose={closeSettingsModal} wide>
              {renderAiConfigForm()}
            </SettingsModal>
          )}
          {settingsModal === 'weixin' && (
            <SettingsModal
              title="微信对话连接"
              description="使用微信 ClawBot 扫码连接当前任务台，不需要安装 OpenClaw。"
              onClose={closeSettingsModal}
              wide
            >
              {renderWeixinPanel()}
            </SettingsModal>
          )}
          {settingsModal === 'password' && (
            <SettingsModal title="修改访问密码" description="保存后下次登录会使用新的访问密码。" onClose={closeSettingsModal}>
              {renderPasswordForm()}
            </SettingsModal>
          )}
          {settingsModal === 'update' && (
            <SettingsModal title="GitHub 在线更新" description="从 GitHub 拉取代码并重新构建；不会删除数据库、附件或 .env。" onClose={closeSettingsModal}>
              {renderUpdatePanel()}
            </SettingsModal>
          )}
          {settingsModal === 'backup' && (
            <SettingsModal title="系统与备份" description="备份和校验属于低频维护操作，集中在这里处理。" onClose={closeSettingsModal} wide>
              <SystemView addToast={addToast} compact />
            </SettingsModal>
          )}
        </>
      )}
    </section>
  );
}

function SettingsEntryCard({ icon: IconComponent, eyebrow, title, status, statusClassName = 'idle', actionLabel, onOpen, children }) {
  return (
    <section className="settings-entry-card">
      <div className="settings-entry-icon">
        <IconComponent size={19} />
      </div>
      <div className="settings-card-head">
        <div>
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className={`settings-status-pill ${statusClassName}`}>{status}</span>
      </div>
      <div className="settings-entry-body">{children}</div>
      <button type="button" className="ghost-button" onClick={onOpen}>
        <ExternalLink size={15} />
        {actionLabel}
      </button>
    </section>
  );
}

function SettingsModal({ title, description, onClose, wide = false, children }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <section className={wide ? 'settings-modal wide' : 'settings-modal'} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="round-button small" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="settings-modal-body">
          {children}
        </div>
      </section>
    </div>
  );
}

function reportSummaryTypeLabel(type) {
  if (type === 'weekly') return '周报';
  if (type === 'stage') return '阶段总结';
  return '日报';
}

function ReportView({ dates, onDatesChange, addToast, onNoteSaved }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportModal, setReportModal] = useState('');
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
        `时间范围：${aiSummary.from} 至 ${aiSummary.to}`,
        '',
        aiContentToPlainText(aiSummary.html),
      ].filter(Boolean).join('\n');
      const contentJson = textToRichDoc(plain);
      const note = await api.createStandaloneNote({
        title: `${label}：${aiSummary.from} 至 ${aiSummary.to}`,
        category: 'AI汇总',
        content: plain,
        contentJson,
      });
      setSavedSummaryNoteId(note.id);
      addToast?.('success', '已保存', 'AI 汇总已保存为独立笔记。');
      await onNoteSaved?.(note);
    } catch (err) {
      addToast?.('error', '出错了', err.message);
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
          刷新
        </button>
        <button className="ghost-button" type="button" onClick={() => setReportModal('ai')} disabled={!report || loading}>
          <Sparkles size={16} />
          AI 汇总
        </button>
        <button className="ghost-button" type="button" onClick={() => setReportModal('export')} disabled={!report || loading}>
          <Download size={16} />
          导出
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      {report && (
        <>
          <div className="report-grid">
            <Stat label="记录日志条数" value={report.logs.length} />
            <Stat label="累计投入时长" value={`${report.totalHours}h`} />
            <Stat label="涉及任务个数" value={report.byTask.length} />
            <Stat label="完成关闭任务" value={report.completedTasks.length} />
          </div>
          <div className="report-sections">
            <ReportPanel title="完成内容">
              {report.logs.map((log) => (
                <div className="report-line" key={log.id}>
                  <strong>{log.taskTitle}</strong>
                  <span>{log.content}</span>
                  <em>{log.logDate} · {log.hours}h · 当时进度 {log.progressSnapshot}%</em>
                </div>
              ))}
              {!report.logs.length && <div className="empty-column">该时期无工作记录</div>}
            </ReportPanel>
            <ReportPanel title="进行中任务">
              {report.activeTasks.map((task) => (
                <div className="report-line" key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{statusLabels[task.status]} · 进度已达 {task.progress}%</span>
                  <em>截止日期{formatDate(task.dueDate)}</em>
                </div>
              ))}
              {!report.activeTasks.length && <div className="empty-column">无活动中的未完成任务</div>}
            </ReportPanel>
            <ReportPanel title="下一步计划">
              {report.nextSteps.map((log) => (
                <div className="report-line" key={`${log.id}-next`}>
                  <strong>{log.taskTitle}</strong>
                  <span>{log.nextStep}</span>
                  <em>跟进记录日期{log.logDate}</em>
                </div>
              ))}
              {!report.nextSteps.length && <div className="empty-column">无下一步待办项</div>}
            </ReportPanel>
          </div>
          {reportModal === 'ai' && (
            <SettingsModal title="AI 汇总" description="生成日报、周报或阶段总结；结果确认后可以保存为独立笔记。" onClose={() => setReportModal('')} wide>
              <section className="ai-report-summary-panel compact">
                <div className="ai-report-actions">
                  {[
                    ['daily', '生成日报'],
                    ['weekly', '生成周报'],
                    ['stage', '阶段总结'],
                  ].map(([type, label]) => (
                    <button
                      type="button"
                      key={type}
                      className={aiSummaryType === type ? 'ghost-button active' : 'ghost-button'}
                      onClick={() => generateAiSummary(type)}
                      disabled={aiLoading}
                    >
                      <Sparkles size={14} />
                      {aiLoading && aiSummaryType === type ? '生成中...' : label}
                    </button>
                  ))}
                </div>
                {aiError && <div className="notice">{aiError}</div>}
                {aiSummary ? (
                  <div className="ai-report-result">
                    <div className="ai-report-result-head">
                      <span>{aiSummary.from} 至 {aiSummary.to}</span>
                      <div className="ai-report-result-actions">
                        <CopyButton
                          value={aiContentToPlainText(aiSummary.html)}
                          label="复制总结"
                          copiedLabel="已复制"
                          className="ghost-button"
                        />
                        <button
                          type="button"
                          className={savedSummaryNoteId ? 'ghost-button active' : 'ghost-button'}
                          onClick={saveAiSummaryAsNote}
                          disabled={noteSaving || Boolean(savedSummaryNoteId)}
                        >
                          <Save size={14} />
                          {noteSaving ? '保存中...' : savedSummaryNoteId ? '已保存为笔记' : '保存为笔记'}
                        </button>
                      </div>
                    </div>
                    <div
                      className="ai-html-content"
                      dangerouslySetInnerHTML={{ __html: toSafeAiHtml(aiSummary.html) }}
                    />
                  </div>
                ) : (
                  <div className="empty-column">选择一种汇总类型后开始生成。</div>
                )}
              </section>
            </SettingsModal>
          )}
          {reportModal === 'export' && (
            <SettingsModal title="导出当前汇总" description="选择需要的格式下载当前日期范围内的汇总资料。" onClose={() => setReportModal('')}>
              <div className="report-export-modal-actions" aria-label="导出当前汇总">
                <a className="ghost-button" href={markdownExportUrl}>
                  <Download size={16} />
                  导出 Markdown
                </a>
                <a className="ghost-button" href={excelExportUrl}>
                  <Download size={16} />
                  导出 Excel
                </a>
                <a className="ghost-button" href={pdfExportUrl}>
                  <Download size={16} />
                  导出 PDF
                </a>
              </div>
            </SettingsModal>
          )}
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
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

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
      addToast('success', '已定位笔记', '已跳转到附件关联的笔记。');
      return;
    }
    if (item.taskId) {
      const task = tasks.find((entry) => entry.id === item.taskId);
      if (task) {
        onOpenTask(task, item.kind === 'task' ? 'attachments' : item.kind === 'log' ? 'logs' : 'notes');
        return;
      }
      addToast('info', '提示', '当前筛选下未加载该任务，可在看板清除筛选后再打开。');
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
  const activeFilterCount = [
    filters.taskId,
    filters.fileType !== 'all' ? filters.fileType : '',
    filters.textStatus !== 'all' ? filters.textStatus : '',
    filters.from,
    filters.to,
  ].filter(Boolean).length;

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

  function applyAttachmentFilters() {
    setIsFiltersOpen(false);
    loadAttachments(filters);
  }

  function resetAttachmentFilters() {
    const nextFilters = {
      ...filters,
      taskId: '',
      fileType: 'all',
      textStatus: 'all',
      from: '',
      to: '',
    };
    setFilters(nextFilters);
    setIsFiltersOpen(false);
    loadAttachments(nextFilters);
  }

  async function moveSelectedToTrash() {
    if (!selectedItems.length) return;
    const ok = askConfirm
      ? await askConfirm(
        '移入附件回收站',
        `确定要把选中的 ${selectedItems.length} 个附件移入回收站吗？文件会保留在本机，可在回收站恢复。`,
        { confirmText: '移入回收站', tone: 'danger' },
      )
      : true;
    if (!ok) return;
    try {
      const result = await api.moveAttachmentsToTrash(
        selectedItems.map((item) => ({ kind: item.kind, id: item.id })),
        '附件中心批量移入回收站',
      );
      setSelectedKeys(new Set());
      addToast('success', '已移入回收站', `已处理 ${result.moved || 0} 个附件。`);
      await loadAttachments();
    } catch (err) {
      addToast('error', '出错了', err.message);
    }
  }

  async function retrySelectedOcr() {
    if (!selectedItems.length) return;
    const retryItems = selectedItems.filter((item) => item.attachment?.textStatus !== 'processing');
    if (!retryItems.length) {
      addToast('info', '无需重试', '选中的附件当前正在识别中。');
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
        '已提交识别',
        failCount ? `已提交 ${okCount} 个，${failCount} 个提交失败。` : `已提交 ${okCount} 个附件重新识别。`,
      );
      await loadAttachments();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
          <p className="eyebrow">文件资料</p>
          <h2>附件中心</h2>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadAttachments()} disabled={loading}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>

      <div className="attachment-center-toolbar">
        <div className="attachment-kind-tabs" role="tablist" aria-label="附件类型">
          {[
            ['all', '全部'],
            ['task', '任务附件'],
            ['log', '日志附件'],
            ['note', '笔记附件'],
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
            placeholder="搜索文件名、备注或来源..."
          />
        </label>
        <button className="ghost-button" type="button" onClick={() => loadAttachments()} disabled={loading}>
          <Search size={15} />
          搜索
        </button>
        <button className="ghost-button" type="button" onClick={() => setIsFiltersOpen(true)}>
          <ListFilter size={15} />
          {activeFilterCount ? `筛选 ${activeFilterCount}` : '筛选'}
        </button>
        <button className="ghost-button" type="button" onClick={toggleSelectAllVisible} disabled={!data.items?.length || loading}>
          <CheckCircle2 size={15} />
          {allVisibleSelected ? '取消全选' : '选择当前页'}
        </button>
        <div className="attachment-view-toggle" role="group" aria-label="附件显示方式">
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            <ListFilter size={14} />
            列表
          </button>
          <button
            type="button"
            className={viewMode === 'images' ? 'active' : ''}
            onClick={() => setViewMode('images')}
          >
            <ImageIcon size={14} />
            图片墙
            <span>{imageItems.length}</span>
          </button>
        </div>
      </div>

      {selectedItems.length > 0 && (
      <div className="attachment-bulk-bar">
        <span>已选择 {selectedItems.length} 个附件</span>
        <button
          className="danger-button"
          type="button"
          onClick={moveSelectedToTrash}
          disabled={!selectedItems.length || loading}
        >
          <Trash2 size={15} />
          移入回收站
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={retrySelectedOcr}
          disabled={!selectedItems.length || loading}
        >
          <RefreshCw size={15} />
          重试识别
        </button>
        {selectedItems.length > 0 && (
          <button className="ghost-button" type="button" onClick={() => setSelectedKeys(new Set())}>
            清空选择
          </button>
        )}
      </div>
      )}

      {isFiltersOpen && (
        <SettingsModal title="筛选附件" description="按任务、文件类型、识别状态和上传日期缩小附件列表。" onClose={() => setIsFiltersOpen(false)}>
          <div className="attachment-filter-modal">
            <label>
              <span>任务</span>
              <select value={filters.taskId} onChange={(event) => updateFilter({ taskId: event.target.value })}>
                <option value="">全部任务</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
            </label>
            <label>
              <span>类型</span>
              <select value={filters.fileType} onChange={(event) => updateFilter({ fileType: event.target.value })}>
                <option value="all">全部文件</option>
                <option value="image">图片</option>
                <option value="pdf">PDF</option>
                <option value="document">Word/文档</option>
                <option value="spreadsheet">Excel/表格</option>
                <option value="archive">压缩包</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              <span>识别</span>
              <select value={filters.textStatus} onChange={(event) => updateFilter({ textStatus: event.target.value })}>
                <option value="all">全部状态</option>
                <option value="completed">已识别</option>
                <option value="pending">待识别</option>
                <option value="processing">识别中</option>
                <option value="failed">识别失败</option>
                <option value="unsupported">不支持</option>
                <option value="none">未入队</option>
              </select>
            </label>
            <label>
              <span>开始日期</span>
              <input type="date" value={filters.from} onChange={(event) => updateFilter({ from: event.target.value })} />
            </label>
            <label>
              <span>结束日期</span>
              <input type="date" value={filters.to} onChange={(event) => updateFilter({ to: event.target.value })} />
            </label>
            <div className="settings-form-actions">
              <button type="button" className="ghost-button" onClick={resetAttachmentFilters}>
                清空筛选
              </button>
              <button type="button" className="icon-button primary" onClick={applyAttachmentFilters}>
                <ListFilter size={15} />
                应用筛选
              </button>
            </div>
          </div>
        </SettingsModal>
      )}

      {error && <div className="notice">{error}</div>}
      {loading ? (
        <div className="empty-column">正在读取附件...</div>
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
          <div className="empty-column">当前筛选下暂无图片</div>
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
        <div className="empty-column">暂无附件</div>
      )}
      {previewItem && (
        <div className="attachment-preview-overlay" role="dialog" aria-modal="true" onClick={() => setPreviewItem(null)}>
          <div className="attachment-preview-shell" onClick={(event) => event.stopPropagation()}>
            <div className="attachment-preview-head">
              <div>
                <strong>{previewItem.attachment?.originalName || '图片预览'}</strong>
                <span>{previewItem.sourceTitle || previewItem.taskTitle || previewItem.sourceLabel}</span>
              </div>
              <div>
                <a className="ghost-button" href={previewItem.attachment?.downloadUrl}>
                  <Download size={15} />
                  下载
                </a>
                <button className="round-button small" type="button" onClick={() => setPreviewItem(null)} title="关闭">
                  <X size={15} />
                </button>
              </div>
            </div>
            <img src={previewItem.attachment?.previewUrl} alt={previewItem.attachment?.originalName || '图片预览'} />
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
          aria-label={`选择附件 ${attachment.originalName || item.id}`}
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
        <strong>{attachment.originalName || '图片附件'}</strong>
        <span>{formatFileSize(attachment.fileSize)} · {item.sourceLabel}</span>
      </div>
      <div className="attachment-image-actions">
        <button type="button" onClick={() => onOpenSource(item)}>
          <ExternalLink size={13} />
          来源
        </button>
        <a href={attachment.downloadUrl}>
          <Download size={13} />
          下载
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
      addToast('success', '已保存', '附件备注已更新。');
      setEditingNote(false);
      await onChanged?.();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
            {item.kind === 'task' ? '任务附件' : item.kind === 'log' ? '日志附件' : '笔记附件'}
          </span>
          <h3>{attachment.originalName || '未命名附件'}</h3>
        </div>
        <div className="attachment-center-meta">
          <span>{formatFileSize(attachment.fileSize)}</span>
          <span>{attachment.mimeType || '文件'}</span>
          <span>上传：{item.createdAt || '-'}</span>
          {item.logDate && <span>日志：{formatDate(item.logDate)}</span>}
          {item.noteCategory && <span>分类：{item.noteCategory}</span>}
        </div>
        <button className="attachment-source-button" type="button" onClick={() => onOpenSource(item)}>
          <ExternalLink size={14} />
          <span>{item.sourceTitle || item.taskTitle || '打开来源'}</span>
        </button>
        <button
          className={attachment.note ? 'attachment-note-button' : 'attachment-note-button muted'}
          type="button"
          onClick={() => setEditingNote(true)}
        >
          <Edit3 size={13} />
          <span>{attachment.note || '添加备注'}</span>
        </button>
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
            aria-label={`选择附件 ${attachment.originalName || item.id}`}
          />
          <span>{selected ? '已选' : '选择'}</span>
        </label>
        {attachment.previewUrl && (
          attachment.isImage ? (
            <button className="round-button small" type="button" onClick={() => onPreviewImage(item)} title="预览">
              <ExternalLink size={13} />
            </button>
          ) : (
            <a className="round-button small" href={attachment.previewUrl} target="_blank" rel="noopener noreferrer" title="预览">
              <ExternalLink size={13} />
            </a>
          )
        )}
        <a className="round-button small" href={attachment.downloadUrl} title="下载">
          <Download size={13} />
        </a>
      </div>
      {editingNote && (
        <SettingsModal
          title="编辑附件备注"
          description={attachment.originalName || '附件备注'}
          onClose={() => {
            setNoteDraft(attachment.note || '');
            setEditingNote(false);
          }}
        >
          <div className="attachment-note-modal">
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="写一点附件备注..."
              rows={5}
            />
            <div className="settings-form-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setNoteDraft(attachment.note || '');
                  setEditingNote(false);
                }}
                disabled={savingNote}
              >
                取消
              </button>
              <button className="icon-button primary" type="button" onClick={saveNote} disabled={savingNote}>
                <Save size={13} />
                {savingNote ? '保存中...' : '保存备注'}
              </button>
            </div>
          </div>
        </SettingsModal>
      )}
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
      addToast('success', '已恢复', '项目已从回收站恢复。');
      await loadTrash();
      await onChanged?.();
    } catch (err) {
      addToast('error', '出错了', err.message);
    } finally {
      setBusyKey('');
    }
  }

  async function deleteForever(item) {
    const ok = await askConfirm(
      '确认彻底删除',
      `确定要彻底删除“${item.title}”吗？这会清理数据库记录和相关附件文件，无法从回收站恢复。`,
      { confirmText: '彻底删除', tone: 'danger' },
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
      addToast('success', '已彻底删除', '项目已从回收站永久移除。');
      await loadTrash();
      await onChanged?.();
    } catch (err) {
      addToast('error', '出错了', err.message);
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
          <p className="eyebrow">数据保护</p>
          <h2>回收站</h2>
        </div>
        <button className="ghost-button" type="button" onClick={() => loadTrash()} disabled={loading}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>
      <div className="recycle-tabs" role="tablist" aria-label="回收站类型">
        {[
          ['all', '全部'],
          ['task', '任务'],
          ['log', '日志'],
          ['note', '笔记'],
          ['attachment', '附件'],
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
        <div className="empty-column">正在读取回收站...</div>
      ) : items.length ? (
        <div className="recycle-list">
          {items.map((item) => (
            <article className="recycle-card" key={`${item.type}-${item.kind || 'item'}-${item.id}`}>
              <div className="recycle-card-main">
                <span className={`recycle-kind ${item.type}`}>
                  {item.type === 'task'
                    ? '任务'
                    : item.type === 'log'
                      ? '日志'
                      : item.type === 'note'
                        ? '笔记'
                        : item.kind === 'task'
                          ? '任务附件'
                          : item.kind === 'log'
                            ? '日志附件'
                            : '笔记附件'}
                </span>
                <h3>{item.title}</h3>
                <p>{item.summary || '暂无摘要'}</p>
                <div className="recycle-meta">
                  <span>删除时间：{item.deletedAt || '-'}</span>
                  {item.attachment && (
                    <span>{formatFileSize(item.attachment.fileSize)} · {item.attachment.mimeType || '文件'}</span>
                  )}
                  {item.taskTitle && <span>所属任务：{item.taskTitle}</span>}
                  {item.logDate && <span>日志日期：{formatDate(item.logDate)}</span>}
                  {item.noteTitle && <span>所属笔记：{item.noteTitle}</span>}
                  {item.noteCategory && <span>分类：{item.noteCategory}</span>}
                  {item.category && <span>分类：{item.category}</span>}
                  {item.status && <span>状态：{statusLabels[item.status] || item.status}</span>}
                  {item.priority && <span>优先级：{priorityLabels[item.priority] || item.priority}</span>}
                  {item.counts && (
                    <span>关联：日志 {item.counts.logs} · 笔记 {item.counts.notes} · 附件 {item.counts.attachments}</span>
                  )}
                  {item.taskDeletedAt && <span className="warning-text">所属任务也在回收站，请先恢复任务</span>}
                  {item.logDeletedAt && <span className="warning-text">所属日志也在回收站，请先恢复日志</span>}
                  {item.noteDeletedAt && <span className="warning-text">所属笔记也在回收站，请先恢复笔记</span>}
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
                  {busyKey === `restore-${item.type}-${item.kind || 'item'}-${item.id}` ? '恢复中...' : '恢复'}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => deleteForever(item)}
                  disabled={Boolean(busyKey)}
                >
                  <Trash2 size={15} />
                  {busyKey === `delete-${item.type}-${item.kind || 'item'}-${item.id}` ? '删除中...' : '彻底删除'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-column">回收站为空</div>
      )}
    </section>
  );
}

// Custom confirmation dialog component
function ConfirmModal({ title, message, confirmText = '确认', tone = 'primary', onConfirm, onCancel }) {
  const isDanger = tone === 'danger';
  const IconComponent = isDanger ? AlertTriangle : RefreshCw;

  return (
    <div className="confirm-backdrop">
      <div className="confirm-modal">
        <div className={`confirm-icon ${isDanger ? 'danger' : 'primary'}`}>
          <IconComponent size={24} />
        </div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="ghost-button" onClick={onCancel}>
            取消
          </button>
          <button className={`icon-button primary ${isDanger ? 'confirm-button-danger' : ''}`} onClick={onConfirm}>
            {confirmText}
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
      setError('请输入访问密码。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const status = await api.loginWithPassword(password);
      setPassword('');
      onLogin(status);
    } catch (err) {
      setError(err.message || '登录失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel password-auth-panel" onSubmit={handleSubmit}>
        <ShieldCheck size={32} aria-hidden="true" />
        <h1>个人任务台</h1>
        <p>请输入访问密码后继续管理任务、笔记和工作日志。</p>
        <label className="auth-password-field">
          <span>访问密码</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            placeholder="请输入密码"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? '验证中...' : '进入任务台'}
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
          <h1>任务台暂时无法连</h1>
          <p>{authError}</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            重试
          </button>
        </section>
      </main>
    );
  }

  if (!auth) {
    return <main className="auth-screen" aria-label="正在加载任务台" />;
  }

  if (auth.mode === 'oidc' && !auth.authenticated) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <ClipboardList size={30} aria-hidden="true" />
          <h1>个人任务台</h1>
          <p>请先完成安全登录，再继续管理任务、笔记和工作日志</p>
          <a className="primary-button" href="/auth/login">登录</a>
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
