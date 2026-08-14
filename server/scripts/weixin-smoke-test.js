import assert from 'node:assert/strict';
import {
  getWeixinStatus,
  htmlToPlainText,
  parseWeixinAttachmentSelection,
  parseWeixinMediaSaveInstruction,
  selectAttachmentSourcesForReply,
} from '../weixin/service.js';
import { mimeFromFileName, normalizeBaseUrl } from '../weixin/protocol.js';

const plain = htmlToPlainText('<section><h3>任务</h3><dl><dt>状态</dt><dd>进行中</dd></dl><ul><li>核对合同</li></ul></section>');
assert.match(plain, /任务/);
assert.match(plain, /状态：进行中/);
assert.match(plain, /• 核对合同/);

assert.equal(normalizeBaseUrl('https://ilinkai.weixin.qq.com/'), 'https://ilinkai.weixin.qq.com');
assert.equal(mimeFromFileName('资料.PDF'), 'application/pdf');
assert.equal(mimeFromFileName('表格.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

const saveInstruction = parseWeixinMediaSaveInstruction(
  '图片这个保存在一个新创笔记中，笔记内容为汇川资料，图片命名为章',
  '微信图片-123.jpg',
);
assert.equal(saveInstruction.createAsNote, true);
assert.equal(saveInstruction.content, '汇川资料');
assert.equal(saveInstruction.title, '');
assert.equal(saveInstruction.originalName, '章.jpg');

const selectedPdf = selectAttachmentSourcesForReply('你给我发一个 PDF', [
  { entityType: 'note_attachment', entityId: 1, mimeType: 'image/jpeg', fileName: '图片.jpg' },
  { entityType: 'task_attachment', entityId: 2, mimeType: 'application/pdf', fileName: '资料.pdf' },
]);
assert.equal(selectedPdf.length, 1);
assert.equal(selectedPdf[0].fileName, '资料.pdf');

const resourceSources = [
  { entityType: 'resource', entityId: 11, mimeType: 'application/pdf', fileName: '合同资料.pdf', downloadUrl: '/api/v1/resources/a/versions/b/download' },
  { entityType: 'resource', entityId: 12, mimeType: 'application/pdf', fileName: '深圳混元统一社会信用代码.pdf', downloadUrl: '/api/v1/resources/c/versions/d/download' },
  { entityType: 'task_attachment', entityId: 13, mimeType: 'application/pdf', fileName: '旧附件.pdf' },
];
const resourceCandidates = selectAttachmentSourcesForReply('把资料库里的文件发给我', resourceSources);
assert.equal(resourceCandidates.length, 2);
assert.ok(resourceCandidates.every((source) => source.entityType === 'resource'));
const namedResource = selectAttachmentSourcesForReply('把深圳混元统一社会信用代码.pdf发给我', resourceSources);
assert.equal(namedResource.length, 1);
assert.equal(namedResource[0].entityId, 12);
assert.equal(parseWeixinAttachmentSelection('发第 2 个'), 1);
assert.equal(parseWeixinAttachmentSelection('给我第3份'), 2);
assert.equal(parseWeixinAttachmentSelection('把任务 3 改成完成'), null);

const status = getWeixinStatus();
assert.equal(status.privateChatOnly, true);
assert.equal(Object.hasOwn(status, 'token'), false);
assert.equal(Object.hasOwn(status, 'ownerUserId'), false);
assert.equal(status.canSendResources, false);
assert.ok(status.temporaryMediaTtlHours >= 1);

console.log('WeChat connector smoke test passed.');
