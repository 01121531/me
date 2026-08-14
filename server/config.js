import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataRoot = path.resolve(process.env.DATA_ROOT || projectRoot);
const storageDriver = process.env.STORAGE_DRIVER || 'local';
const authMode = process.env.AUTH_MODE || 'disabled';
const mcpEnabled = process.env.MCP_ENABLED === 'true';

function positiveNumber(value, fallback, minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

if (!['local', 's3'].includes(storageDriver)) {
  throw new Error('STORAGE_DRIVER must be either "local" or "s3".');
}
if (!['disabled', 'password', 'oidc'].includes(authMode)) {
  throw new Error('AUTH_MODE must be "disabled", "password", or "oidc".');
}
if (mcpEnabled && !process.env.MCP_TOKEN) {
  throw new Error('MCP_TOKEN is required when MCP_ENABLED=true.');
}

export const config = {
  projectRoot,
  dataRoot,
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'assistant_task_board',
    timezone: '+08:00',
  },
  storage: {
    driver: storageDriver,
    localRoot: path.resolve(process.env.STORAGE_LOCAL_ROOT || (process.env.DATA_ROOT ? path.join(dataRoot, 'resources') : path.join(projectRoot, 'uploads'))),
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || 'assistant-task-board',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    },
  },
  auth: {
    mode: authMode,
    sessionSecret: process.env.SESSION_SECRET || '',
    passwordHash: process.env.AUTH_PASSWORD_HASH || '',
    secureCookies: process.env.AUTH_SECURE_COOKIES === 'true',
    oidc: {
      issuer: process.env.OIDC_ISSUER || '',
      clientId: process.env.OIDC_CLIENT_ID || '',
      clientSecret: process.env.OIDC_CLIENT_SECRET || '',
      redirectUri: process.env.OIDC_REDIRECT_URI || '',
      scope: process.env.OIDC_SCOPE || 'openid profile email',
      allowedSubjects: (process.env.OIDC_ALLOWED_SUBJECTS || '')
        .split(',')
        .map((subject) => subject.trim())
        .filter(Boolean),
    },
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  ai: {
    indexingEnabled: process.env.AI_INDEXING_ENABLED === 'true',
    indexVersion: process.env.AI_INDEX_VERSION || '2',
    worker: {
      pollMs: positiveNumber(process.env.AI_WORKER_POLL_MS, 1500, 250),
      maxAttempts: positiveNumber(process.env.AI_WORKER_MAX_ATTEMPTS, 5, 1),
    },
    attachmentParsing: {
      maxBytes: positiveNumber(process.env.AI_ATTACHMENT_PARSE_MAX_BYTES, 12 * 1024 * 1024, 1024),
      maxChars: positiveNumber(process.env.AI_ATTACHMENT_TEXT_MAX_CHARS, 80000, 1000),
    },
    resourceDescription: {
      enabled: process.env.RESOURCE_AI_DESCRIPTION_ENABLED !== 'false',
      maxInputChars: positiveNumber(process.env.RESOURCE_AI_DESCRIPTION_MAX_INPUT_CHARS, 16000, 1000),
    },
    ocr: {
      baseUrl: process.env.OCR_BASE_URL || process.env.LITELLM_BASE_URL || '',
      apiKey: process.env.OCR_API_KEY || process.env.LITELLM_API_KEY || '',
      model: process.env.OCR_MODEL || process.env.LITELLM_CHAT_MODEL || '',
      maxPdfPages: positiveNumber(process.env.OCR_MAX_PDF_PAGES, 20, 1),
      batchPages: positiveNumber(process.env.OCR_BATCH_PAGES, 4, 1),
      renderScale: positiveNumber(process.env.OCR_PDF_RENDER_SCALE, 1.2, 0.5),
      minTextChars: positiveNumber(process.env.OCR_MIN_TEXT_CHARS, 80, 1),
    },
    litellm: {
      baseUrl: process.env.LITELLM_BASE_URL || '',
      apiKey: process.env.LITELLM_API_KEY || '',
      embeddingModel: process.env.LITELLM_EMBEDDING_MODEL || '',
      chatModel: process.env.LITELLM_CHAT_MODEL || '',
    },
    qdrant: {
      url: process.env.QDRANT_URL || '',
      apiKey: process.env.QDRANT_API_KEY || '',
      collection: process.env.QDRANT_COLLECTION || 'assistant_task_board',
    },
  },
  mcp: {
    enabled: mcpEnabled,
    token: process.env.MCP_TOKEN || '',
  },
  weixin: {
    apiBaseUrl: process.env.WEIXIN_API_BASE_URL || 'https://ilinkai.weixin.qq.com',
    cdnBaseUrl: process.env.WEIXIN_CDN_BASE_URL || 'https://novac2c.cdn.weixin.qq.com/c2c',
    tempTtlHours: positiveNumber(process.env.WEIXIN_TEMP_TTL_HOURS, 24, 1),
    maxMediaBytes: positiveNumber(process.env.WEIXIN_MAX_MEDIA_BYTES, 50 * 1024 * 1024, 1024),
  },
};
