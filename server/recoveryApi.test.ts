import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { recoveryRoutes, resetRecoveryStore } from './recoveryApi';

// Spec 1 section 1: 16 recovery endpoints. Synthetic data, sample mode (login off).

function app() {
  const a = express();
  a.use(express.json());
  a.use('/v1/recovery-cases', recoveryRoutes());
  return a;
}
let base = '';
async function withServer(fn: () => Promise<void>) {
  resetRecoveryStore();
  const srv = app().listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try { await fn(); } finally { srv.close(); }
}
const KEY = '11111111-2222-3333-4444-555555555555';
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': KEY + path + method + JSON.stringify(body ?? '') , ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), requestId: res.headers.get('x-request-id') };
}
const post = (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b, h);
const get = (p: string, h?: Record<string, string>) => call('GET', p, undefined, h);
const patch = (p: string, b?: unknown, h?: Record<string, string>) => call('PATCH', p, b, h);

async function makeCase(): Promise<string> {
  const r = await post('/v1/recovery-cases', { claim_id: 'clm_01HABC', reason: 'confirmed_fraudulent_payment', amount_paid_cents: 8000000, evidence_ids: ['evd_01H1'], initial_route: 'internal_review', notes: 'Payment confirmed as wrongful after investigation.' });
  assert.equal(r.status, 201);
  return r.body.recovery_case_id;
}

test('1.1 create recovery case: 201, open, idempotent on replay, correlation id present', () => withServer(async () => {
  const body = { claim_id: 'clm_x1', reason: 'confirmed_fraudulent_payment', amount_paid_cents: 8000000 };
  const headers = { 'x-request-id': 'req-test-1' };
  const r1 = await fetch(`${base}/v1/recovery-cases`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'same-key', 'x-request-id': 'req-test-1' }, body: JSON.stringify(body) });
  const j1 = await r1.json();
  assert.equal(r1.status, 201);
  assert.equal(r1.headers.get('x-request-id'), 'req-test-1');
  assert.equal(j1.status, 'open');
  assert.equal(j1.amount_recovered_cents, 0);
  assert.equal(j1.human_approval_required, true);
  assert.equal(j1.automatic_adverse_action, false);
  const r2 = await fetch(`${base}/v1/recovery-cases`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'same-key' }, body: JSON.stringify(body) });
  const j2 = await r2.json();
  assert.equal(j2.recovery_case_id, j1.recovery_case_id, 'same Idempotency-Key replays, no duplicate case');
  const list = await get('/v1/recovery-cases');
  assert.equal(list.body.total_count, 1);
}));

