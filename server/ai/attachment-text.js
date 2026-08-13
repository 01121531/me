import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

function trimText(value, maxChars) {
  const text = String(value || '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[内容已截断]` : text;
}

function excelCellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    if (value.text) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.hyperlink) return String(value.hyperlink);
  }
  return String(value);
}

async function extractPdf(buffer, maxChars) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return trimText(result.text, maxChars);
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer, maxChars) {
  const result = await mammoth.extractRawText({ buffer });
  return trimText(result.value, maxChars);
}

async function extractXlsx(buffer, maxChars) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer, {
    ignoreNodes: ['dataValidations', 'drawing', 'extLst', 'hyperlinks', 'pageMargins', 'pageSetup'],
  });

  const lines = [];
  for (const worksheet of workbook.worksheets) {
    lines.push(`工作表：${worksheet.name}`);
    let rows = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows >= 10000 || lines.join('\n').length >= maxChars) return;
      const values = row.values
        .slice(1, 41)
        .map(excelCellText)
        .filter(Boolean);
      if (values.length) lines.push(values.join(' | '));
      rows += 1;
    });
  }
  return trimText(lines.join('\n'), maxChars);
}

export async function extractAttachmentText(attachment, buffer, maxChars) {
  const extension = path.extname(attachment.original_name || '').toLowerCase();
  if (extension === '.pdf') return { parser: 'pdf', text: await extractPdf(buffer, maxChars) };
  if (extension === '.docx') return { parser: 'docx', text: await extractDocx(buffer, maxChars) };
  if (extension === '.xlsx') return { parser: 'xlsx', text: await extractXlsx(buffer, maxChars) };
  if (extension === '.csv') return { parser: 'csv', text: trimText(buffer.toString('utf8'), maxChars) };
  return { parser: null, text: '' };
}
