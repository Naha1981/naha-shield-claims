import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { incidentControlRoutes, resetIncidentStore, isDisabled, WORKFLOW_STEPS } from './incidentControl';

// Kill switch + incident log executing docs/false-flag-incident-response.md.

let base = '';
async function withServer(fn: () => Promise<void>) {
  resetIncidentStore();
  const a = express();
  a.use(express.json());
  a.use('/ops', incidentControlRoutes());
  const srv = a.listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try { await fn(); } finally { srv.close(); }
}
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const post = (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b, h);
const get = (p: string, h?: Record<string, string>) => call('GET', p, undefined, h);

test('kill switch disables a rule immediately; isDisabled consulted by other modules', () => withServer(async () => {
  const r = await post('/ops/kill-switch/rule/DUP-01/disable', { reason: 'False-positive spike on duplicate rule.' });
  assert.equal(r.status, 200);
  assert.equal(r.body.disabled, true);
  assert.equal(isDisabled('rule', 'DUP-01'), true);
  assert.equal(isDisabled('rule', 'DUP-02'), false);
}));

test('kill switch restricted to compliance and insurer_admin', () => withServer(async () => {
  const denied = await post('/ops/kill-switch/rule/DUP-01/disable', { reason: 'x' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(denied.status, 403);
  const ok = await post('/ops/kill-switch/rule/DUP-01/disable', { reason: 'x' }, { 'x-nahashield-demo-role': 'insurer_admin' });
  assert.equal(ok.status, 200);
}));

test('opening an incident classifies severity, freezes the affected automation, notifies roles without sending', () => withServer(async () => {
  const r = await post('/ops/incidents', { severity: 'S1', trigger: 'Claimant appeal upheld after duplicate false positive.', affected_claim_ids: ['clm_1', 'clm_2'], affected_target: { type: 'rule', id: 'DUP-01' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.response_due_within_hours, 1);
  assert.ok(r.body.steps.some((s: { step: string }) => s.step === 'freeze_automated_action'));
  assert.equal(isDisabled('rule', 'DUP-01'), true, 'affected rule frozen at once');
  assert.ok(r.body.notifications.every((n: { dispatched: boolean }) => n.dispatched === false), 'recorded, never sent');
  const steps = r.body.steps.map((s: { step: string }) => s.step);
  assert.deepEqual(steps.slice(0, 2), ['detect', 'classify_severity']);
}));

test('re-enabling a frozen target requires the incident to record test_fix and resume_workflow', () => withServer(async () => {
  const inc = (await post('/ops/incidents', { severity: 'S2', trigger: 'Model drift alert.', affected_target: { type: 'model', id: 'dup-scorer-v1' } })).body;
  const early = await post('/ops/kill-switch/model/dup-scorer-v1/enable', { reason: 'seems fine' });
  assert.equal(early.status, 422, 'cannot re-enable before the plan steps complete');
  for (const step of ['preserve_evidence', 'assess_claimant_impact', 'correct_claim_status', 'root_cause_analysis', 'correct_rule_model_or_data', 'test_fix', 'resume_workflow']) {
    const r = await post(`/ops/incidents/${inc.incident_id}/steps`, { step, notes: `${step} done` });
    assert.equal(r.status, 200);
  }
  const ok = await post('/ops/kill-switch/model/dup-scorer-v1/enable', { reason: 'Fix tested and workflow resumed.' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.disabled, false);
  assert.equal(isDisabled('model', 'dup-scorer-v1'), false);
}));

test('unknown workflow steps rejected; report_and_close closes the incident', () => withServer(async () => {
  const inc = (await post('/ops/incidents', { severity: 'S4', trigger: 'Isolated false positive, no claimant impact.' })).body;
  const bad = await post(`/ops/incidents/${inc.incident_id}/steps`, { step: 'make_tea' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.message.includes('detect'));
  const close = await post(`/ops/incidents/${inc.incident_id}/steps`, { step: 'report_and_close', notes: 'Closed with no claimant impact.' });
  assert.equal(close.body.status, 'closed');
}));

test('workflow steps match the response plan document order', () => {
  assert.deepEqual(WORKFLOW_STEPS, ['detect', 'classify_severity', 'freeze_automated_action', 'preserve_evidence', 'assess_claimant_impact', 'correct_claim_status', 'notify_claimant_if_affected', 'root_cause_analysis', 'correct_rule_model_or_data', 'test_fix', 'resume_workflow', 'report_and_close']);
});

test('incident audit trail is hash-chained and verifies; tenant isolation on incidents', () => withServer(async () => {
  await post('/ops/incidents', { severity: 'S3', trigger: 'False-positive rate exceeded threshold.', affected_target: { type: 'integration', id: 'mock-liberty' } });
  const audit = await get('/ops/incident-audit');
  assert.equal(audit.body.chain_valid, true);
  assert.ok(audit.body.entries.length >= 2);
  const other = await get('/ops/incidents', { 'x-tenant-id': 'ten_other' });
  assert.equal(other.body.items.length, 0);
}));
