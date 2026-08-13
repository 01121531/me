import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { createPasswordHash, updatePasswordHash, verifyPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

const updateLogLimit = 240;
let updateState = {
  status: 'idle',
  running: false,
  startedAt: null,
  finishedAt: null,
  branch: 'main',
  exitCode: null,
  error: '',
  logs: [],
};

function nowIso() {
  return new Date().toISOString();
}

function appendUpdateLog(line) {
  const text = String(line || '').replace(/\r/g, '').trimEnd();
  if (!text) return;
  text.split('\n').forEach((item) => {
    updateState.logs.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${item}`);
  });
  if (updateState.logs.length > updateLogLimit) {
    updateState.logs = updateState.logs.slice(updateState.logs.length - updateLogLimit);
  }
}

function httpUrl(value, fieldName, { optional = true } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    if (optional) return '';
    const error = new Error(`${fieldName} 不能为空。`);
    error.statusCode = 400;
    throw error;
  }
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('invalid protocol');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    const error = new Error(`${fieldName} 必须是 http 或 https 开头的网址。`);
    error.statusCode = 400;
    throw error;
  }
}

function limitedText(value, max, fieldName, { optional = true } = {}) {
  const text = String(value || '').trim();
  if (!text && !optional) {
    const error = new Error(`${fieldName} 不能为空。`);
    error.statusCode = 400;
    throw error;
  }
  return text.slice(0, max);
}

function positiveInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return { configured: false, preview: '' };
  if (text.length <= 8) return { configured: true, preview: '已配置' };
  return {
    configured: true,
    preview: `${text.slice(0, 3)}...${text.slice(-4)}`,
  };
}

async function readEnvText() {
  try {
    return await fsp.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function parseEnvLines(text) {
  return String(text || '').split(/\r?\n/);
}

function envLineKey(line) {
  const match = String(line || '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] || null;
}

function formatEnvValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (/[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

async function writeEnvValues(updates) {
  const entries = Object.entries(updates)
    .filter(([key, value]) => key && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);
  if (!entries.length) return;

  const lines = parseEnvLines(await readEnvText());
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const key = envLineKey(line);
    const found = entries.find(([entryKey]) => entryKey === key);
    if (!found) return line;
    seen.add(key);
    return `${found[0]}=${formatEnvValue(found[1])}`;
  });

  const missing = entries.filter(([key]) => !seen.has(key));
  if (missing.length && nextLines.length && nextLines[nextLines.length - 1].trim()) {
    nextLines.push('');
  }
  missing.forEach(([key, value]) => {
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  });

  await fsp.writeFile(envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  entries.forEach(([key, value]) => {
    process.env[key] = value;
  });
  refreshRuntimeConfig();
}

export function refreshRuntimeConfig() {
  config.ai.indexingEnabled = process.env.AI_INDEXING_ENABLED === 'true';
  config.ai.indexVersion = process.env.AI_INDEX_VERSION || config.ai.indexVersion || '2';
  config.ai.ocr.baseUrl = process.env.OCR_BASE_URL || process.env.LITELLM_BASE_URL || '';
  config.ai.ocr.apiKey = process.env.OCR_API_KEY || process.env.LITELLM_API_KEY || '';
  config.ai.ocr.model = process.env.OCR_MODEL || process.env.LITELLM_CHAT_MODEL || '';
  config.ai.ocr.maxPdfPages = positiveInteger(process.env.OCR_MAX_PDF_PAGES, 20, 1, 100);
  config.ai.ocr.batchPages = positiveInteger(process.env.OCR_BATCH_PAGES, 4, 1, 20);
  config.ai.ocr.renderScale = Math.max(0.5, Math.min(3, Number(process.env.OCR_PDF_RENDER_SCALE || 1.2)));
  config.ai.ocr.minTextChars = positiveInteger(process.env.OCR_MIN_TEXT_CHARS, 80, 1, 2000);
  config.ai.litellm.baseUrl = process.env.LITELLM_BASE_URL || '';
  config.ai.litellm.apiKey = process.env.LITELLM_API_KEY || '';
  config.ai.litellm.embeddingModel = process.env.LITELLM_EMBEDDING_MODEL || '';
  config.ai.litellm.chatModel = process.env.LITELLM_CHAT_MODEL || '';
  config.ai.qdrant.url = process.env.QDRANT_URL || '';
  config.ai.qdrant.apiKey = process.env.QDRANT_API_KEY || '';
  config.ai.qdrant.collection = process.env.QDRANT_COLLECTION || 'assistant_task_board';
  config.mcp.enabled = process.env.MCP_ENABLED === 'true';
  config.mcp.token = process.env.MCP_TOKEN || '';
}

export function getSettingsSnapshot() {
  return {
    ai: {
      indexingEnabled: Boolean(config.ai.indexingEnabled),
      litellm: {
        baseUrl: config.ai.litellm.baseUrl,
        apiKey: maskSecret(config.ai.litellm.apiKey),
        chatModel: config.ai.litellm.chatModel,
        embeddingModel: config.ai.litellm.embeddingModel,
      },
      ocr: {
        baseUrl: process.env.OCR_BASE_URL || '',
        apiKey: maskSecret(process.env.OCR_API_KEY || ''),
        model: process.env.OCR_MODEL || '',
        effectiveBaseUrl: config.ai.ocr.baseUrl,
        effectiveModel: config.ai.ocr.model,
        maxPdfPages: config.ai.ocr.maxPdfPages,
        minTextChars: config.ai.ocr.minTextChars,
      },
      qdrant: {
        url: config.ai.qdrant.url,
        apiKey: maskSecret(config.ai.qdrant.apiKey),
        collection: config.ai.qdrant.collection,
      },
    },
    auth: {
      mode: config.auth.mode,
      passwordEnabled: config.auth.mode === 'password',
    },
    update: getOnlineUpdateStatus(),
  };
}

export async function saveAiSettings(payload = {}) {
  const updates = {
    AI_INDEXING_ENABLED: payload.indexingEnabled ? 'true' : 'false',
    LITELLM_BASE_URL: httpUrl(payload.litellmBaseUrl, 'LiteLLM Base URL'),
    LITELLM_CHAT_MODEL: limitedText(payload.litellmChatModel, 120, '聊天模型'),
    LITELLM_EMBEDDING_MODEL: limitedText(payload.litellmEmbeddingModel, 120, 'Embedding 模型'),
    QDRANT_URL: httpUrl(payload.qdrantUrl, 'Qdrant URL'),
    QDRANT_COLLECTION: limitedText(payload.qdrantCollection || 'assistant_task_board', 120, 'Qdrant 集合名'),
    OCR_BASE_URL: payload.ocrBaseUrl ? httpUrl(payload.ocrBaseUrl, 'OCR Base URL') : '',
    OCR_MODEL: limitedText(payload.ocrModel, 120, 'OCR 模型'),
    OCR_MAX_PDF_PAGES: String(positiveInteger(payload.ocrMaxPdfPages, 20, 1, 100)),
    OCR_MIN_TEXT_CHARS: String(positiveInteger(payload.ocrMinTextChars, 80, 1, 2000)),
  };

  const litellmApiKey = String(payload.litellmApiKey || '').trim();
  const ocrApiKey = String(payload.ocrApiKey || '').trim();
  const qdrantApiKey = String(payload.qdrantApiKey || '').trim();
  if (litellmApiKey) updates.LITELLM_API_KEY = litellmApiKey;
  if (ocrApiKey) updates.OCR_API_KEY = ocrApiKey;
  if (qdrantApiKey) updates.QDRANT_API_KEY = qdrantApiKey;

  await writeEnvValues(updates);
  return getSettingsSnapshot().ai;
}

export async function testAiConnection(payload = {}) {
  const baseUrl = httpUrl(payload.baseUrl || config.ai.litellm.baseUrl, 'LiteLLM Base URL', { optional: false });
  const apiKey = limitedText(payload.apiKey || config.ai.litellm.apiKey, 400, 'API Key', { optional: false });
  const model = limitedText(payload.model || config.ai.litellm.chatModel, 120, '聊天模型', { optional: false });
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 32,
      messages: [
        { role: 'system', content: '只返回“ok”。' },
        { role: 'user', content: '连接测试' },
      ],
    }),
  });
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text.slice(0, 500) || `AI 网关返回 ${response.status}`);
    error.statusCode = 502;
    throw error;
  }
  return { ok: true, elapsedMs };
}

export async function changeAccessPassword({ currentPassword = '', newPassword = '' } = {}) {
  if (config.auth.mode !== 'password') {
    const error = new Error('当前未启用密码登录，不能在页面内修改访问密码。');
    error.statusCode = 400;
    throw error;
  }
  if (!verifyPassword(currentPassword)) {
    const error = new Error('当前密码不正确。');
    error.statusCode = 401;
    throw error;
  }
  const nextPassword = String(newPassword || '');
  if (nextPassword.length < 8 || nextPassword.length > 128) {
    const error = new Error('新密码长度需要在 8 到 128 个字符之间。');
    error.statusCode = 400;
    throw error;
  }
  const nextHash = createPasswordHash(nextPassword);
  await writeEnvValues({ AUTH_PASSWORD_HASH: nextHash, AUTH_MODE: 'password' });
  updatePasswordHash(nextHash);
  return { ok: true };
}

function commandName(name) {
  if (process.platform === 'win32') {
    if (name === 'npm') return 'npm.cmd';
    if (name === 'pm2') return 'pm2.cmd';
  }
  return name;
}

function runCommand(name, args, options = {}) {
  appendUpdateLog(`$ ${[name, ...args].join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(commandName(name), args, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
      ...options,
    });
    child.stdout?.on('data', (chunk) => appendUpdateLog(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk) => appendUpdateLog(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${name} 退出码 ${code}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

function normalizeBranch(value) {
  const branch = String(value || process.env.UPDATE_BRANCH || 'main').trim();
  if (!/^[A-Za-z0-9._/-]{1,80}$/.test(branch) || branch.startsWith('-')) {
    const error = new Error('分支名称不合法。');
    error.statusCode = 400;
    throw error;
  }
  return branch;
}

async function runUpdate(branch) {
  try {
    appendUpdateLog(`开始从 GitHub 更新，分支：${branch}`);
    await runCommand('git', ['fetch', 'origin', branch]);
    await runCommand('git', ['checkout', branch]);
    await runCommand('git', ['pull', '--ff-only', 'origin', branch]);
    await runCommand('npm', ['ci']);
    await runCommand('npm', ['run', 'build']);

    updateState.status = 'completed';
    updateState.exitCode = 0;
    appendUpdateLog('代码更新和构建已完成。');

    if (process.env.pm_id !== undefined || process.env.PM2_APP) {
      const pm2App = String(process.env.PM2_APP || 'assistant-task-board').trim();
      appendUpdateLog(`准备通过 PM2 重启：${pm2App}`);
      const child = spawn(commandName('pm2'), ['restart', pm2App, '--update-env'], {
        cwd: projectRoot,
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } else {
      appendUpdateLog('未检测到 PM2 环境，已跳过自动重启。');
    }
  } catch (error) {
    updateState.status = 'failed';
    updateState.exitCode = error.exitCode ?? 1;
    updateState.error = error.message;
    appendUpdateLog(`更新失败：${error.message}`);
  } finally {
    updateState.running = false;
    updateState.finishedAt = nowIso();
  }
}

export function getOnlineUpdateStatus() {
  return {
    status: updateState.status,
    running: updateState.running,
    startedAt: updateState.startedAt,
    finishedAt: updateState.finishedAt,
    branch: updateState.branch,
    exitCode: updateState.exitCode,
    error: updateState.error,
    logs: [...updateState.logs],
  };
}

export function startOnlineUpdate(payload = {}) {
  if (updateState.running) {
    const error = new Error('已有更新任务正在执行。');
    error.statusCode = 409;
    throw error;
  }
  const branch = normalizeBranch(payload.branch);
  updateState = {
    status: 'running',
    running: true,
    startedAt: nowIso(),
    finishedAt: null,
    branch,
    exitCode: null,
    error: '',
    logs: [],
  };
  runUpdate(branch);
  return getOnlineUpdateStatus();
}
