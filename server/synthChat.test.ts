import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SynthChat, synthChatRoutes } from './synthChat';

const H = { id: 'thabiso', role: 'head_of_forensics' as const };

test('whatsapp_sim: agent drafts do not count until a human approves the exact digest', async () => {
  const sunk: any[] = [];
  const c = new SynthChat({ sink: (e) => { sunk.push(e); } });
  const t = await c.createThread({ channel: 'whatsapp_sim', case_id: 'SYN-MOTOR-02', claimant_handle: 'syn-claimant-1' });
  const { drafts } = await c.inbound(t.id, { text: 'SYNTHETIC / FICTIONAL TEST DATA. Where is my claim?' });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].state, 'draft_pending_approval');
  assert.ok(!c.transcript(t.id).counted.some((m) => m.author_kind === 'agent'));
  await assert.rejects(c.decide(drafts[0].id, H, 'approve', 'f'.repeat(64)), /Digest mismatch/);
  const ok = await c.decide(drafts[0].id, H, 'approve', drafts[0].digest);
  assert.equal(ok.state, 'approved_in_test_inbox');
  assert.deepEqual(ok.delivery, { status: 'test_inbox_only', external_sent: false });
  await assert.rejects(c.decide(drafts[0].id, H, 'approve', drafts[0].digest), /not decidable/);
  assert.ok(c.transcript(t.id).counted.some((m) => m.id === drafts[0].id));
  assert.ok(sunk.every((e) => e.details.external_sent === false && e.details.synthetic_only === true));
  assert.equal(c.verifyAudit().valid, true);
  c.audit[1].details = { tampered: true };
  assert.equal(c.verifyAudit().valid, false);
});

test('refuses real-looking handles, bad case ids, missing subject, overlong text', async () => {
  const c = new SynthChat();
  await assert.rejects(c.createThread({ channel: 'whatsapp_sim', case_id: 'SYN-1', claimant_handle: '+27612980377' }), /syn- handle/);
  await assert.rejects(c.createThread({ channel: 'email_sim', case_id: 'SYN-1', claimant_handle: 'someone@gmail.com' }), /syn- handle/);
  await assert.rejects(c.createThread({ channel: 'email_sim', case_id: 'REAL-1', claimant_handle: 'syn-a@test.invalid' }), /SYN-/);
  await assert.rejects(c.createThread({ channel: 'email_sim', case_id: 'SYN-1', claimant_handle: 'syn-a@test.invalid', agent_ids: ['nope'] }), /Unknown agent/);
  const e = await c.createThread({ channel: 'email_sim', case_id: 'SYN-1', claimant_handle: 'syn-a@test.invalid' });
  await assert.rejects(c.inbound(e.id, { text: 'hi' }), /subject/);
  const r = await c.inbound(e.id, { text: 'hi', subject: 'Claim' });
  assert.equal(r.drafts[0].subject, 'Re: Claim');
  const w = await c.createThread({ channel: 'whatsapp_sim', case_id: 'SYN-2', claimant_handle: 'syn-b' });
  await assert.rejects(c.inbound(w.id, { text: 'x'.repeat(1001) }), /over 1000/);
});

test('tipping-off lint blocks agent drafts and human posts', async () => {
  const c = new SynthChat({ responder: () => 'We filed an STR about you.' });
  const g = await c.createThread({ channel: 'group_sim', case_id: 'SYN-3', claimant_handle: 'syn-c', agent_ids: ['investigator_lead', 'claims_sla_coordinator'] });
  await c.join(g.id, H);
  const { drafts } = await c.inbound(g.id, { text: 'hello' });
  assert.equal(drafts.length, 2);
  assert.ok(drafts.every((d) => d.state === 'blocked_lint' && d.lint_violations.includes('STR')));
  await assert.rejects(c.decide(drafts[0].id, H, 'approve', drafts[0].digest), /not decidable/);
  await assert.rejects(c.humanPost(g.id, H.id, 'this is a tipping-off test'), /lint/);
});

test('group: human must join to post or approve; bot drafts from several agents; reject works', async () => {
  const c = new SynthChat();
  const g = await c.createThread({ channel: 'group_sim', case_id: 'SYN-4', claimant_handle: 'syn-d', agent_ids: ['investigator_lead', 'document_evidence_analyst'] });
  await assert.rejects(c.humanPost(g.id, H.id, 'hi'), /Join/);
  const { drafts } = await c.inbound(g.id, { text: 'docs attached' });
  await assert.rejects(c.decide(drafts[0].id, H, 'approve', drafts[0].digest), /joined/);
  await assert.rejects(c.join(g.id, { id: 'x', role: 'finance_cfo' as any }), /approver role/);
  await c.join(g.id, H);
  await c.humanPost(g.id, H.id, 'Reviewing now.');
  await c.decide(drafts[0].id, H, 'approve', drafts[0].digest);
  const rej = await c.decide(drafts[1].id, H, 'reject', drafts[1].digest);
  assert.equal(rej.state, 'rejected');
  const tr = c.transcript(g.id);
  assert.equal(tr.counted.filter((m) => m.author_kind !== 'synthetic_claimant').length, 2);
  const w = await c.createThread({ channel: 'whatsapp_sim', case_id: 'SYN-5', claimant_handle: 'syn-e' });
  await assert.rejects(c.join(w.id, H), /group_sim/);
});

