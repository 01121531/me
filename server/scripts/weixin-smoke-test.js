import assert from 'node:assert/strict';
import { htmlToPlainText, getWeixinStatus } from '../weixin/service.js';
import { mimeFromFileName, normalizeBaseUrl } from '../weixin/protocol.js';

const plain = htmlToPlainText('<section><h3>任务</h3><dl><dt>状态</dt><dd>进行中</dd></dl><ul><li>核对合同</li></ul></section>');
assert.match(plain, /任务/);
assert.match(plain, /状态：进行中/);
assert.match(plain, /• 核对合同/);

assert.equal(normalizeBaseUrl('https://ilinkai.weixin.qq.com/'), 'https://ilinkai.weixin.qq.com');
assert.equal(mimeFromFileName('资料.PDF'), 'application/pdf');
assert.equal(mimeFromFileName('表格.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

const status = getWeixinStatus();
assert.equal(status.privateChatOnly, true);
assert.equal(Object.hasOwn(status, 'token'), false);
assert.equal(Object.hasOwn(status, 'ownerUserId'), false);
assert.ok(status.temporaryMediaTtlHours >= 1);

console.log('WeChat connector smoke test passed.');
