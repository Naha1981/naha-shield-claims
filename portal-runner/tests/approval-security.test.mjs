// Ported from claims-worker-step1/test-approval-security.mjs.
// Changes: node:test structure, tmp-dir paths, no fixture writes outside tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApprovalSecurity, APPROVAL_ROLES } from '../approval-security.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-security-'));
const file = path.join(tmp, 'security-test.json');
const fixture = {
  username: 'UNIT-TEST-NOT-A-HUMAN',
  principal: 'synthetic-unit-test-principal-NOT-HUMAN',
  role: 'reviewer',
  salt: 'unit-test-only',
  password_hash: crypto.scryptSync('public-fixture-not-a-secret', 'unit-test-only', 64).toString('hex'),
};
const action = {
  type: 'INTERNAL_SYNTHETIC_REPORT_REVIEW',
  claim_ref: 'SYN-RC-004',
  digest: 'fixture-digest',
};

test('denies unenrolled, wrong password, missing session, CSRF and off-allowlist actions', () => {
  const s = new ApprovalSecurity(file);
  assert.throws(() => s.login('x', 'x', null));
  assert.throws(() => s.login(fixture.username, 'wrong', fixture));
  assert.throws(() => s.approve('', '', action));
  const login = s.login(fixture.username, 'public-fixture-not-a-secret', fixture);
  assert.throws(() => s.approve(login.secret, 'wrong', action));
  assert.throws(() => s.approve(login.secret, login.csrf, { ...action, type: 'EXTERNAL_SEND' }));
  assert.throws(() => s.approve(login.secret, login.csrf, { ...action, claim_ref: 'OTHER' }));
});

test('bound token persists across restart, consumes once, denies tamper and replay', () => {
  fs.rmSync(file, { force: true });
  const s = new ApprovalSecurity(file);
  const login = s.login(fixture.username, 'public-fixture-not-a-secret', fixture);
  const token = s.approve(login.secret, login.csrf, action);
  assert.throws(() => s.consume(token, { ...action, digest: 'changed' }));
  assert.throws(() => s.consume(token, { ...action, claim_ref: 'SYN-RC-009' }));
  const restarted = new ApprovalSecurity(file);
  const consumed = restarted.consume(token, action);
  assert.equal(consumed.external_action, false);
  assert.equal(consumed.internal_review_only, true);
  assert.throws(() => restarted.consume(token, action));
});

test('session returns server-side role from the enrolled credential', () => {
  const file3 = path.join(tmp, 'security-test-3.json');
  const s = new ApprovalSecurity(file3);
  const login = s.login(fixture.username, 'public-fixture-not-a-secret', fixture);
  assert.equal(login.role, 'reviewer');
  const session = s.session(login.secret);
  assert.equal(session.principal, fixture.principal);
  assert.equal(session.role, 'reviewer');
  assert.ok(session.csrf && session.expires > Date.now());
  // Role persists across restart (stored server-side, not re-supplied).
  const restarted = new ApprovalSecurity(file3);
  assert.equal(restarted.session(login.secret).role, 'reviewer');
});

test('login fails closed on missing or unknown credential role', () => {
  const file4 = path.join(tmp, 'security-test-4.json');
  const s = new ApprovalSecurity(file4);
  const noRole = { ...fixture };
  delete noRole.role;
  assert.throws(() => s.login(noRole.username, 'public-fixture-not-a-secret', noRole), /CREDENTIAL_ROLE_INVALID/);
  assert.throws(
    () => s.login(fixture.username, 'public-fixture-not-a-secret', { ...fixture, role: 'superuser' }),
    /CREDENTIAL_ROLE_INVALID/,
  );
});

test('every allowed role is accepted from the credential record', () => {
  const file5 = path.join(tmp, 'security-test-5.json');
  const s = new ApprovalSecurity(file5);
  for (const role of APPROVAL_ROLES) {
    const login = s.login(fixture.username, 'public-fixture-not-a-secret', { ...fixture, role });
    assert.equal(s.session(login.secret).role, role);
  }
  assert.deepEqual(APPROVAL_ROLES, ['investigator', 'reviewer', 'admin', 'CFO']);
});

test('claim allowlist is configurable and enforced', () => {
  const file2 = path.join(tmp, 'security-test-2.json');
  const s = new ApprovalSecurity(file2, { allowedClaimRefs: ['SYN-RC-007'] });
  const login = s.login(fixture.username, 'public-fixture-not-a-secret', fixture);
  assert.throws(() => s.approve(login.secret, login.csrf, action));
  const ok = s.approve(login.secret, login.csrf, { ...action, claim_ref: 'SYN-RC-007' });
  assert.equal(typeof ok, 'string');
});