test('router: fails closed, same-origin on writes, approve over HTTP', async () => {
  const c = new SynthChat();
  const app = express(); app.use(express.json());
  let signedIn = false;
  app.use('/api/workforce/chat', synthChatRoutes(c, { authorize: () => (signedIn ? H : null) }));
  const s = app.listen(0, '127.0.0.1'); await new Promise<void>((r) => s.once('listening', r));
  const base = 'http://127.0.0.1:' + (s.address() as any).port;
  const req = (p: string, body?: unknown, origin = base) => fetch(base + '/api/workforce/chat/' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await req('audit')).status, 401);
    signedIn = true;
    assert.equal((await req('threads', {}, 'https://evil.invalid')).status, 403);
    assert.equal((await req('threads', { channel: 'whatsapp_sim', case_id: 'SYN-6', claimant_handle: 'syn-f' })).status, 400);
    const t = await (await req('threads', { channel: 'group_sim', case_id: 'SYN-6', claimant_handle: 'syn-f' })).json();
    assert.equal((await req(`threads/${t.id}/join`, {})).status, 200);
    const inb = await (await req(`threads/${t.id}/inbound`, { text: 'hello' })).json();
    const d = inb.drafts[0];
    assert.equal((await req(`messages/${d.id}/decision`, { decision: 'approve', digest: 'bad' })).status, 400);
    const ok = await (await req(`messages/${d.id}/decision`, { decision: 'approve', digest: d.digest })).json();
    assert.equal(ok.state, 'approved_in_test_inbox');
    const a = await (await req('audit')).json();
    assert.equal(a.verification.valid, true);
  } finally { await new Promise<void>((r) => s.close(() => r())); }
});

test('auth: shared reviewer session only; x-role header ignored; CFO read-only; /me and /threads', async () => {
  const { workforceRoutes } = await import('./workforce');
  const original = globalThis.fetch;
  const store: any = { getSnapshot: () => ({ evidence_items: [] }), logAudit: async () => {} };
  const c = new SynthChat();
  const app = express(); app.use(express.json());
  const wf = workforceRoutes(store);
  let cfo = false;
  app.use('/api/workforce', wf);
  app.use('/api/workforce/chat', synthChatRoutes(c, { authorize: (q) => (cfo && wf.principal(q) ? { id: 'cfo1', role: 'finance_cfo' } : wf.principal(q)) }));
  const s = app.listen(0, '127.0.0.1'); await new Promise<void>((r) => s.once('listening', r));
  const base = 'http://127.0.0.1:' + (s.address() as any).port;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith(base)) return original(url, init);
    if (String(url).endsWith('/login')) return new Response('{}', { status: 200, headers: { 'set-cookie': 'reviewer=opaque; HttpOnly' } });
    return new Response(JSON.stringify({ csrf: 'x' }));
  }) as any;
  const req = (p: string, body?: unknown, cookie = '', extra: Record<string, string> = {}) => original(base + p, { method: body ? 'POST' : 'GET', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await req('/api/workforce/chat/me', undefined, '', { 'x-role': 'head_of_forensics', 'x-user-role': 'head_of_forensics' })).status, 401);
    assert.equal((await req('/api/workforce/chat/threads', { channel: 'group_sim', case_id: 'SYN-9', claimant_handle: 'syn-z' })).status, 401);
    const login = await req('/api/workforce/login', { password: 'not-real' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const me = await (await req('/api/workforce/chat/me', undefined, cookie)).json();
    assert.equal(me.read_only, false);
    assert.equal((await req('/api/workforce/chat/threads', { channel: 'group_sim', case_id: 'SYN-9', claimant_handle: 'syn-z' }, cookie)).status, 200);
    assert.equal((await (await req('/api/workforce/chat/threads', undefined, cookie)).json()).threads.length, 1);
    cfo = true;
    assert.equal((await req('/api/workforce/chat/threads', { channel: 'group_sim', case_id: 'SYN-9', claimant_handle: 'syn-z' }, cookie)).status, 403);
    assert.equal((await (await req('/api/workforce/chat/me', undefined, cookie)).json()).read_only, true);
    assert.equal((await req('/api/workforce/chat/threads', undefined, cookie)).status, 200);
  } finally { globalThis.fetch = original; await new Promise<void>((r) => s.close(() => r())); }
});