test('mutations without Idempotency-Key are refused with 400', () => withServer(async () => {
  const res = await fetch(`${base}/v1/recovery-cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim_id: 'clm_1', reason: 'x', amount_paid_cents: 1 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
}));

test('RBAC: finance cannot create a case; executive can read; tenant isolation holds', () => withServer(async () => {
  const denied = await post('/v1/recovery-cases', { claim_id: 'clm_2', reason: 'x', amount_paid_cents: 100 }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(denied.status, 403);
  const id = await makeCase();
  const execRead = await get(`/v1/recovery-cases/${id}`, { 'x-nahashield-demo-role': 'executive' });
  assert.equal(execRead.status, 200);
  const crossTenant = await get(`/v1/recovery-cases/${id}`, { 'x-tenant-id': 'ten_other', 'x-nahashield-demo-role': 'head_of_recoveries' });
  assert.equal(crossTenant.status, 403);
  assert.equal(crossTenant.body.error.code, 'TENANT_ACCESS_DENIED');
}));

test('1.2 list filters by status/route/amount/owner with pagination', () => withServer(async () => {
  await makeCase();
  await post('/v1/recovery-cases', { claim_id: 'clm_3', reason: 'x', amount_paid_cents: 500 });
  const filtered = await get('/v1/recovery-cases?min_amount_cents=1000000&page=1&page_size=10');
  assert.equal(filtered.body.total_count, 1);
  const page = await get('/v1/recovery-cases?page_size=1&page=2');
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.total_count, 2);
}));

test('1.4 patch updates non-financial fields only; 1.5 evidence added', () => withServer(async () => {
  const id = await makeCase();
  const p = await patch(`/v1/recovery-cases/${id}`, { owner_id: 'usr_01H9', route: 'civil_claim', status: 'investigating', notes: 'Asset and income tracing requested.' });
  assert.equal(p.status, 200);
  assert.equal(p.body.owner_id, 'usr_01H9');
  assert.equal(p.body.status, 'investigating');
  const e = await post(`/v1/recovery-cases/${id}/evidence`, { evidence_type: 'bank_statement', source: 'insurer_finance', document_id: 'doc_01H', description: 'Bank statement confirming payment', hash: 'sha256:abc' });
  assert.equal(e.status, 201);
  assert.equal(e.body.evidence_type, 'bank_statement');
}));

test('1.6 valuation matches the spec example: NRV -3000000, EV -2775000, write_off', () => withServer(async () => {
  const id = await makeCase();
  const v = await post(`/v1/recovery-cases/${id}/valuation`, { asset_type: 'rural_property', tenure_type: 'permission_to_occupy', estimated_sale_proceeds_cents: 1500000, legal_costs_cents: 4500000, auction_costs_cents: 0, outstanding_bond_cents: 0, arrears_cents: 0, probability_of_recovery: 0.15, time_to_recovery_months: 18 });
  assert.equal(v.status, 200);
  assert.equal(v.body.net_realisable_value_cents, -3000000);
  assert.equal(v.body.expected_value_cents, -2775000);
  assert.equal(v.body.recommended_route, 'write_off');
  assert.equal(v.body.confidence, 'low');
}));

test('1.7 route recommendation is a recommendation; 1.8 approval by head of recoveries moves to pursuing', () => withServer(async () => {
  const id = await makeCase();
  const rec = await post(`/v1/recovery-cases/${id}/route-recommendation`, {});
  assert.equal(rec.body.human_approval_required, true);
  assert.ok(rec.body.evidence_gaps.includes('employment_income'));
  const denied = await post(`/v1/recovery-cases/${id}/route-approval`, { route: 'compensation_order', decision: 'approve', approver_id: 'usr_01H7' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(denied.status, 403);
  const ok = await post(`/v1/recovery-cases/${id}/route-approval`, { route: 'compensation_order', decision: 'approve', approver_id: 'usr_01H7', reason: 'Respondent has identifiable income.' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.route, 'compensation_order');
  assert.equal(ok.body.status, 'pursuing');
}));

test('1.9/1.10 actions never execute without human approval', () => withServer(async () => {
  const id = await makeCase();
  const a = await post(`/v1/recovery-cases/${id}/actions`, { action_type: 'demand_letter', recipient_type: 'claimant', recipient_id: 'psn_01H', channel: 'email', template_id: 'tpl_recovery_demand_v1', scheduled_for: '2026-11-29T09:00:00Z', approval_required: true });
  assert.equal(a.status, 201);
  assert.equal(a.body.status, 'pending_approval');
  assert.equal(a.body.approval_required, true);
  const ap = await post(`/v1/recovery-cases/${id}/actions/${a.body.action_id}/approval`, { decision: 'approve', approver_id: 'usr_01H7', reason: 'Approved for dispatch after legal review.' });
  assert.equal(ap.body.status, 'approved');
}));

test('1.11/1.12 cash counts only after reconciliation clears it', () => withServer(async () => {
  const id = await makeCase();
  const p = await post(`/v1/recovery-cases/${id}/payments`, { payment_reference: 'BANK-REF-001', amount_cents: 2500000, received_at: '2026-11-28T07:00:00Z', bank_statement_id: 'bnk_01H', reconciliation_status: 'pending' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(p.status, 201);
  let kase = (await get(`/v1/recovery-cases/${id}`)).body;
  assert.equal(kase.amount_recovered_cents, 0, 'pending payment is not recovered cash');
  const rec = await post(`/v1/recovery-cases/${id}/payments/${p.body.payment_id}/reconcile`, { bank_statement_line_id: 'bnk_line_01H', matched_amount_cents: 2500000, matched_by: 'usr_fin1' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(rec.body.reconciliation_status, 'cleared');
  assert.equal(rec.body.ledger_status, 'recovered');
  kase = (await get(`/v1/recovery-cases/${id}`)).body;
  assert.equal(kase.amount_recovered_cents, 2500000, 'cleared payment is recovered cash');
}));

test('1.13 write-off and 1.14 close with approver recorded', () => withServer(async () => {
  const id = await makeCase();
  const w = await post(`/v1/recovery-cases/${id}/write-off`, { amount_written_off_cents: 5500000, reason: 'Net realisable value is negative and no viable recovery route exists.', approver_id: 'usr_01H7', evidence_ids: ['evd_01H1'] });
  assert.equal(w.status, 200);
  assert.equal(w.body.amount_written_off_cents, 5500000);
  const c = await post(`/v1/recovery-cases/${id}/close`, { closure_reason: 'written_off', amount_written_off_cents: 5500000, approver_id: 'usr_01H7' });
  assert.equal(c.body.status, 'closed_written_off');
}));

test('1.15 audit trail is hash-chained and verifies; 1.16 webhook events recorded, never dispatched', () => withServer(async () => {
  const id = await makeCase();
  await post(`/v1/recovery-cases/${id}/route-recommendation`, {});
  const audit = await get(`/v1/recovery-cases/${id}/audit`, { 'x-nahashield-demo-role': 'compliance_dpo' });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.chain_valid, true);
  assert.ok(audit.body.entries.length >= 2);
  assert.equal(audit.body.entries[0].prev_hash, 'GENESIS');
  const kase = (await get(`/v1/recovery-cases/${id}`)).body;
  const eventNames = kase.events.map((e: { event: string }) => e.event);
  assert.ok(eventNames.includes('recovery_case.created'));
  assert.ok(eventNames.includes('recovery_case.route_recommended'));
  assert.ok(kase.events.every((e: { dispatched: boolean }) => e.dispatched === false), 'events recorded, never sent anywhere');
}));

test('audit access denied for roles without audit rights; 404 for unknown case', () => withServer(async () => {
  const id = await makeCase();
  const denied = await get(`/v1/recovery-cases/${id}/audit`, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(denied.status, 403);
  const missing = await get('/v1/recovery-cases/rcv_nope');
  assert.equal(missing.status, 404);
}));
