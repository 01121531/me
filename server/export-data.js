import fs from 'fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getPool } from './db.js';
import { getReportData } from './report-data.js';

const statusLabels = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
};

const priorityLabels = {
  low: '低',
  medium: '中',
  high: '高',
};

function cell(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function tableCell(value) {
  return cell(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function truncate(value, length = 500) {
  const text = cell(value).replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function resolvePdfFontPath() {
  const candidates = [
    process.env.PDF_FONT_PATH,
    'C:/Windows/Fonts/NotoSansSC-VF.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/Deng.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function attachmentDownloadPath(kind, id) {
  const base = {
    log: '/api/attachments',
    note: '/api/note-attachments',
    task: '/api/task-attachments',
  }[kind];
  return `${base}/${id}/download`;
}

export async function getWorkspaceExportData({ from, to } = {}) {
  const report = await getReportData({ from, to });
  const db = getPool();

  const [noteRows] = await db.query(
    `
      SELECT
        n.id,
        n.task_id,
        n.title,
        n.category,
        n.content,
        n.created_at,
        n.updated_at,
        t.title AS task_title
      FROM task_notes n
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.deleted_at IS NULL
        AND (n.task_id IS NULL OR t.deleted_at IS NULL)
        AND DATE(n.updated_at) BETWEEN ? AND ?
      ORDER BY n.updated_at DESC, n.id DESC
    `,
    [report.from, report.to],
  );

  const [attachmentRows] = await db.query(
    `
      SELECT
        'task' AS kind,
        a.id,
        a.original_name,
        a.mime_type,
        a.file_size,
        a.note,
        a.created_at,
        t.id AS task_id,
        t.title AS source_title,
        NULL AS note_id,
        NULL AS log_id
      FROM task_attachments a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.deleted_at IS NULL AND t.deleted_at IS NULL AND DATE(a.created_at) BETWEEN ? AND ?
      UNION ALL
      SELECT
        'note' AS kind,
        a.id,
        a.original_name,
        a.mime_type,
        a.file_size,
        a.note,
        a.created_at,
        n.task_id AS task_id,
        n.title AS source_title,
        n.id AS note_id,
        NULL AS log_id
      FROM note_attachments a
      JOIN task_notes n ON n.id = a.note_id
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE a.deleted_at IS NULL
        AND n.deleted_at IS NULL
        AND (n.task_id IS NULL OR t.deleted_at IS NULL)
        AND DATE(a.created_at) BETWEEN ? AND ?
      UNION ALL
      SELECT
        'log' AS kind,
        a.id,
        a.original_name,
        a.mime_type,
        a.file_size,
        a.note,
        a.created_at,
        l.task_id AS task_id,
        t.title AS source_title,
        NULL AS note_id,
        l.id AS log_id
      FROM log_attachments a
      JOIN work_logs l ON l.id = a.log_id
      JOIN tasks t ON t.id = l.task_id
      WHERE a.deleted_at IS NULL
        AND l.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND DATE(a.created_at) BETWEEN ? AND ?
      ORDER BY created_at DESC, id DESC
    `,
    [report.from, report.to, report.from, report.to, report.from, report.to],
  );

  return {
    ...report,
    notes: noteRows.map((row) => ({
      id: Number(row.id),
      taskId: row.task_id ? Number(row.task_id) : null,
      taskTitle: row.task_title || '',
      title: row.title || '未命名笔记',
      category: row.category || '',
      content: row.content || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    attachments: attachmentRows.map((row) => ({
      kind: row.kind,
      id: Number(row.id),
      taskId: row.task_id ? Number(row.task_id) : null,
      noteId: row.note_id ? Number(row.note_id) : null,
      logId: row.log_id ? Number(row.log_id) : null,
      sourceTitle: row.source_title || '',
      originalName: row.original_name || '',
      mimeType: row.mime_type || '',
      fileSize: Number(row.file_size || 0),
      note: row.note || '',
      createdAt: row.created_at,
      downloadPath: attachmentDownloadPath(row.kind, row.id),
    })),
  };
}

export function workspaceExportFileName(data, extension) {
  return `assistant-workspace-${data.from}-${data.to}.${extension}`;
}

export function createMarkdownExport(data) {
  const lines = [
    '# 个人助理任务台导出',
    '',
    `- 日期范围：${data.from} 至 ${data.to}`,
    `- 总耗时：${data.totalHours} 小时`,
    `- 工作日志：${data.logs.length} 条`,
    `- 未完成任务：${data.activeTasks.length} 个`,
    `- 已完成任务：${data.completedTasks.length} 个`,
    `- 笔记：${data.notes.length} 条`,
    `- 附件：${data.attachments.length} 个`,
    '',
    '## 任务概览',
    '',
    '| 标题 | 状态 | 优先级 | 进度 | 截止日期 | 标签 |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...[...data.activeTasks, ...data.completedTasks].map((task) => (
      `| ${tableCell(task.title)} | ${tableCell(statusLabels[task.status] || task.status)} | ${tableCell(priorityLabels[task.priority] || task.priority)} | ${task.progress}% | ${tableCell(task.dueDate)} | ${tableCell((task.tags || []).join('、'))} |`
    )),
    '',
    '## 工作日志',
    '',
    '| 日期 | 任务 | 阶段 | 耗时 | 进度快照 | 工作内容 | 下一步 |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...data.logs.map((log) => (
      `| ${tableCell(log.logDate)} | ${tableCell(log.taskTitle)} | ${tableCell(statusLabels[log.stage] || log.stage)} | ${log.hours} | ${log.progressSnapshot}% | ${tableCell(log.content)} | ${tableCell(log.nextStep)} |`
    )),
    '',
    '## 笔记',
    '',
    '| 标题 | 分类 | 关联任务 | 更新时间 | 内容摘要 |',
    '| --- | --- | --- | --- | --- |',
    ...data.notes.map((note) => (
      `| ${tableCell(note.title)} | ${tableCell(note.category)} | ${tableCell(note.taskTitle || '独立笔记')} | ${tableCell(note.updatedAt)} | ${tableCell(truncate(note.content))} |`
    )),
    '',
    '## 附件清单',
    '',
    '| 文件名 | 类型 | 来源 | 大小 | 上传时间 | 下载路径 | 备注 |',
    '| --- | --- | --- | ---: | --- | --- | --- |',
    ...data.attachments.map((attachment) => (
      `| ${tableCell(attachment.originalName)} | ${tableCell(attachment.mimeType)} | ${tableCell(attachment.sourceTitle)} | ${attachment.fileSize} | ${tableCell(attachment.createdAt)} | ${tableCell(attachment.downloadPath)} | ${tableCell(attachment.note)} |`
    )),
    '',
  ];
  return lines.join('\n');
}

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 18,
  }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF6FF' },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + columns.length)}1`,
  };
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
  return sheet;
}

export async function createExcelExport(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'assistant-task-board';
  workbook.created = new Date();

  addSheet(workbook, '概览', [
    { header: '项目', key: 'name', width: 18 },
    { header: '数值', key: 'value', width: 24 },
  ], [
    { name: '日期范围', value: `${data.from} 至 ${data.to}` },
    { name: '总耗时', value: `${data.totalHours} 小时` },
    { name: '工作日志', value: data.logs.length },
    { name: '未完成任务', value: data.activeTasks.length },
    { name: '已完成任务', value: data.completedTasks.length },
    { name: '笔记', value: data.notes.length },
    { name: '附件', value: data.attachments.length },
  ]);

  addSheet(workbook, '任务', [
    { header: '标题', key: 'title', width: 30 },
    { header: '状态', key: 'status', width: 12 },
    { header: '优先级', key: 'priority', width: 12 },
    { header: '进度', key: 'progress', width: 10 },
    { header: '截止日期', key: 'dueDate', width: 14 },
    { header: '标签', key: 'tags', width: 24 },
    { header: '说明', key: 'description', width: 42 },
  ], [...data.activeTasks, ...data.completedTasks].map((task) => ({
    title: task.title,
    status: statusLabels[task.status] || task.status,
    priority: priorityLabels[task.priority] || task.priority,
    progress: `${task.progress}%`,
    dueDate: task.dueDate || '',
    tags: (task.tags || []).join('、'),
    description: task.description || '',
  })));

  addSheet(workbook, '日志', [
    { header: '日期', key: 'logDate', width: 14 },
    { header: '任务', key: 'taskTitle', width: 30 },
    { header: '阶段', key: 'stage', width: 12 },
    { header: '耗时', key: 'hours', width: 10 },
    { header: '进度快照', key: 'progressSnapshot', width: 12 },
    { header: '工作内容', key: 'content', width: 48 },
    { header: '下一步', key: 'nextStep', width: 42 },
  ], data.logs.map((log) => ({
    logDate: log.logDate,
    taskTitle: log.taskTitle,
    stage: statusLabels[log.stage] || log.stage,
    hours: log.hours,
    progressSnapshot: `${log.progressSnapshot}%`,
    content: log.content,
    nextStep: log.nextStep,
  })));

  addSheet(workbook, '笔记', [
    { header: '标题', key: 'title', width: 32 },
    { header: '分类', key: 'category', width: 16 },
    { header: '关联任务', key: 'taskTitle', width: 30 },
    { header: '更新时间', key: 'updatedAt', width: 22 },
    { header: '内容', key: 'content', width: 60 },
  ], data.notes.map((note) => ({
    title: note.title,
    category: note.category,
    taskTitle: note.taskTitle || '独立笔记',
    updatedAt: note.updatedAt,
    content: note.content,
  })));

  addSheet(workbook, '附件', [
    { header: '文件名', key: 'originalName', width: 36 },
    { header: '类型', key: 'mimeType', width: 24 },
    { header: '来源', key: 'sourceTitle', width: 30 },
    { header: '大小', key: 'fileSize', width: 14 },
    { header: '上传时间', key: 'createdAt', width: 22 },
    { header: '下载路径', key: 'downloadPath', width: 38 },
    { header: '备注', key: 'note', width: 28 },
  ], data.attachments);

  return workbook.xlsx.writeBuffer();
}

export function createPdfExport(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: {
        Title: `个人助理任务台导出 ${data.from} 至 ${data.to}`,
        Author: 'assistant-task-board',
        Subject: '工作任务、日志、笔记和附件导出',
      },
    });
    const chunks = [];
    let fontPath = resolvePdfFontPath();
    let fontLoadFailed = false;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cardX = doc.page.margins.left;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const useFont = () => {
      if (fontPath) {
        try {
          doc.font(fontPath);
          return;
        } catch {
          fontPath = null;
          fontLoadFailed = true;
        }
      }
      doc.font('Helvetica');
    };
    const ensureSpace = (height) => {
      if (doc.y + height > bottom()) doc.addPage();
      useFont();
    };
    const section = (title) => {
      ensureSpace(44);
      doc.moveDown(0.8);
      useFont();
      doc.fontSize(15).fillColor('#0f172a').text(title, { width: pageWidth });
      doc.moveTo(cardX, doc.y + 5).lineTo(cardX + pageWidth, doc.y + 5).strokeColor('#dbe4ef').lineWidth(1).stroke();
      doc.moveDown(0.8);
    };
    const paragraph = (text, options = {}) => {
      useFont();
      doc.fontSize(options.size || 10).fillColor(options.color || '#475569').text(cell(text), {
        width: options.width || pageWidth,
        lineGap: options.lineGap ?? 3,
      });
    };
    const metric = (label, value, index) => {
      const columns = 3;
      const gap = 10;
      const width = (pageWidth - gap * (columns - 1)) / columns;
      const x = cardX + (index % columns) * (width + gap);
      const y = doc.y + Math.floor(index / columns) * 58;
      doc.save();
      doc.roundedRect(x, y, width, 44, 6).fillAndStroke('#f8fafc', '#dbe4ef');
      doc.restore();
      useFont();
      doc.fontSize(8).fillColor('#64748b').text(label, x + 10, y + 8, { width: width - 20 });
      doc.fontSize(16).fillColor('#0f172a').text(String(value), x + 10, y + 22, { width: width - 20 });
    };
    const card = (title, lines, options = {}) => {
      const cleanLines = lines.filter((line) => line !== null && line !== undefined && line !== '');
      useFont();
      const body = cleanLines.join('\n');
      const titleHeight = doc.heightOfString(cell(title), { width: pageWidth - 24, lineGap: 2 });
      const bodyHeight = doc.heightOfString(body || '无补充内容', { width: pageWidth - 24, lineGap: 3 });
      const height = Math.max(64, titleHeight + bodyHeight + 30);
      ensureSpace(height + 10);
      const y = doc.y;
      doc.save();
      doc.roundedRect(cardX, y, pageWidth, height, 7).fillAndStroke(options.fill || '#ffffff', '#dbe4ef');
      if (options.accent) {
        doc.rect(cardX, y, 4, height).fill(options.accent);
      }
      doc.restore();
      useFont();
      doc.fontSize(12).fillColor('#0f172a').text(cell(title), cardX + 14, y + 10, { width: pageWidth - 28, lineGap: 2 });
      doc.fontSize(9.5).fillColor('#475569').text(body || '无补充内容', cardX + 14, doc.y + 5, { width: pageWidth - 28, lineGap: 3 });
      doc.y = y + height + 10;
    };

    useFont();
    doc.fontSize(22).fillColor('#0f172a').text('个人助理任务台导出', { width: pageWidth });
    paragraph(`日期范围：${data.from} 至 ${data.to}`, { color: '#64748b' });
    paragraph(`生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`, { color: '#64748b' });
    if (!fontPath || fontLoadFailed) {
      paragraph('提示：当前未找到中文 PDF 字体，可在 .env 设置 PDF_FONT_PATH 指向中文字体文件。', { color: '#b45309' });
    }
    doc.moveDown(0.8);

    ensureSpace(122);
    [
      ['总耗时', `${data.totalHours} 小时`],
      ['工作日志', data.logs.length],
      ['未完成任务', data.activeTasks.length],
      ['已完成任务', data.completedTasks.length],
      ['笔记', data.notes.length],
      ['附件', data.attachments.length],
    ].forEach(([label, value], index) => metric(label, value, index));
    doc.y += 122;

    section('任务概览');
    const tasks = [...data.activeTasks, ...data.completedTasks];
    if (!tasks.length) paragraph('当前日期范围内没有任务。');
    tasks.forEach((task) => {
      card(task.title, [
        `状态：${statusLabels[task.status] || task.status}    优先级：${priorityLabels[task.priority] || task.priority}    进度：${task.progress}%`,
        `截止日期：${task.dueDate || '-'}`,
        `标签：${(task.tags || []).join('、') || '-'}`,
        task.description ? `说明：${truncate(task.description, 360)}` : '',
      ], { accent: task.status === 'done' ? '#22c55e' : task.status === 'in_progress' ? '#6366f1' : '#94a3b8' });
    });

    section('工作日志');
    if (!data.logs.length) paragraph('当前日期范围内没有工作日志。');
    data.logs.forEach((log) => {
      card(`${log.logDate} · ${log.taskTitle}`, [
        `阶段：${statusLabels[log.stage] || log.stage}    耗时：${log.hours} 小时    进度快照：${log.progressSnapshot}%`,
        `工作内容：${truncate(log.content, 520)}`,
        log.nextStep ? `下一步：${truncate(log.nextStep, 360)}` : '',
      ], { fill: '#fbfdff', accent: '#0ea5e9' });
    });

    section('笔记');
    if (!data.notes.length) paragraph('当前日期范围内没有笔记。');
    data.notes.forEach((note) => {
      card(note.title, [
        `分类：${note.category || '-'}    关联任务：${note.taskTitle || '独立笔记'}    更新时间：${cell(note.updatedAt)}`,
        `内容：${truncate(note.content, 650)}`,
      ], { fill: '#fffdf7', accent: '#f59e0b' });
    });

    section('附件清单');
    if (!data.attachments.length) paragraph('当前日期范围内没有附件。');
    data.attachments.forEach((attachment) => {
      card(attachment.originalName || `附件 #${attachment.id}`, [
        `来源：${attachment.sourceTitle || '-'}    类型：${attachment.mimeType || '-'}    大小：${formatFileSize(attachment.fileSize)}`,
        `上传时间：${cell(attachment.createdAt)}`,
        `下载路径：${attachment.downloadPath}`,
        attachment.note ? `备注：${truncate(attachment.note, 260)}` : '',
      ], { fill: '#fbfffb', accent: '#10b981' });
    });

    doc.end();
  });
}
