import * as oidc from 'openid-client';
import crypto from 'crypto';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { config } from './config.js';
import { getPool } from './db.js';

const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const passwordHashIterations = 210000;
let oidcConfiguration = null;
let authReady = false;

let requestSession = (req, _res, next) => {
  req.auth = { type: 'local', id: null };
  next();
};

function isOidcEnabled() {
  return config.auth.mode === 'oidc';
}

function isPasswordEnabled() {
  return config.auth.mode === 'password';
}

function isSessionAuthEnabled() {
  return isOidcEnabled() || isPasswordEnabled();
}

function hashPassword(password, salt, iterations = passwordHashIterations) {
  return crypto.pbkdf2Sync(
    String(password || ''),
    salt,
    Number(iterations),
    32,
    'sha256',
  );
}

function parsePasswordHash(value) {
  const [scheme, iterations, salt, hash] = String(value || '').split('$');
  if (scheme !== 'pbkdf2-sha256' || !iterations || !salt || !hash) {
    return null;
  }
  return {
    iterations: Number(iterations),
    salt,
    hash,
  };
}

export function verifyPassword(password) {
  const parsed = parsePasswordHash(config.auth.passwordHash);
  if (!parsed || !Number.isFinite(parsed.iterations) || parsed.iterations < 100000) {
    return false;
  }
  const expected = Buffer.from(parsed.hash, 'hex');
  const actual = hashPassword(password, parsed.salt, parsed.iterations);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt, passwordHashIterations).toString('hex');
  return `pbkdf2-sha256$${passwordHashIterations}$${salt}$${hash}`;
}

export function updatePasswordHash(nextHash) {
  config.auth.passwordHash = String(nextHash || '');
  process.env.AUTH_PASSWORD_HASH = config.auth.passwordHash;
}

function sessionCallback(req, res) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(res);
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function makeCallbackUrl(query) {
  const callbackUrl = new URL(config.auth.oidc.redirectUri);
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
  }
  return callbackUrl;
}

function toSafeUser(claims) {
  const subject = String(claims?.sub || '');
  if (!subject) throw new Error('OIDC response did not include a subject.');
  if (
    config.auth.oidc.allowedSubjects.length
    && !config.auth.oidc.allowedSubjects.includes(subject)
  ) {
    const error = new Error('This account is not allowed to use the task board.');
    error.statusCode = 403;
    throw error;
  }
  return {
    id: subject,
    name: String(claims.name || claims.preferred_username || claims.email || subject),
    email: claims.email ? String(claims.email) : null,
  };
}

export function installAuthMiddleware(app) {
  app.use((req, res, next) => requestSession(req, res, next));
}

export function installAuthRoutes(app, asyncRoute) {
  app.get('/api/auth/me', (req, res) => {
    const user = req.session?.user || null;
    res.json({
      mode: config.auth.mode,
      authenticated: !isSessionAuthEnabled() || Boolean(user),
      user,
    });
  });

  app.post('/api/auth/password-login', asyncRoute(async (req, res) => {
    if (!isPasswordEnabled()) {
      res.status(404).json({ message: '密码登录未启用。' });
      return;
    }
    if (!authReady) {
      res.status(503).json({ message: '认证服务正在启动，请稍后重试。' });
      return;
    }
    if (!verifyPassword(req.body?.password)) {
      res.status(401).json({ message: '密码不正确，请重新输入。' });
      return;
    }
    await regenerateSession(req);
    req.session.user = {
      id: 'password-user',
      name: '已验证用户',
      email: null,
    };
    await sessionCallback(req, res);
    res.json({
      mode: config.auth.mode,
      authenticated: true,
      user: req.session.user,
    });
  }));

  app.get('/auth/login', asyncRoute(async (req, res) => {
    if (!isOidcEnabled()) {
      res.redirect('/');
      return;
    }
    if (!authReady || !oidcConfiguration) {
      res.status(503).send('Authentication is still starting. Please retry shortly.');
      return;
    }

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    req.session.oidc = { codeVerifier, state, nonce };
    await sessionCallback(req, res);

    const authorizationUrl = oidc.buildAuthorizationUrl(oidcConfiguration, {
      redirect_uri: config.auth.oidc.redirectUri,
      scope: config.auth.oidc.scope,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(authorizationUrl.href);
  }));

  app.get('/auth/callback', asyncRoute(async (req, res) => {
    if (!isOidcEnabled() || !oidcConfiguration) {
      res.status(400).send('OIDC login is not enabled.');
      return;
    }
    const pending = req.session?.oidc;
    if (!pending?.codeVerifier || !pending.state || !pending.nonce) {
      res.status(400).send('The login request has expired. Please start again.');
      return;
    }

    const tokens = await oidc.authorizationCodeGrant(
      oidcConfiguration,
      makeCallbackUrl(req.query),
      {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
      },
    );
    const user = toSafeUser(tokens.claims());
    await regenerateSession(req);
    req.session.user = user;
    await sessionCallback(req, res);
    res.redirect('/');
  }));

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await destroySession(req);
    res.status(204).end();
  }));
}

export function requireApiAuth(req, res, next) {
  if (!isSessionAuthEnabled() || req.path === '/health' || req.path === '/auth/me') {
    next();
    return;
  }

  if (!req.session?.user) {
    res.status(401).json({ message: '请先登录后再访问任务台。' });
    return;
  }
  req.auth = { type: 'oidc', ...req.session.user };
  next();
}

export async function initializeAuth() {
  if (!isSessionAuthEnabled()) {
    authReady = true;
    return;
  }
  if (!config.auth.sessionSecret || config.auth.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters when authentication is enabled.');
  }
  if (isPasswordEnabled() && !parsePasswordHash(config.auth.passwordHash)) {
    throw new Error('AUTH_PASSWORD_HASH must be set to a pbkdf2-sha256 hash when AUTH_MODE=password.');
  }

  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore({
    createDatabaseTable: true,
    clearExpired: true,
    expiration: sessionLifetimeMs,
    schema: { tableName: 'user_sessions' },
  }, getPool());
  await sessionStore.onReady();

  const baseSession = session({
    name: 'assistant_task_board.sid',
    secret: config.auth.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.auth.secureCookies,
      maxAge: sessionLifetimeMs,
    },
  });
  requestSession = (req, res, next) => {
    baseSession(req, res, (error) => {
      if (!error && req.session?.user) {
        req.auth = { type: config.auth.mode, ...req.session.user };
      }
      next(error);
    });
  };

  if (!isOidcEnabled()) {
    authReady = true;
    return;
  }

  const { issuer, clientId, clientSecret, redirectUri } = config.auth.oidc;
  if (!issuer || !clientId || !clientSecret || !redirectUri) {
    throw new Error('OIDC requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, and SESSION_SECRET.');
  }

  oidcConfiguration = await oidc.discovery(
    new URL(issuer),
    clientId,
    undefined,
    oidc.ClientSecretPost(clientSecret),
  );
  authReady = true;
}
