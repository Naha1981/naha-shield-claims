import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, verifyPassword, signToken, verifyToken, loadSeedUsers, authRoutes, requireAuth, authSecret, type AuthUser } from './auth';

const user: AuthUser = { user_id: 'usr_t1', email: 'a@b.c', role: 'compliance', tenant_id: 'ten_x' };
const secret = 'test-secret';

test('scrypt hash round-trips and rejects wrong passwords', () => {
  const h = hashPassword('correct horse');
  assert.ok(h.startsWith('scrypt:'));
  assert.equal(verifyPassword('correct horse', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.notEqual(hashPassword('correct horse'), h); // salted
});

test('token sign/verify round-trip; tampering and expiry rejected', () => {
  const t = signToken(user, secret, 60);
  assert.deepEqual(verifyToken(t, secret), user);
  assert.equal(verifyToken(t, 'other-secret'), null);
  assert.equal(verifyToken(t.slice(0, -2) + 'xx', secret), null);
  const expired = signToken(user, secret, -10);
  assert.equal(verifyToken(expired, secret), null);
});

test('seed users load from env JSON; bad JSON yields none', () => {
  const env = { NAHASHIELD_USERS_JSON: JSON.stringify([{ user_id: 'u1', email: 'a@b.c', password: 'pw', role: 'legal', tenant_id: 'ten_x' }, { broken: true }]) } as NodeJS.ProcessEnv;
  const users = loadSeedUsers(env);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'legal');
  assert.equal(loadSeedUsers({ NAHASHIELD_USERS_JSON: 'not json' } as NodeJS.ProcessEnv).length, 0);
  assert.equal(loadSeedUsers({} as NodeJS.ProcessEnv).length, 0);
});

async function withApp(env: NodeJS.ProcessEnv, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(env));
  app.get('/protected', requireAuth(env), (req, res) => res.json({ ok: true }));
  const srv = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    await fn(base);
  } finally {
    srv.close();
  }
}

test('login issues a token that opens protected routes; wrong password 401', async () => {
  const env = {
    NAHASHIELD_USERS_JSON: JSON.stringify([{ user_id: 'u1', email: 'lawrence@example.com', password: 'demo-pass', role: 'claims_manager', tenant_id: 'ten_pride' }]),
    NAHASHIELD_AUTH_SECRET: secret,
  } as unknown as NodeJS.ProcessEnv;
  await withApp(env, async (base) => {
    const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'lawrence@example.com', password: 'nope' }) });
    assert.equal(bad.status, 401);
    const good = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'lawrence@example.com', password: 'demo-pass' }) });
    assert.equal(good.status, 200);
    const body = await good.json() as { access_token: string; user: { role: string; tenant_id: string } };
    assert.equal(body.user.role, 'claims_manager');
    assert.equal(body.user.tenant_id, 'ten_pride');
    const open = await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${body.access_token}` } });
    assert.equal(open.status, 200);
    const closed = await fetch(`${base}/protected`);
    assert.equal(closed.status, 401);
  });
});

test('bootstrap access code still works as a fallback', async () => {
  const env = { NAHASHIELD_ACCESS_CODE: 'code-1', NAHASHIELD_AUTH_SECRET: secret } as unknown as NodeJS.ProcessEnv;
  await withApp(env, async (base) => {
    const open = await fetch(`${base}/protected`, { headers: { 'x-nahashield-access-code': 'code-1' } });
    assert.equal(open.status, 200);
  });
});

test('authSecret is stable within a boot and honours the env', () => {
  assert.equal(authSecret({ NAHASHIELD_AUTH_SECRET: 'fixed' } as NodeJS.ProcessEnv), 'fixed');
  delete process.env.__NAHASHIELD_BOOT_SECRET;
  const a = authSecret({} as NodeJS.ProcessEnv);
  const b = authSecret({} as NodeJS.ProcessEnv);
  assert.equal(a, b);
});
