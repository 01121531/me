import { promises as fsp, constants as fsConstants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getAnalyticsReadiness } from './analytics-readiness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const attachmentSources = [
  { kind: 'log', label: '日志附件', table: 'log_attachments', ownerColumn: 'log_id' },
  { kind: 'note', label: '笔记附件', table: 'note_attachments', ownerColumn: 'note_id' },
  { kind: 'task', label: '任务附件', table: 'task_attachments', ownerColumn: 'task_id' },
];

const placeholderValues = new Set([
  'replace-me',
  'replace-with-a-long-random-value',
  'replace-with-a-long-random-token',
  'chat-primary',
  'embeddings-primary',
]);

function pdfFontCandidates() {
  return [
    process.env.PDF_FONT_PATH,
    'C:/Windows/Fonts/NotoSansSC-VF.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/Deng.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
  ].filter(Boolean);
}

function statusRank(status) {
  return { ok: 0, warning: 1, error: 2 }[status] ?? 0;
}

function worstStatus(...statuses) {
  return statuses.reduce((current, status) => (
    statusRank(status) > statusRank(current) ? status : current
  ), 'ok');
}

function makeCheck(name, status, message, details = {}) {
  return { name, status, message, details };
}

function configuredEnv(name) {
  const value = process.env[name];
  return value !== undefined && String(value).trim() !== '';
}

function hasPlaceholderEnv(name) {
  const value = String(process.env[name] || '').trim();
  return !value || placeholderValues.has(value);
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function pathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRelative(target, root = projectRoot) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : target;
}

async function collectFiles(root) {
  if (!(await pathExists(root))) return [];
  const files = [];
  const visit = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  };
  await visit(root);
  return files;
}

function resolveLocalAttachmentPath(row) {
  const localRoot = path.resolve(config.storage.localRoot);
  if (row.storage_key) {
    const absolute = path.resolve(localRoot, row.storage_key);
    if (!pathInside(absolute, localRoot)) {
      throw new Error('附件 storage_key 超出本地存储目录。');
    }
    return absolute;
  }

  const relativePath = String(row.relative_path || '');
  const legacyRoot = path.resolve(projectRoot, 'uploads');
  if (relativePath.startsWith('uploads/')) {
    const absolute = path.resolve(projectRoot, relativePath);
    if (!pathInside(absolute, legacyRoot)) {
      throw new Error('附件 relative_path 超出 uploads 目录。');
    }
    return absolute;
  }

  const absolute = path.resolve(localRoot, relativePath);
  if (!pathInside(absolute, localRoot)) {
    throw new Error('附件 relative_path 超出本地存储目录。');
  }
  return absolute;
}

