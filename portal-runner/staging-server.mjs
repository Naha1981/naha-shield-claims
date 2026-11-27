// Ported from the isolated morning build (claims-worker-step1/staging-server.mjs).
// Changes from original: all file paths are env-driven (login.html/review.html
// resolve from ./ui next to this module), and the reviewable action type and
// claim ref come from env with the originals as defaults. Login, scrypt
// credential check, rate limiting, origin/CSRF enforcement, single-use bound
// approval tokens, hash-verified image serving and the hash-chained review
// audit log are unchanged in behavior.
import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ApprovalSecurity } from './approval-security.mjs';

const UI_DIR = new URL('./ui/', import.meta.url).pathname;
const data = process.env.DATA_DIR || './data';
fs.mkdirSync(data, { recursive: true });

const REVIEW_ACTION_TYPE =
  process.env.REVIEW_ACTION_TYPE || 'INTERNAL_SYNTHETIC_REPORT_REVIEW';
const REVIEW_CLAIM_REF = process.env.REVIEW_CLAIM_REF || 'SYN-RC-004';
if (!/^SYN-[A-Z0-9-]+$/.test(REVIEW_CLAIM_REF)) {
  throw new Error(`NON_SYNTHETIC_CASE_DENIED: ${REVIEW_CLAIM_REF}`);
}
const EVIDENCE = process.env.EVIDENCE_DIR || './evidence';
const REPORT_FILE = process.env.REPORT_FILE || path.join(EVIDENCE, 'address-evidence-report.json');
const RECEIPTS_FILE = process.env.RECEIPTS_FILE || path.join(EVIDENCE, 'vault-receipts.json');

const REVIEW_ACTION_TYPES = (
  process.env.REVIEW_ACTION_TYPES || REVIEW_ACTION_TYPE
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SKILLS_DIR =
  process.env.SKILLS_DIR ||
  path.join(process.env.WORKER_ROOT || process.cwd(), 'skills');

const security = new ApprovalSecurity(path.resolve(data, 'reviewer-security.json'), {
  allowedActionTypes: REVIEW_ACTION_TYPES,
  allowedClaimRefs: [REVIEW_CLAIM_REF],
});

// Keep in sync with computer-mcp.mjs / src/lib/engine/captureExecutor.ts.
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

// Recompute the skill digest from the actual file; never trust a client-sent
// digest. The approval token binds to the recomputed one.
function loadSkillAction(skillId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(skillId || '')) throw Error('SKILL_ID_DENIED');
  const file = path.join(SKILLS_DIR, skillId + '.json');
  if (!fs.existsSync(file)) throw Error('SKILL_NOT_FOUND');
  const skill = JSON.parse(fs.readFileSync(file));
  const digest = crypto.createHash('sha256').update(canonicalJson(skill.steps), 'utf8').digest('hex');
  if (digest !== skill.steps_digest) throw Error('SKILL_DIGEST_MISMATCH');
  return { type: 'SKILL_REPLAY', claim_ref: skill.case_ref || REVIEW_CLAIM_REF, digest };
}

const app = express();
app.disable('x-powered-by');
const origin = process.env.APP_ORIGIN;
if (!origin) throw Error('APP_ORIGIN required');
const secure = new URL(origin).protocol === 'https:';
if (!secure && !origin.startsWith('http://127.0.0.1:') && !origin.startsWith('http://localhost:'))
  throw Error('HTTPS required outside loopback');
const attempts = new Map();
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  next();
});
const secret = (req) =>
  String(req.headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('reviewer='))
    ?.slice(9) || '';
