import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler, SYNTHETIC_LABEL, type HandlerDef } from './scheduler';
import { schedulerRoutes } from './schedulerRoutes';

const P = (x: any = {}) => ({ dataset_label: SYNTHETIC_LABEL, case_id: 'SYN-1', ...x });
function mk(over: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sch-')); const path = join(dir, 'j.jsonl'); let t = 1_000_000;
  const calls: string[] = []; const writes: string[] = [];
  const deps = { calls, writes };
  const h = (id = 'test.flow', extra: Partial<HandlerDef> = {}): HandlerDef => ({ id, version: '1', validate: p => { if (!p.case_id) throw new Error('case_id'); }, steps: [
    { name: 'read', kind: 'read', run: c => { calls.push('read'); return { n: 1 }; } },
    { name: 'draft', kind: 'draft', run: c => { calls.push('draft:' + (c.outputs.read as any).n); return { text: 'draft' }; } },
    { name: 'send', kind: 'external_write', run: c => { writes.push(c.idempotencyKey); return 'sent'; } },
    { name: 'after', kind: 'read', run: () => { calls.push('after'); return 1; } },
  ], ...extra });
  const mkS = (o: any = {}) => { const s = new Scheduler<any>({ journalPath: path, deps, now: () => t, ...over, ...o }); s.registerHandler(h()); return s; };
  return { path, calls, writes, mkS, h, adv: (ms: number) => (t += ms) };
}

