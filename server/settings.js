import { spawn } from 'child_process';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { createPasswordHash, updatePasswordHash, verifyPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const deployDir = path.join(projectRoot, '.deploy');
const updateStatePath = path.join(deployDir, 'update-state.json');

const updateLogLimit = 240;
const updateSteps = [
  { phase: 'checking', label: '检查版本', progress: 8 },
  { phase: 'fetching', label: '拉取代码', progress: 22 },
  { phase: 'checkout', label: '切换分支', progress: 36 },
  { phase: 'pulling', label: '快进更新', progress: 50 },
  { phase: 'installing', label: '安装依赖', progress: 68 },
  { phase: 'building', label: '构建前端', progress: 84 },
  { phase: 'restarting', label: '重启服务', progress: 94 },
  { phase: 'completed', label: '完成', progress: 100 },
];
const updateStepMap = new Map(updateSteps.map((step) => [step.phase, step]));
const updateClients = new Set();

const defaultUpdateState = {
  status: 'idle',
  running: false,
  startedAt: null,
  finishedAt: null,
  branch: 'main',
  phase: 'idle',
  currentStep: '待命',
  progress: 0,
  exitCode: null,
  error: '',
  logs: [],
  check: null,
};

let updateState = loadPersistedUpdateState();

function nowIso() {
  return new Date().toISOString();
}

function loadPersistedUpdateState() {
  try {
    if (!fs.existsSync(updateStatePath)) return { ...defaultUpdateState };
    const parsed = JSON.parse(fs.readFileSync(updateStatePath, 'utf8'));
    const state = normalizeUpdateState({ ...defaultUpdateState, ...parsed });
    if (state.running) {
      return {
        ...state,
        status: 'failed',
        running: false,
        phase: 'failed',
        currentStep: '服务重启，无法确认上一次更新是否完成',
        progress: Math.max(0, Math.min(99, Number(state.progress) || 0)),
        finishedAt: state.finishedAt || nowIso(),
        error: state.error || '服务在更新过程中重启，请检查当前代码版本和 PM2 日志。',
      };
    }
    return state;
  } catch {
    return { ...defaultUpdateState };
  }
}

function normalizeUpdateState(state) {
  return {
    ...defaultUpdateState,
    ...state,
    running: Boolean(state.running),
    progress: Math.max(0, Math.min(100, Number(state.progress) || 0)),
    logs: Array.isArray(state.logs) ? state.logs.slice(-updateLogLimit) : [],
    check: state.check && typeof state.check === 'object' ? state.check : null,
  };
}

function persistUpdateState() {
  fsp.mkdir(deployDir, { recursive: true })
    .then(() => fsp.writeFile(updateStatePath, JSON.stringify(getOnlineUpdateStatus(), null, 2), 'utf8'))
    .catch((error) => {
      console.warn('Failed to persist update state:', error.message);
    });
}

function safeWriteUpdateClient(client, chunk) {
  if (client.res.destroyed || client.res.writableEnded) {
    clearInterval(client.heartbeat);
    updateClients.delete(client);
    return;
  }
  try {
    client.res.write(chunk);
  } catch {
    clearInterval(client.heartbeat);
    updateClients.delete(client);
  }
}

function publishUpdateEvent(event, payload) {
  const data = JSON.stringify({
    ...payload,
    at: nowIso(),
  });
  for (const client of updateClients) {
    safeWriteUpdateClient(client, `event: ${event}\ndata: ${data}\n\n`);
  }
}

function updateStatePatch(patch, { event = 'update.state' } = {}) {
  updateState = normalizeUpdateState({ ...updateState, ...patch });
  persistUpdateState();
  publishUpdateEvent(event, { state: getOnlineUpdateStatus() });
}

function appendUpdateLog(line) {
  const text = String(line || '').replace(/\r/g, '').trimEnd();
  if (!text) return;
  const lines = [];
  text.split('\n').forEach((item) => {
    const nextLine = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${item}`;
    lines.push(nextLine);
    updateState.logs.push(nextLine);
  });
  if (updateState.logs.length > updateLogLimit) {
    updateState.logs = updateState.logs.slice(updateState.logs.length - updateLogLimit);
  }
  persistUpdateState();
  publishUpdateEvent('update.log', { lines, state: getOnlineUpdateStatus() });
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
  config.ai.resourceDescription.enabled = process.env.RESOURCE_AI_DESCRIPTION_ENABLED !== 'false';
  config.ai.resourceDescription.maxInputChars = positiveInteger(
    process.env.RESOURCE_AI_DESCRIPTION_MAX_INPUT_CHARS,
    16000,
    1000,
    60000,
  );
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
      resourceDescription: {
        enabled: Boolean(config.ai.resourceDescription.enabled),
        maxInputChars: config.ai.resourceDescription.maxInputChars,
      },
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
    RESOURCE_AI_DESCRIPTION_ENABLED: payload.resourceDescriptionEnabled === false ? 'false' : 'true',
    RESOURCE_AI_DESCRIPTION_MAX_INPUT_CHARS: String(positiveInteger(payload.resourceDescriptionMaxInputChars, 16000, 1000, 60000)),
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

function runCaptureCommand(name, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { allowFailure = false, ...spawnOptions } = options;
    const child = spawn(commandName(name), args, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      shell: false,
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }
      const error = new Error((stderr || stdout || `${name} 退出码 ${code}`).trim());
      error.exitCode = code;
      reject(error);
    });
  });
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

function shortCommit(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 8) : '';
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

function normalizeCheckResult(check) {
  if (!check || typeof check !== 'object') return null;
  return {
    status: check.status || 'unknown',
    branch: check.branch || 'main',
    checkedAt: check.checkedAt || null,
    currentBranch: check.currentBranch || '',
    localCommit: check.localCommit || '',
    localShort: check.localShort || shortCommit(check.localCommit),
    remoteCommit: check.remoteCommit || '',
    remoteShort: check.remoteShort || shortCommit(check.remoteCommit),
    hasUpdate: typeof check.hasUpdate === 'boolean' ? check.hasUpdate : null,
    dirty: typeof check.dirty === 'boolean' ? check.dirty : null,
    error: check.error || '',
  };
}

export function buildOnlineUpdateCheckResult({
  branch,
  checkedAt = nowIso(),
  currentBranch = '',
  localCommit = '',
  remoteCommit = '',
  dirty = false,
  status = 'ok',
  error = '',
} = {}) {
  return normalizeCheckResult({
    status,
    branch: branch || 'main',
    checkedAt,
    currentBranch,
    localCommit,
    localShort: shortCommit(localCommit),
    remoteCommit,
    remoteShort: shortCommit(remoteCommit),
    hasUpdate: status === 'ok' ? Boolean(localCommit && remoteCommit && localCommit !== remoteCommit) : null,
    dirty: status === 'ok' ? Boolean(dirty) : null,
    error,
  });
}

function setUpdatePhase(phase) {
  const step = updateStepMap.get(phase);
  if (!step) return;
  updateStatePatch({
    phase: step.phase,
    currentStep: step.label,
    progress: step.progress,
  });
  appendUpdateLog(step.label);
}

async function runUpdateStep(phase, command, args) {
  setUpdatePhase(phase);
  await runCommand(command, args);
}

export async function checkOnlineUpdate(payload = {}) {
  const branch = normalizeBranch(payload.branch);
  const checkedAt = nowIso();
  try {
    const [branchResult, headResult, dirtyResult, remoteResult] = await Promise.all([
      runCaptureCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
      runCaptureCommand('git', ['rev-parse', 'HEAD']),
      runCaptureCommand('git', ['status', '--porcelain'], { allowFailure: true }),
      runCaptureCommand('git', ['ls-remote', 'origin', `refs/heads/${branch}`]),
    ]);
    const localCommit = headResult.stdout.trim();
    const remoteCommit = remoteResult.stdout.trim().split(/\s+/)[0] || '';
    if (!remoteCommit) {
      const error = new Error(`远端分支 origin/${branch} 不存在。`);
      error.statusCode = 404;
      throw error;
    }
    const check = buildOnlineUpdateCheckResult({
      branch,
      checkedAt,
      currentBranch: branchResult.stdout.trim(),
      localCommit,
      remoteCommit,
      dirty: Boolean(dirtyResult.stdout.trim()),
    });
    updateStatePatch({ branch, check, error: updateState.status === 'failed' ? updateState.error : '' });
    return { check, update: getOnlineUpdateStatus() };
  } catch (error) {
    const check = buildOnlineUpdateCheckResult({
      status: 'failed',
      branch,
      checkedAt,
      error: error.message || '检查更新失败。',
    });
    updateStatePatch({ branch, check });
    return { check, update: getOnlineUpdateStatus() };
  }
}

async function runUpdate(branch, check) {
  try {
    updateStatePatch({
      status: 'running',
      running: true,
      phase: 'checking',
      currentStep: '检查版本',
      progress: 8,
      check,
    });
    appendUpdateLog(`开始从 GitHub 更新，分支：${branch}`);
    await runUpdateStep('fetching', 'git', ['fetch', 'origin', branch]);
    await runUpdateStep('checkout', 'git', ['checkout', branch]);
    await runUpdateStep('pulling', 'git', ['pull', '--ff-only', 'origin', branch]);
    await runUpdateStep('installing', 'npm', ['ci']);
    await runUpdateStep('building', 'npm', ['run', 'build']);

    appendUpdateLog('代码更新和构建已完成。');

    if (process.env.pm_id !== undefined || process.env.PM2_APP) {
      setUpdatePhase('restarting');
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
    updateStatePatch({
      status: 'completed',
      phase: 'completed',
      currentStep: '完成',
      progress: 100,
      exitCode: 0,
      error: '',
    });
  } catch (error) {
    updateStatePatch({
      status: 'failed',
      phase: updateState.phase || 'failed',
      currentStep: `${updateState.currentStep || '更新'}失败`,
      progress: Math.max(0, Math.min(99, Number(updateState.progress) || 0)),
      exitCode: error.exitCode ?? 1,
      error: error.message,
    }, { event: 'update.error' });
    appendUpdateLog(`更新失败：${error.message}`);
  } finally {
    updateStatePatch({
      running: false,
      finishedAt: nowIso(),
    });
    if (updateState.status === 'completed') {
      publishUpdateEvent('update.done', { state: getOnlineUpdateStatus() });
    }
  }
}

export function getOnlineUpdateStatus() {
  return {
    status: updateState.status,
    running: updateState.running,
    startedAt: updateState.startedAt,
    finishedAt: updateState.finishedAt,
    branch: updateState.branch,
    phase: updateState.phase,
    currentStep: updateState.currentStep,
    progress: updateState.progress,
    exitCode: updateState.exitCode,
    error: updateState.error,
    logs: [...updateState.logs],
    check: normalizeCheckResult(updateState.check),
    steps: updateSteps.map((step) => ({ ...step })),
  };
}

export async function startOnlineUpdate(payload = {}) {
  if (updateState.running) {
    const error = new Error('已有更新任务正在执行。');
    error.statusCode = 409;
    throw error;
  }
  const branch = normalizeBranch(payload.branch);
  const check = (
    updateState.check?.branch === branch && updateState.check?.status === 'ok'
      ? normalizeCheckResult(updateState.check)
      : (await checkOnlineUpdate({ branch })).check
  );
  if (check.status !== 'ok') {
    const error = new Error(check.error || '检查更新失败，暂不能启动在线更新。');
    error.statusCode = 502;
    throw error;
  }
  if (!check.hasUpdate) {
    updateStatePatch({
      status: 'idle',
      running: false,
      branch,
      phase: 'idle',
      currentStep: '已是最新',
      progress: 0,
      error: '',
      check,
    });
    const error = new Error('当前已经是最新版本，无需更新。');
    error.statusCode = 409;
    throw error;
  }
  updateState = {
    status: 'running',
    running: true,
    startedAt: nowIso(),
    finishedAt: null,
    branch,
    phase: 'checking',
    currentStep: '检查版本',
    progress: 8,
    exitCode: null,
    error: '',
    logs: [],
    check,
  };
  persistUpdateState();
  publishUpdateEvent('update.state', { state: getOnlineUpdateStatus() });
  runUpdate(branch, check);
  return getOnlineUpdateStatus();
}

export function openOnlineUpdateEventStream(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: update.state\ndata: ${JSON.stringify({ state: getOnlineUpdateStatus(), at: nowIso() })}\n\n`);

  const client = { res, heartbeat: null };
  client.heartbeat = setInterval(() => {
    safeWriteUpdateClient(client, ': keepalive\n\n');
  }, 25000);
  updateClients.add(client);
  req.on('close', () => {
    clearInterval(client.heartbeat);
    updateClients.delete(client);
  });
}