export async function checkRuntimeConfig() {
  const checks = [];
  const envPath = path.join(projectRoot, '.env');
  const envExamplePath = path.join(projectRoot, '.env.example');
  const gitignorePath = path.join(projectRoot, '.gitignore');

  checks.push(makeCheck(
    '.env 文件',
    await pathExists(envPath) ? 'ok' : 'warning',
    await pathExists(envPath)
      ? '.env 已存在，运行时配置会从本机环境读取。'
      : '没有找到 .env 文件，当前会使用默认配置或系统环境变量。',
  ));

  checks.push(makeCheck(
    '.env.example 文件',
    await pathExists(envExamplePath) ? 'ok' : 'warning',
    await pathExists(envExamplePath)
      ? '.env.example 已存在，便于部署时补齐配置。'
      : '没有找到 .env.example，后续部署时不方便对照配置项。',
  ));

  if (await pathExists(gitignorePath)) {
    const gitignore = await fsp.readFile(gitignorePath, 'utf8');
    const ignoresEnv = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line === '.env' || line === '*.env' || line === '.env*');
    checks.push(makeCheck(
      '.env Git 忽略',
      ignoresEnv ? 'ok' : 'warning',
      ignoresEnv ? '.env 已在 .gitignore 中，密钥不容易误提交。' : '.env 未明确加入 .gitignore，请避免把密钥提交到仓库。',
    ));
  } else {
    checks.push(makeCheck('.gitignore 文件', 'warning', '没有找到 .gitignore，请确认 .env 不会被提交。'));
  }

  const dbMissing = ['DB_HOST', 'DB_USER', 'DB_DATABASE'].filter((name) => !configuredEnv(name));
  checks.push(makeCheck(
    'MySQL 配置',
    dbMissing.length ? 'warning' : 'ok',
    dbMissing.length
      ? `缺少 ${dbMissing.join('、')}，当前会使用默认值。`
      : 'MySQL 主机、用户和数据库名称已配置。',
    { missing: dbMissing },
  ));

  checks.push(makeCheck(
    'MySQL 密码',
    configuredEnv('DB_PASSWORD') ? 'ok' : 'warning',
    configuredEnv('DB_PASSWORD')
      ? 'DB_PASSWORD 已配置。'
      : 'DB_PASSWORD 为空，本机可用但不适合服务器部署。',
  ));

  const storageStatus = config.storage.driver === 'local' || config.storage.driver === 's3' ? 'ok' : 'error';
  checks.push(makeCheck(
    '附件存储驱动',
    storageStatus,
    `当前附件存储驱动为 ${config.storage.driver}。`,
    { driver: config.storage.driver },
  ));

  if (config.storage.driver === 'local') {
    const localRoot = path.resolve(config.storage.localRoot);
    try {
      await fsp.mkdir(localRoot, { recursive: true });
      await fsp.access(localRoot, fsConstants.R_OK | fsConstants.W_OK);
      checks.push(makeCheck('本地附件目录', 'ok', '本地附件目录可读写。', {
        path: safeRelative(localRoot),
      }));
    } catch (error) {
      checks.push(makeCheck('本地附件目录', 'error', '本地附件目录不可读写。', {
        path: safeRelative(localRoot),
        error: error.message,
      }));
    }
  } else {
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
      .filter((name) => !configuredEnv(name) || hasPlaceholderEnv(name));
    checks.push(makeCheck(
      'S3/MinIO 配置',
      missing.length ? 'error' : 'ok',
      missing.length ? `S3/MinIO 缺少有效配置：${missing.join('、')}。` : 'S3/MinIO 必要配置已填写。',
      { missing },
    ));
  }

  const availablePdfFont = (await Promise.all(
    pdfFontCandidates().map(async (candidate) => ((await pathExists(candidate)) ? candidate : null)),
  )).find(Boolean);
  checks.push(makeCheck(
    'PDF 中文字体',
    availablePdfFont ? 'ok' : 'warning',
    availablePdfFont
      ? 'PDF 导出可使用中文字体。'
      : '未找到可用中文字体，PDF 中文可能显示异常；可在 .env 设置 PDF_FONT_PATH。',
    { fontPath: availablePdfFont ? safeRelative(availablePdfFont) : '' },
  ));

  const aiMissing = ['LITELLM_BASE_URL', 'LITELLM_API_KEY', 'LITELLM_CHAT_MODEL']
    .filter((name) => !configuredEnv(name) || hasPlaceholderEnv(name));
  checks.push(makeCheck(
    'AI 对话配置',
    aiMissing.length ? 'warning' : 'ok',
    aiMissing.length
      ? `AI 对话配置不完整：${aiMissing.join('、')}。普通任务功能不受影响，AI 功能可能不可用。`
      : 'AI 对话网关、密钥和聊天模型已配置。',
    { missing: aiMissing },
  ));

  const ocrMissing = ['OCR_BASE_URL', 'OCR_API_KEY', 'OCR_MODEL']
    .filter((name) => {
      const fallbackName = name.replace('OCR_', 'LITELLM_').replace('MODEL', 'CHAT_MODEL');
      return (!configuredEnv(name) || hasPlaceholderEnv(name))
        && (!configuredEnv(fallbackName) || hasPlaceholderEnv(fallbackName));
    });
  checks.push(makeCheck(
    'OCR 视觉模型配置',
    ocrMissing.length ? 'warning' : 'ok',
    ocrMissing.length
      ? 'OCR 未配置独立视觉模型，也没有完整的 LiteLLM 回退配置；扫描版 PDF 识别可能不可用。'
      : 'OCR 可使用独立配置或 LiteLLM 回退配置。',
    { missing: ocrMissing },
  ));

  if (config.ai.indexingEnabled) {
    const missing = ['LITELLM_EMBEDDING_MODEL', 'QDRANT_URL']
      .filter((name) => !configuredEnv(name) || hasPlaceholderEnv(name));
    checks.push(makeCheck(
      '向量索引配置',
      missing.length ? 'error' : 'ok',
      missing.length ? `已开启向量索引，但缺少 ${missing.join('、')}。` : '向量索引必要配置已填写。',
      { missing },
    ));
  } else {
    checks.push(makeCheck('向量索引配置', 'ok', 'AI_INDEXING_ENABLED=false，当前不会启动向量索引写入。'));
  }

  checks.push(makeCheck(
    '登录权限配置',
    config.auth.mode === 'disabled' ? 'warning' : 'ok',
    config.auth.mode === 'disabled'
      ? '当前未启用登录权限，适合本机个人使用；部署公网前需要补登录和权限。'
      : '当前已启用登录模式。',
    { authMode: config.auth.mode },
  ));

  const status = checks.reduce((current, check) => worstStatus(current, check.status), 'ok');
  return { status, checks };
}