const report = () => fs.readFileSync(REPORT_FILE);
const action = () => ({
  type: REVIEW_ACTION_TYPE,
  claim_ref: REVIEW_CLAIM_REF,
  digest: crypto.createHash('sha256').update(report()).digest('hex'),
});
function audit(event) {
  const p = path.join(data, 'review-audit.jsonl');
  const rows = fs.existsSync(p)
    ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const record = {
    seq: rows.length + 1,
    at: new Date().toISOString(),
    ...event,
    previous_hash: rows.length ? JSON.parse(rows.at(-1)).hash : '0'.repeat(64),
  };
  record.hash = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
  fs.appendFileSync(p, JSON.stringify(record) + '\n', { mode: 0o600 });
}
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'synthetic-private-reviewer' }));
app.get('/login', (_req, res) =>
  res.type('html').send(fs.readFileSync(path.join(UI_DIR, 'login.html'), 'utf8')),
);
app.post('/login', (req, res) => {
  try {
    if (req.headers.origin !== origin) throw Error('ORIGIN_DENIED');
    const key = req.ip,
      now = Date.now(),
      a = attempts.get(key) || [];
    const recent = a.filter((t) => t > now - 900000);
    if (recent.length >= 5) return res.status(429).json({ error: 'RATE_LIMIT' });
    recent.push(now);
    attempts.set(key, recent);
    const credential = fs.existsSync(path.join(data, 'reviewer-credential.json'))
      ? JSON.parse(fs.readFileSync(path.join(data, 'reviewer-credential.json')))
      : null;
    const s = security.login(String(req.body.username || ''), String(req.body.password || ''), credential);
    attempts.delete(key);
    res.setHeader(
      'Set-Cookie',
      'reviewer=' + s.secret + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800' + (secure ? '; Secure' : ''),
    );
    audit({ type: 'LOGIN', principal: s.principal });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'INVALID_LOGIN_OR_NOT_ENROLLED' });
  }
});
app.use((req, res, next) => {
  try {
    req.reviewer = security.session(secret(req));
    next();
  } catch {
    if (req.method === 'GET' && req.path === '/') return res.redirect('/login');
    res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
});
app.get('/', (_req, res) =>
  res.type('html').send(fs.readFileSync(path.join(UI_DIR, 'review.html'), 'utf8')),
);
app.get('/api/state', (req, res) =>
  res.json({
    principal: req.reviewer.principal,
    role: req.reviewer.role,
    csrf: req.reviewer.csrf,
    report: JSON.parse(report()),
    action: action(),
    review_decisions: security.state.decisions,
  }),
);
app.get('/images/:id', (req, res) => {
  const list = JSON.parse(fs.readFileSync(RECEIPTS_FILE));
  const item = list.find((x) => x.evidence_id === req.params.id);
  if (!item) return res.sendStatus(404);
  const bytes = fs.readFileSync(path.join(EVIDENCE, item.evidence_id + '.png'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256)
    return res.sendStatus(409);
  res.type('png').send(bytes);
});
app.post('/api/approve', (req, res) => {
  try {
    if (req.headers.origin !== origin) throw Error('ORIGIN_DENIED');
    if (req.body.digest !== action().digest) throw Error('REPORT_CHANGED');
    const token = security.approve(secret(req), req.headers['x-csrf-token'], action());
    audit({ type: 'APPROVAL_TOKEN_ISSUED', principal: req.reviewer.principal, action: action() });
    res.json({ token });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});
app.post('/api/record-review', (req, res) => {
  try {
    if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== req.reviewer.csrf)
      throw Error('ORIGIN_OR_CSRF_DENIED');
    const candidate =
      security.state.tokens[crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex')];
    if (!candidate || candidate.principal !== req.reviewer.principal)
      throw Error('PRINCIPAL_MISMATCH');
    const result = security.consume(String(req.body.token || ''), action());
    audit({ type: 'INTERNAL_REPORT_REVIEW_RECORDED', principal: result.principal, action: action() });
    res.json(result);
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});
app.post('/api/approve-skill', (req, res) => {
  try {
    if (req.headers.origin !== origin) throw Error('ORIGIN_DENIED');
    const act = loadSkillAction(String(req.body.skill_id || ''));
    const token = security.approve(secret(req), req.headers['x-csrf-token'], act);
    audit({ type: 'SKILL_REPLAY_APPROVAL_ISSUED', principal: req.reviewer.principal, action: act });
    res.json({ token, action: act });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});
app.post('/api/record-skill-review', (req, res) => {
  try {
    if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== req.reviewer.csrf)
      throw Error('ORIGIN_OR_CSRF_DENIED');
    const act = loadSkillAction(String(req.body.skill_id || ''));
    const candidate =
      security.state.tokens[crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex')];
    if (!candidate || candidate.principal !== req.reviewer.principal)
      throw Error('PRINCIPAL_MISMATCH');
    const result = security.consume(String(req.body.token || ''), act);
    audit({ type: 'SKILL_REPLAY_REVIEW_RECORDED', principal: result.principal, action: act });
    res.json(result);
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});
app.listen(Number(process.env.PORT || 4320), process.env.BIND_HOST || '127.0.0.1');
