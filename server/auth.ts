import crypto from 'node:crypto';
import express from 'express';
import type { SpecRole } from './rbacMatrix';

// Self-contained bearer-token authentication, free and open-source (Node
// crypto only): scrypt password hashing, HMAC-SHA256 signed tokens. This
// covers the spec's OAuth 2.0 bearer-token requirement without an external
// identity provider or spend; an insurer's own IdP can replace the login
// endpoint at integration time.
//
// Users are seeded from the NAHASHIELD_USERS_JSON environment variable:
//   [{"user_id":"usr_1","email":"a@b.c","password":"...","role":"compliance","tenant_id":"ten_x"}]
// or with a pre-hashed password:
//   [{"user_id":"usr_1","email":"a@b.c","password_hash":"scrypt:N:salt:hash",...}]
// No existing account or password is ever changed by this module: it only
// reads what the environment provides.

export type AuthUser = { user_id: string; email: string; role: SpecRole; tenant_id: string };

type SeedUser = { user_id: string; email: string; password?: string; password_hash?: string; role: SpecRole; tenant_id: string };

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32, { N: SCRYPT_N }).toString('hex');
  return `scrypt:${SCRYPT_N}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, nStr, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32, { N: Number(nStr) || SCRYPT_N });
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(user: AuthUser, secret: string, ttlSeconds = 8 * 3600): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: user.user_id, email: user.email, role: user.role, tenant: user.tenant_id, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string): AuthUser | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body.sub || !body.role || !body.tenant) return null;
    if (typeof body.exp === 'number' && body.exp < Math.floor(Date.now() / 1000)) return null;
    return { user_id: String(body.sub), email: String(body.email ?? ''), role: body.role as SpecRole, tenant_id: String(body.tenant) };
  } catch {
    return null;
  }
}

export function loadSeedUsers(env: NodeJS.ProcessEnv = process.env): SeedUser[] {
  const raw = env.NAHASHIELD_USERS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u) => u && u.user_id && u.email && u.role && u.tenant_id && (u.password || u.password_hash));
  } catch {
    return [];
  }
}

export type AuthContext = {
  user: AuthUser;
  via: 'token' | 'access-code';
};

// Resolves the HMAC secret: env first, otherwise a random per-boot secret
// (tokens issued since the last restart stay valid; restarts log everyone out).
export function authSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.NAHASHIELD_AUTH_SECRET || process.env.__NAHASHIELD_BOOT_SECRET || (process.env.__NAHASHIELD_BOOT_SECRET = crypto.randomBytes(32).toString('hex'));
}

export function authRoutes(env: NodeJS.ProcessEnv = process.env) {
  const r = express.Router();
  const users = loadSeedUsers(env);
  r.post('/login', (req, res) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    const password = String(req.body?.password ?? '');
    const found = users.find((u) => u.email.toLowerCase() === email);
    const stored = found?.password_hash ?? (found?.password ? hashPasswordPreview(found.password) : '');
    if (!found || !verifyPassword(password, stored)) {
      return res.status(401).json({ error: 'Email or password is wrong.' });
    }
    const user: AuthUser = { user_id: found.user_id, email: found.email, role: found.role, tenant_id: found.tenant_id };
    res.json({ access_token: signToken(user, authSecret(env)), token_type: 'Bearer', expires_in: 8 * 3600, user });
  });
  return r;
}

// Plaintext seed passwords are hashed in memory at first login comparison;
// the plaintext never persists beyond the env seed itself.
const previewCache = new Map<string, string>();
function hashPasswordPreview(password: string): string {
  if (!previewCache.has(password)) previewCache.set(password, hashPassword(password));
  return previewCache.get(password)!;
}

// Express middleware: accepts a Bearer token, or the bootstrap access code
// (x-nahashield-access-code) when one is configured. Attaches req.authUser.
export function requireAuth(env: NodeJS.ProcessEnv = process.env): express.RequestHandler {
  return (req, res, next) => {
    const header = String(req.headers.authorization ?? '');
    if (header.startsWith('Bearer ')) {
      const user = verifyToken(header.slice(7), authSecret(env));
      if (user) {
        (req as express.Request & { authUser?: AuthContext }).authUser = { user, via: 'token' };
        return next();
      }
    }
    const accessCode = env.NAHASHIELD_ACCESS_CODE;
    if (accessCode && String(req.headers['x-nahashield-access-code'] ?? '') === accessCode) {
      (req as express.Request & { authUser?: AuthContext }).authUser = {
        user: { user_id: 'usr_access_code', email: '', role: 'insurer_admin', tenant_id: 'ten_bootstrap' },
        via: 'access-code',
      };
      return next();
    }
    res.status(401).json({ error: 'Sign-in is required for this action.', login_on: true });
  };
}

export function authUserOf(req: express.Request): AuthContext | null {
  return (req as express.Request & { authUser?: AuthContext }).authUser ?? null;
}