export async function checkDatabase(db) {
  const checks = [];
  try {
    const [rows] = await db.query('SELECT DATABASE() AS database_name, @@time_zone AS time_zone');
    checks.push(makeCheck('MySQL 连接', 'ok', '数据库连接正常。', {
      database: rows[0]?.database_name || config.db.database,
      timeZone: rows[0]?.time_zone || '',
    }));
  } catch (error) {
    checks.push(makeCheck('MySQL 连接', 'error', '数据库连接失败。', { error: error.message }));
    return { status: 'error', checks };
  }

  const requiredTables = [
    'tasks',
    'work_logs',
    'task_notes',
    'log_attachments',
    'note_attachments',
    'task_attachments',
    'attachment_text_cache',
  ];
  try {
    const [rows] = await db.query(
      `
        SELECT TABLE_NAME AS table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${requiredTables.map(() => '?').join(',')})
      `,
      requiredTables,
    );
    const existing = new Set(rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !existing.has(table));
    checks.push(makeCheck(
      '核心数据表',
      missing.length ? 'error' : 'ok',
      missing.length ? `缺少核心数据表：${missing.join('、')}。` : '核心数据表齐全。',
      { missing },
    ));
  } catch (error) {
    checks.push(makeCheck('核心数据表', 'error', '核心数据表检查失败。', { error: error.message }));
  }

  const status = checks.reduce((current, check) => worstStatus(current, check.status), 'ok');
  return { status, checks };
}