test('runs to approval gate, never writes unattended; approval without enabled writes still does not send', async () => {
  const m = mk(); const s = m.mkS();
  const j = s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000001' }, 'u');
  await s.tick();
  assert.equal(s.get(j.id)!.status, 'awaiting_approval'); assert.equal(m.writes.length, 0);
  assert.throws(() => s.decide(j.id, 'u', true, 'bad'), /mismatch/);
  assert.throws(() => s.decide(j.id, 'system', true, s.get(j.id)!.pendingProposal!.hash), /human/);
  s.decide(j.id, 'thabiso', true, s.get(j.id)!.pendingProposal!.hash); await s.tick();
  assert.equal(s.get(j.id)!.status, 'completed'); assert.equal(m.writes.length, 0);
  assert.deepEqual(s.get(j.id)!.outputs.send, { not_executed: true, reason: 'external writes disabled' });
  assert.equal(s.verifyAudit().valid, true);
});
test('write executes only with allowExternalWrites AND approval, once, with stable idempotency key', async () => {
  const m = mk(); const s = m.mkS({ allowExternalWrites: true });
  const j = s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000002' }, 'u'); await s.tick();
  s.decide(j.id, 'thabiso', true, s.get(j.id)!.pendingProposal!.hash); await s.tick();
  assert.equal(m.writes.length, 1); assert.equal(s.get(j.id)!.status, 'completed');
});
test('reject cancels; idempotency; param safety; unknown handler', async () => {
  const m = mk(); const s = m.mkS();
  const a = s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000003' }, 'u');
  assert.equal(s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000003' }, 'u').id, a.id);
  assert.throws(() => s.submit({ handler: 'test.flow', params: P({ case_id: 'SYN-2' }), idempotencyKey: 'key-00000003' }, 'u'), /different/);
  for (const bad of [{ url: 'x' }, { nested: { command: 'ls' } }, { note: 'see https://evil.example' }, { cron: '* * * * *' }]) assert.throws(() => s.submit({ handler: 'test.flow', params: P(bad), idempotencyKey: 'key-' + Math.random().toString(36).slice(2, 12) }, 'u'));
  assert.throws(() => s.submit({ handler: 'test.flow', params: { case_id: 'x' }, idempotencyKey: 'key-00000004' }, 'u'), /synthetic/);
  assert.throws(() => s.submit({ handler: 'rm -rf', params: P(), idempotencyKey: 'key-00000005' }, 'u'), /unknown handler/);
  assert.throws(() => s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000006', everyMs: 5 }, 'u'), /60000/);
  await s.tick(); s.decide(a.id, 'h', false, s.get(a.id)!.pendingProposal!.hash); assert.equal(s.get(a.id)!.status, 'cancelled'); assert.equal(m.writes.length, 0);
});
test('pause/resume/cancel/retry and scheduled runAt', async () => {
  const m = mk(); const s = m.mkS();
  const j = s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000007', runAt: 1_000_000 + 60_000 }, 'u');
  await s.tick(); assert.equal(m.calls.length, 0);
  s.pause(j.id, 'u'); m.adv(120_000); await s.tick(); assert.equal(m.calls.length, 0);
  s.resume(j.id, 'u'); await s.tick(); assert.equal(s.get(j.id)!.status, 'awaiting_approval');
  s.cancel(j.id, 'u'); assert.equal(s.get(j.id)!.status, 'cancelled'); assert.throws(() => s.cancel(j.id, 'u'));
  s.retry(j.id, 'u'); assert.equal(s.get(j.id)!.status, 'queued'); await s.tick(); assert.equal(s.get(j.id)!.status, 'awaiting_approval');
});
test('mid-run pause takes effect at step boundary', async () => {
  const m = mk(); const dir = m.path; let s!: Scheduler<any>;
  s = m.mkS(); s.registerHandler({ id: 'test.pauser', version: '1', validate: () => {}, steps: [
    { name: 'a', kind: 'read', run: c => { s.pause(c.jobId, 'u'); return 1; } }, { name: 'b', kind: 'read', run: () => 2 }] });
  const j = s.submit({ handler: 'test.pauser', params: P(), idempotencyKey: 'key-00000008' }, 'u'); await s.tick();
  assert.equal(s.get(j.id)!.status, 'paused'); assert.equal(s.get(j.id)!.stepIndex, 1);
  s.resume(j.id, 'u'); await s.tick(); assert.equal(s.get(j.id)!.status, 'completed');
});
test('failure retries with backoff then fails; manual retry', async () => {
  const m = mk(); const s = m.mkS(); let n = 0;
  s.registerHandler({ id: 'test.flaky', version: '1', validate: () => {}, steps: [{ name: 'x', kind: 'read', run: () => { n++; throw new Error('boom'); } }] });
  const j = s.submit({ handler: 'test.flaky', params: P(), idempotencyKey: 'key-00000009', maxAttempts: 2 }, 'u');
  await s.tick(); assert.equal(s.get(j.id)!.status, 'queued'); assert.equal(n, 1);
  await s.tick(); assert.equal(n, 1); m.adv(60_000); await s.tick(); assert.equal(s.get(j.id)!.status, 'failed'); assert.equal(n, 2);
  s.retry(j.id, 'u'); assert.equal(s.get(j.id)!.attempts, 0);
});
test('step timeout aborts and fails', async () => {
  const m = mk(); const s = m.mkS(); let aborted = false;
  s.registerHandler({ id: 'test.slow', version: '1', validate: () => {}, steps: [{ name: 'x', kind: 'read', timeoutMs: 20, run: c => new Promise(() => { c.signal.addEventListener('abort', () => aborted = true); }) }] });
  const j = s.submit({ handler: 'test.slow', params: P(), idempotencyKey: 'key-00000010', maxAttempts: 1 }, 'u'); await s.tick();
  assert.equal(s.get(j.id)!.status, 'failed'); assert.equal(aborted, true);
});
test('restart recovery: interrupted step reruns, completed steps are not repeated, chain intact; tamper and torn tail', async () => {
  const m = mk(); let s = m.mkS();
  const j = s.submit({ handler: 'test.flow', params: P(), idempotencyKey: 'key-00000011' }, 'u');
  // simulate crash after job.started + first step completed
  (s as any).emitSync('job.started', j.id, 'scheduler', { attempt: 1 });
  (s as any).emitSync('step.completed', j.id, 'scheduler', { step: 'read', step_index: 0, output: { n: 1 } });
  const s2 = m.mkS(); // new process replays
  assert.equal(s2.get(j.id)!.status, 'queued'); assert.equal(s2.get(j.id)!.stepIndex, 1);
  await s2.tick(); assert.deepEqual(m.calls, ['draft:1']); assert.equal(s2.get(j.id)!.status, 'awaiting_approval');
  assert.ok(s2.auditFor(j.id).some(e => e.type === 'job.recovered'));
  // torn final line tolerated
  writeFileSync(m.path, readFileSync(m.path, 'utf8') + '{"seq":99,"par'); const s3 = m.mkS(); assert.equal(s3.get(j.id)!.status, 'awaiting_approval'); s3.cancel(j.id, 'u'); assert.equal(m.mkS().get(j.id)!.status, 'cancelled'); s3.retry(j.id, 'u');
  // tamper detected
  const lines = readFileSync(m.path, 'utf8').split('\n'); lines[0] = lines[0].replace('SYN-1', 'SYN-9'); writeFileSync(m.path, lines.join('\n'));
  assert.throws(() => m.mkS(), /chain broken/);
});
test('recurrence creates one deterministic next job; no duplicate after replay', async () => {
  const m = mk(); const s = m.mkS();
  s.registerHandler({ id: 'test.tiny', version: '1', validate: () => {}, steps: [{ name: 'x', kind: 'read', run: () => 1 }] });
  s.submit({ handler: 'test.tiny', params: P(), idempotencyKey: 'key-00000012', everyMs: 60_000, maxRuns: 3 }, 'u');
  await s.tick(); assert.equal(s.list().length, 2); m.adv(61_000); await s.tick(); assert.equal(s.list().length, 3); m.adv(61_000); await s.tick();
  assert.equal(s.list().length, 3); assert.equal(m.mkS().list().length, 3);
});
test('concurrency is 1: overlapping ticks do not run steps in parallel', async () => {
  const m = mk(); const s = m.mkS(); let cur = 0, max = 0;
  s.registerHandler({ id: 'test.par', version: '1', validate: () => {}, steps: [{ name: 'x', kind: 'read', run: async () => { cur++; max = Math.max(max, cur); await new Promise(r => setTimeout(r, 20)); cur--; } }] });
  for (let i = 0; i < 3; i++) s.submit({ handler: 'test.par', params: P(), idempotencyKey: 'key-par-000' + i }, 'u');
  await Promise.all([s.tick(), s.tick(), s.tick()]); assert.equal(max, 1); assert.equal(s.list().filter(j => j.status === 'completed').length, 3);
});
test('routes: origin gate, auth, submit, decision', async () => {
  const m = mk(); const s = m.mkS(); const app = express(); app.use(express.json());
  app.use('/q', schedulerRoutes(s, req => req.headers['x-t'] === 'ok' ? 'thabiso' : null));
  const srv = app.listen(0, '127.0.0.1'); await new Promise<void>(r => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + (srv.address() as any).port;
  const rq = (p: string, body?: any, auth = true, origin = base) => fetch(base + '/q' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin, ...(auth ? { 'x-t': 'ok' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await rq('/jobs', undefined, false)).status, 401);
    assert.equal((await rq('/jobs', { handler: 'test.flow' }, true, 'https://x.invalid')).status, 403);
    assert.equal((await rq('/jobs', { handler: 'test.flow', params: P({ url: 'x' }), idempotency_key: 'key-route-001' })).status, 400);
    const r = await (await rq('/jobs', { handler: 'test.flow', params: P(), idempotency_key: 'key-route-002' })).json() as any;
    await s.tick(); const d = await (await rq('/jobs/' + r.job.id)).json() as any;
    assert.equal(d.job.status, 'awaiting_approval');
    assert.equal((await rq(`/jobs/${r.job.id}/decision`, { approve: true, proposal_hash: 'no' })).status, 400);
    assert.equal((await rq(`/jobs/${r.job.id}/decision`, { approve: true, proposal_hash: d.job.pendingProposal.hash })).status, 200);
    assert.equal(((await (await rq('/audit/verify')).json()) as any).valid, true);
  } finally { await new Promise<void>(r => srv.close(() => r())); }
});
