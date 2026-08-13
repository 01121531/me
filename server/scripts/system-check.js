import { closePool, ensureDatabase, getPool } from '../db.js';
import { runSystemChecks } from '../reliability-checks.js';

function printCheckGroup(title, group) {
  console.log(`\n${title}：${group.status}`);
  for (const check of group.checks || []) {
    console.log(`- [${check.status}] ${check.name}：${check.message}`);
  }
}

function printAttachmentSummary(attachments) {
  const summary = attachments.summary || {};
  console.log('\n附件存储摘要：');
  console.log(`- 附件记录：${summary.totalRecords || 0}`);
  console.log(`- 本地附件：${summary.localRecords || 0}`);
  console.log(`- 已检查文件：${summary.checkedLocalFiles || 0}`);
  console.log(`- 缺失文件：${summary.missingFiles || 0}`);
  console.log(`- 大小不一致：${summary.sizeMismatches || 0}`);
  console.log(`- 异常路径：${summary.invalidPaths || 0}`);
  console.log(`- 孤立文件：${summary.orphanFiles || 0}`);
}

async function main() {
  const jsonOutput = process.argv.includes('--json');
  await ensureDatabase();
  const result = await runSystemChecks(getPool());

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`系统检查状态：${result.status}`);
    console.log(`生成时间：${result.generatedAt}`);
    printCheckGroup('运行配置', result.runtimeConfig);
    printCheckGroup('数据库', result.database);
    printCheckGroup('附件存储', result.attachments);
    printAttachmentSummary(result.attachments);
  }

  process.exitCode = result.status === 'error' ? 1 : 0;
}

main()
  .catch((error) => {
    console.error('系统检查失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