export async function checkAttachmentStorage(db) {
  const localRoot = path.resolve(config.storage.localRoot);
  const rows = [];
  for (const source of attachmentSources) {
    const [sourceRows] = await db.query(
      `
        SELECT
          id,
          ${source.ownerColumn} AS owner_id,
          original_name,
          relative_path,
          storage_provider,
          storage_key,
          file_size,
          created_at
        FROM ${source.table}
        ORDER BY id ASC
      `,
    );
    sourceRows.forEach((row) => rows.push({ ...row, source }));
  }

  const summary = {
    totalRecords: rows.length,
    localRecords: 0,
    s3Records: 0,
    checkedLocalFiles: 0,
    missingFiles: 0,
    sizeMismatches: 0,
    invalidPaths: 0,
    orphanFiles: 0,
    storageRoot: safeRelative(localRoot),
  };
  const samples = {
    missingFiles: [],
    sizeMismatches: [],
    invalidPaths: [],
    orphanFiles: [],
  };
  const expectedLocalPaths = new Set();

  for (const row of rows) {
    const provider = row.storage_provider || 'local';
    if (provider === 's3') {
      summary.s3Records += 1;
      continue;
    }
    summary.localRecords += 1;

    let absolutePath;
    try {
      absolutePath = resolveLocalAttachmentPath(row);
      expectedLocalPaths.add(path.normalize(absolutePath).toLowerCase());
    } catch (error) {
      summary.invalidPaths += 1;
      if (samples.invalidPaths.length < 10) {
        samples.invalidPaths.push({
          kind: row.source.kind,
          id: Number(row.id),
          fileName: row.original_name,
          reason: error.message,
        });
      }
      continue;
    }

    try {
      const stats = await fsp.stat(absolutePath);
      summary.checkedLocalFiles += 1;
      if (Number(row.file_size || 0) !== stats.size) {
        summary.sizeMismatches += 1;
        if (samples.sizeMismatches.length < 10) {
          samples.sizeMismatches.push({
            kind: row.source.kind,
            id: Number(row.id),
            fileName: row.original_name,
            databaseSize: Number(row.file_size || 0),
            actualSize: stats.size,
            path: safeRelative(absolutePath),
          });
        }
      }
    } catch (error) {
      summary.missingFiles += 1;
      if (samples.missingFiles.length < 10) {
        samples.missingFiles.push({
          kind: row.source.kind,
          id: Number(row.id),
          fileName: row.original_name,
          path: safeRelative(absolutePath),
          reason: error.code === 'ENOENT' ? '文件不存在' : error.message,
        });
      }
    }
  }

  if (config.storage.driver === 'local' && await pathExists(localRoot)) {
    const files = await collectFiles(localRoot);
    for (const filePath of files) {
      const normalized = path.normalize(filePath).toLowerCase();
      if (!expectedLocalPaths.has(normalized)) {
        summary.orphanFiles += 1;
        if (samples.orphanFiles.length < 20) {
          samples.orphanFiles.push({
            path: safeRelative(filePath, localRoot),
          });
        }
      }
    }
  }

  const status = summary.missingFiles || summary.sizeMismatches || summary.invalidPaths
    ? 'error'
    : summary.orphanFiles
      ? 'warning'
      : 'ok';

  return {
    status,
    summary,
    samples,
    checks: [
      makeCheck(
        '数据库附件记录',
        'ok',
        `共检查 ${summary.totalRecords} 条附件记录。`,
        {
          localRecords: summary.localRecords,
          s3Records: summary.s3Records,
        },
      ),
      makeCheck(
        '本地附件文件',
        summary.missingFiles || summary.sizeMismatches || summary.invalidPaths ? 'error' : 'ok',
        summary.missingFiles || summary.sizeMismatches || summary.invalidPaths
          ? '发现附件记录与本地文件不一致。'
          : '本地附件记录与文件一致。',
        {
          checkedLocalFiles: summary.checkedLocalFiles,
          missingFiles: summary.missingFiles,
          sizeMismatches: summary.sizeMismatches,
          invalidPaths: summary.invalidPaths,
        },
      ),
      makeCheck(
        '孤立附件文件',
        summary.orphanFiles ? 'warning' : 'ok',
        summary.orphanFiles
          ? `发现 ${summary.orphanFiles} 个没有数据库记录的本地文件。`
          : '未发现孤立附件文件。',
        { orphanFiles: summary.orphanFiles },
      ),
    ],
  };
}

export async function checkAnalyticsLayer(db) {
  try {
    const readiness = await getAnalyticsReadiness(db);
    const pilotRecommended = readiness.recommendation === 'pilot';
    return {
      status: pilotRecommended ? 'warning' : 'ok',
      ...readiness,
      checks: [makeCheck(
        'Doris 分析层',
        pilotRecommended ? 'warning' : 'ok',
        pilotRecommended
          ? `已命中 ${readiness.triggered.length} 个启用条件，建议评估独立 Doris 试点；当前仍使用 MySQL。`
          : `当前分析数据 ${readiness.metrics.analyticsRows} 行，继续使用 MySQL，无需部署 Doris。`,
        {
          provider: readiness.provider,
          dorisEnabled: readiness.dorisEnabled,
          recommendation: readiness.recommendation,
          metrics: readiness.metrics,
          thresholds: readiness.thresholds,
          triggers: readiness.triggers,
          tableRows: readiness.tableRows,
        },
      )],
    };
  } catch (error) {
    return {
      status: 'warning',
      provider: 'mysql',
      dorisEnabled: false,
      recommendation: 'keep_mysql',
      checks: [makeCheck('Doris 分析层', 'warning', '无法计算 Doris 启用条件，当前继续使用 MySQL。', {
        error: error.message,
      })],
    };
  }
}

export async function runSystemChecks(db) {
  const [runtimeConfig, database, attachments, analytics] = await Promise.all([
    checkRuntimeConfig(),
    checkDatabase(db),
    checkAttachmentStorage(db),
    checkAnalyticsLayer(db),
  ]);

  const status = worstStatus(runtimeConfig.status, database.status, attachments.status, analytics.status);
  return {
    status,
    generatedAt: new Date().toISOString(),
    projectRoot,
    runtimeConfig,
    database,
    attachments,
    analytics,
  };
}
