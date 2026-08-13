import assert from 'node:assert/strict';
import {
  buildOnlineUpdateCheckResult,
  checkOnlineUpdate,
} from '../settings.js';

const base = {
  branch: 'main',
  checkedAt: '2026-06-29T00:00:00.000Z',
  currentBranch: 'main',
  localCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  dirty: false,
};

const latest = buildOnlineUpdateCheckResult({
  ...base,
  remoteCommit: base.localCommit,
});
assert.equal(latest.status, 'ok');
assert.equal(latest.hasUpdate, false);
assert.equal(latest.localShort, 'aaaaaaaa');
assert.equal(latest.remoteShort, 'aaaaaaaa');

const newer = buildOnlineUpdateCheckResult({
  ...base,
  remoteCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});
assert.equal(newer.status, 'ok');
assert.equal(newer.hasUpdate, true);
assert.equal(newer.remoteShort, 'bbbbbbbb');

await assert.rejects(
  () => checkOnlineUpdate({ branch: '-bad-branch' }),
  /分支名称不合法/,
);

console.log('Update check smoke test passed: latest, new version, and invalid branch cases work.');
