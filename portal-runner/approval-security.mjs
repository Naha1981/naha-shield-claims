// Ported from the isolated morning build (claims-worker-step1/approval-security.mjs).
// Change from original: the action-type and claim-ref allowlists are constructor
// options (defaults preserve the original behavior exactly). Token, session,
// scrypt login, CSRF, single-use consume and replay-denial semantics unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');

// Roles come ONLY from the server-side enrolled credential record, never from
// client headers or request bodies.
export const APPROVAL_ROLES = ['investigator', 'reviewer', 'admin', 'CFO'];

export class ApprovalSecurity {
  constructor(file, options = {}) {
    this.file = file;
    this.allowedActionTypes = options.allowedActionTypes || [
      'INTERNAL_SYNTHETIC_REPORT_REVIEW',
    ];
    this.allowedClaimRefs = options.allowedClaimRefs || ['SYN-RC-004'];
    this.state = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file))
      : { sessions: {}, tokens: {}, decisions: [] };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  login(username, password, credential) {
    if (!credential) throw Error('REVIEWER_NOT_ENROLLED');
    if (username !== credential.username) throw Error('INVALID_LOGIN');
    const actual = crypto.scryptSync(password, credential.salt, 64);
    const expected = Buffer.from(credential.password_hash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
      throw Error('INVALID_LOGIN');
    // Fail closed: the enrolled credential must carry a known server-side role.
    if (!credential.role || !APPROVAL_ROLES.includes(credential.role))
      throw Error('CREDENTIAL_ROLE_INVALID');
    const secret = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    this.state.sessions[hash(secret)] = {
      principal: credential.principal,
      role: credential.role,
      csrf,
      expires: Date.now() + 30 * 60 * 1000,
    };
    this.save();
    return { secret, csrf, principal: credential.principal, role: credential.role };
  }

  session(secret) {
    const s = this.state.sessions[hash(secret || '')];
    if (!s || s.expires < Date.now()) throw Error('AUTH_REQUIRED');
    return s;
  }

  approve(secret, csrf, action) {
    const s = this.session(secret);
    if (csrf !== s.csrf) throw Error('CSRF_DENIED');
    if (
      !this.allowedActionTypes.includes(action.type) ||
      !this.allowedClaimRefs.includes(action.claim_ref)
    ) {
      throw Error('ACTION_NOT_PERMITTED');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    this.state.tokens[hash(token)] = {
      ...action,
      principal: s.principal,
      expires: Date.now() + 300000,
      used: false,
    };
    this.state.decisions.push({ principal: s.principal, at: new Date().toISOString(), ...action });
    this.save();
    return token;
  }

  consume(token, action) {
    const t = this.state.tokens[hash(token || '')];
    if (!t || t.used || t.expires < Date.now())
      throw Error('TOKEN_INVALID_EXPIRED_OR_USED');
    for (const k of ['type', 'claim_ref', 'digest'])
      if (t[k] !== action[k]) throw Error('TOKEN_ACTION_MISMATCH');
    t.used = true;
    this.save();
    return { principal: t.principal, internal_review_only: true, external_action: false };
  }
}
