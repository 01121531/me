import crypto from 'crypto';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { closePool, ensureDatabase, getPool } from '../db.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const backupRoot = path.resolve(process.env.BACKUP_ROOT || path.join(projectRoot, 'backups'));

const tables = [
  'tasks',
  'work_logs',
  'log_attachments',
  'task_notes',
  'note_attachments',
  'task_attachments',
  'note_versions',
  'log_versions',
  'attachment_text_cache',
  'ai_conversations',
  'ai_messages',
  'ai_index_jobs',
  'ai_index_state',
  'mcp_action_requests',
  'audit_events',
];

const restoreOrder = [
  'audit_events',
  'mcp_action_requests',
  'ai_index_state',
  'ai_index_jobs',
  'ai_messages',
  'ai_conversations',
  'attachment_text_cache',
  'log_versions',
  'note_versions',
  'task_attachments',
  'note_attachments',
  'task_notes',
  'log_attachments',
  'work_logs',
  'tasks',
];

async function readyPool() {
  try {
    return getPool();
  } catch {
    await ensureDatabase();
    return getPool();
  }
}

function chinaTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}-${value.hour}${value.minute}${value.second}`;
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function relativeToBackup(filePath, backupDir) {
  return path.relative(backupDir, filePath).replace(/\\/g, '/');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
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

export async function latestBackupDir() {
  if (!(await pathExists(backupRoot))) return null;
  const entries = await fsp.readdir(backupRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    if (await pathExists(path.join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

export async function listBackups({ limit = 20 } = {}) {
  if (!(await pathExists(backupRoot))) return [];
  const entries = await fsp.readdir(backupRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .sort()
    .reverse()
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));

  const backups = [];
  for (const dir of dirs) {
    const manifestPath = path.join(dir, 'manifest.json');
    if (!(await pathExists(manifestPath))) continue;
    const manifest = await readJson(manifestPath);
    backups.push({
      backupDir: dir,
      name: path.basename(dir),
      createdAt: manifest.createdAt,
      createdAtChina: manifest.createdAtChina,
      database: manifest.database,
      storageDriver: manifest.storageDriver,
      tables: manifest.tables || [],
      uploads: manifest.uploads || { count: 0, totalBytes: 0 },
      files: Array.isArray(manifest.files) ? manifest.files.length : 0,
    });
  }
  return backups;
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(`${filePath}.tmp`, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function fileEntry(filePath, backupDir, type) {
  const stats = await fsp.stat(filePath);
  return {
    type,
    path: relativeToBackup(filePath, backupDir),
    size: stats.size,
    sha256: await hashFile(filePath),
  };
}

async function exportTable(db, table, backupDir) {
  const [rows] = await db.query(`SELECT * FROM ${table}`);
  const dataPath = path.join(backupDir, 'data', `${table}.json`);
  await writeJson(dataPath, rows);
  return {
    table,
    rows: rows.length,
    file: await fileEntry(dataPath, backupDir, 'data'),
  };
}

async function copyUploads(backupDir) {
  const uploadRoot = path.resolve(config.storage.localRoot);
  const target = path.join(backupDir, 'uploads');
  if (await pathExists(uploadRoot)) {
    await fsp.cp(uploadRoot, target, { recursive: true });
  } else {
    await fsp.mkdir(target, { recursive: true });
  }
  const files = await collectFiles(target);
  const entries = [];
  let totalBytes = 0;
  for (const filePath of files) {
    const entry = await fileEntry(filePath, backupDir, 'upload');
    totalBytes += entry.size;
    entries.push(entry);
  }
  return { files: entries, count: entries.length, totalBytes };
}

export async function createBackup() {
  const db = await readyPool();
  const backupDir = path.join(backupRoot, chinaTimestamp());
  await fsp.mkdir(path.join(backupDir, 'data'), { recursive: true });

  const exportedTables = [];
  for (const table of tables) {
    exportedTables.push(await exportTable(db, table, backupDir));
  }
  const uploads = await copyUploads(backupDir);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    createdAtChina: chinaTimestamp(),
    app: 'assistant-task-board',
    database: config.db.database,
    storageDriver: config.storage.driver,
    tables: exportedTables.map(({ table, rows, file }) => ({ table, rows, file: file.path })),
    uploads: {
      count: uploads.count,
      totalBytes: uploads.totalBytes,
    },
    files: [
      ...exportedTables.map(({ file }) => file),
      ...uploads.files,
    ],
  };
  await writeJson(path.join(backupDir, 'manifest.json'), manifest);

  return {
    status: 'ok',
    backupDir,
    tables: manifest.tables,
    uploads: manifest.uploads,
    files: manifest.files.length,
  };
}

async function resolveBackupArg(arg) {
  if (arg) return path.resolve(arg);
  const latest = await latestBackupDir();
  if (!latest) {
    throw new Error('没有找到可用备份目录。请先运行 npm run backup:create。');
  }
  return latest;
}

export async function verifyBackup(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const problems = [];

  for (const file of manifest.files || []) {
    const absolute = path.join(backupDir, file.path);
    try {
      const stats = await fsp.stat(absolute);
      if (stats.size !== Number(file.size)) {
        problems.push({ path: file.path, reason: '文件大小不一致', expected: file.size, actual: stats.size });
        continue;
      }
      const actualHash = await hashFile(absolute);
      if (actualHash !== file.sha256) {
        problems.push({ path: file.path, reason: 'SHA256 校验不一致' });
      }
    } catch (error) {
      problems.push({ path: file.path, reason: error.code === 'ENOENT' ? '文件不存在' : error.message });
    }
  }

  return {
    status: problems.length ? 'error' : 'ok',
    backupDir,
    createdAt: manifest.createdAt,
    tables: manifest.tables || [],
    uploads: manifest.uploads || { count: 0, totalBytes: 0 },
    checkedFiles: (manifest.files || []).length,
    problems,
  };
}

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

async function insertRows(connection, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  const placeholderSql = `(${columns.map(() => '?').join(', ')})`;
  const sql = `INSERT INTO ${table} (${columnSql}) VALUES ${placeholderSql}`;
  for (const row of rows) {
    await connection.query(sql, columns.map((column) => normalizeValue(row[column])));
  }
}

async function restoreUploads(backupDir) {
  const source = path.join(backupDir, 'uploads');
  const target = path.resolve(config.storage.localRoot);
  const safetyCopy = `${target}.before-restore-${chinaTimestamp()}`;
  if (await pathExists(target)) {
    await fsp.rename(target, safetyCopy);
  }
  await fsp.cp(source, target, { recursive: true });
  return { target, safetyCopy: await pathExists(safetyCopy) ? safetyCopy : null };
}

export async function restoreBackup(backupDir, { apply = false, yes = false } = {}) {
  const verification = await verifyBackup(backupDir);
  if (verification.status !== 'ok') {
    return {
      status: 'error',
      backupDir,
      message: '备份校验失败，已停止恢复。',
      verification,
    };
  }

  if (!apply || !yes) {
    return {
      status: 'dry-run',
      backupDir,
      message: '这是恢复预演。需要真正恢复时请追加 --apply --yes。',
      tables: verification.tables,
      uploads: verification.uploads,
    };
  }

  const db = await readyPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of restoreOrder) {
      await connection.query(`DELETE FROM ${table}`);
    }
    for (const table of tables) {
      const rows = await readJson(path.join(backupDir, 'data', `${table}.json`));
      await insertRows(connection, table, rows);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const uploads = await restoreUploads(backupDir);
  return {
    status: 'ok',
    backupDir,
    message: '备份已恢复。',
    uploads,
  };
}

function parseArgs() {
  const [, , command = 'create', backupPath, ...flags] = process.argv;
  return {
    command,
    backupPath,
    flags: new Set(flags),
  };
}

async function main() {
  const { command, backupPath, flags } = parseArgs();
  let result;
  if (command === 'create') {
    result = await createBackup();
  } else if (command === 'verify') {
    result = await verifyBackup(await resolveBackupArg(backupPath));
  } else if (command === 'restore') {
    result = await restoreBackup(await resolveBackupArg(backupPath), {
      apply: flags.has('--apply'),
      yes: flags.has('--yes'),
    });
  } else {
    throw new Error(`未知备份命令：${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'error' ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({
        status: 'error',
        message: error.message,
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
