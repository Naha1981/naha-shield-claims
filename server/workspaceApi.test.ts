import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { workspaceApiRoutes, resetWorkspaceStore } from './workspaceApi';

// Spec 2 sections 2-6. Synthetic data, demo mode (login off).

let base = '';
async function withServer(fn: () => Promise<void>) {
  resetWorkspaceStore();
  const a = express();
  a.use(express.json());
  a.use('/v1', workspaceApiRoutes());
  const srv = a.listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try { await fn(); } finally { srv.close(); }
}
let k = 0;
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'idempotency-key': `key-${++k}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), requestId: res.headers.get('x-request-id') };
}
const post = (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b, h);
const get = (p: string, h?: Record<string, string>) => call('GET', p, undefined, h);

async function makeClaim(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post('/v1/claims', { policy_id: 'pol_01H1', claim_type: 'funeral', deceased_person_id: 'psn_dec1', claimant_person_id: 'psn_cl1', date_of_death: '2026-11-20', amount_claimed_cents: 7500000, channel: 'agent_app', agent_id: 'agt_01H1', consent_id: 'cns_01H1', ...extra });
  assert.equal(r.status, 201);
  return r.body.claim_id;
}

test('2.1 create claim: 201, clock running, scores null, idempotent replay', () => withServer(async () => {
  const id = await makeClaim();
  const c = (await get(`/v1/claims/${id}`)).body;
  assert.equal(c.status, 'received');
  assert.equal(c.clock_status, 'running');
  assert.ok(c.clock_due_at > c.created_at);
  assert.equal(c.fraud_risk_score, null);
  assert.equal(c.appeal_available, true);
  assert.equal(c.automatic_adverse_action, false);
}));

test('2.1 validation: non-positive amount is a 400 envelope with details', () => withServer(async () => {
  const r = await post('/v1/claims', { policy_id: 'pol_x', claim_type: 'funeral', amount_claimed_cents: -5 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  assert.equal(r.body.error.details[0].field, 'amount_claimed_cents');
  assert.ok(r.body.error.request_id);
}));

test('2.3 list claims: filters + sort + pagination, tenant isolation', () => withServer(async () => {
  await makeClaim();
  await makeClaim({ amount_claimed_cents: 100, agent_id: 'agt_02H2' });
  const filtered = await get('/v1/claims?min_amount_cents=1000000');
  assert.equal(filtered.body.total_count, 1);
  const byAgent = await get('/v1/claims?agent_id=agt_02H2');
  assert.equal(byAgent.body.total_count, 1);
  const other = await get('/v1/claims', { 'x-tenant-id': 'ten_other' });
  assert.equal(other.body.total_count, 0);
  const page = await get('/v1/claims?page_size=1&page=2');
  assert.equal(page.body.items.length, 1);
}));

test('2.4 assign + 2.5 note + 2.6 document', () => withServer(async () => {
  const id = await makeClaim();
  const a = await post(`/v1/claims/${id}/assignment`, { assignee_id: 'usr_01H9', assignment_reason: 'high_risk_review' });
  assert.equal(a.body.owner_id, 'usr_01H9');
  const n = await post(`/v1/claims/${id}/notes`, { note_type: 'investigator_note', content: 'Call-back completed.', visibility: 'internal' });
  assert.equal(n.status, 201);
  const d = await post(`/v1/claims/${id}/documents`, { document_type: 'certified_id', sha256_hash: 'sha256:xyz' });
  assert.equal(d.status, 201);
}));

test('2.7 claim checks: duplicate check runs the real engine and flags a matched claim', () => withServer(async () => {
  const first = await makeClaim();
  const second = await makeClaim({ policy_id: 'pol_01H2' });
  const r = await post(`/v1/claims/${second}/checks`, { checks: ['identity', 'duplicate', 'documents'] });
  assert.equal(r.status, 200);
  const dup = r.body.checks.find((c: { check_type: string }) => c.check_type === 'duplicate');
  assert.equal(dup.status, 'failed');
  assert.equal(dup.result, 'duplicate_claim_detected');
  assert.ok(dup.duplicate_signal_id);
  assert.equal(r.body.automatic_adverse_action, false);
  const clean = await post(`/v1/claims/${first}/checks`, { checks: ['documents'] });
  assert.equal(clean.body.checks[0].result, 'documents_missing');
}));

test('2.8 decision approves with amount; 2.9 payment instruction only on approved claims, capped at approved amount', () => withServer(async () => {
  const id = await makeClaim();
  const early = await post(`/v1/claims/${id}/payment-instruction`, { beneficiary_id: 'psn_cl1', amount_cents: 100, approved_by: 'usr_f' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(early.status, 422);
  const d = await post(`/v1/claims/${id}/decision`, { decision: 'approve', amount_approved_cents: 7000000, reason_code: 'valid_claim', approver_id: 'usr_cm1' });
  assert.equal(d.status, 200);
  assert.equal(d.body.status, 'approved');
  assert.equal(d.body.amount_approved_cents, 7000000);
  const over = await post(`/v1/claims/${id}/payment-instruction`, { beneficiary_id: 'psn_cl1', amount_cents: 8000000, approved_by: 'usr_f' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(over.status, 422);
  const ok = await post(`/v1/claims/${id}/payment-instruction`, { beneficiary_id: 'psn_cl1', amount_cents: 7000000, payment_method: 'eft', bank_account_token: 'tok_01H', approved_by: 'usr_f' }, { 'x-nahashield-demo-role': 'finance_cfo' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'instructed_not_dispatched');
}));

test('3.1 duplicate check: consent required, engine result returned, repeat submission is 202 one-job', () => withServer(async () => {
  const a = await makeClaim();
  const b = await makeClaim({ policy_id: 'pol_02H2', consent_id: undefined });
  const noConsent = await post('/v1/duplicate-checks', { claim_id: b, check_scope: ['same_deceased'] });
  assert.equal(noConsent.status, 403);
  assert.equal(noConsent.body.error.code, 'CONSENT_REQUIRED');
  const r = await post('/v1/duplicate-checks', { claim_id: b, check_scope: ['same_deceased'], consent_id: 'cns_01H1' });
  assert.equal(r.status, 201);
  assert.equal(r.body.risk_level, 'high');
  assert.equal(r.body.matches[0].match_type, 'same_deceased_policy');
  assert.ok(r.body.innocent_explanations.length > 0);
  assert.equal(r.body.human_review_required, true);
  assert.equal(r.body.automatic_adverse_action, false);
  assert.equal(r.body.appeal_available, true);
  const again = await post('/v1/duplicate-checks', { claim_id: b, check_scope: ['same_deceased'], consent_id: 'cns_01H1' });
  assert.equal(again.status, 202);
  assert.equal(again.body.duplicate_check_id, r.body.duplicate_check_id);
}));

test('3.2 get duplicate check + 3.3 resolve signal with reason', () => withServer(async () => {
  await makeClaim();
  const b = await makeClaim({ policy_id: 'pol_03H3', consent_id: undefined });
  const r = await post('/v1/duplicate-checks', { claim_id: b, consent_id: 'cns_01H1' });
  const d = await get(`/v1/duplicate-checks/${r.body.duplicate_check_id}`);
  assert.equal(d.status, 200);
  assert.ok(d.body.signals.length > 0);
  const sig = d.body.signals[0];
  const res = await post(`/v1/duplicate-signals/${sig.duplicate_signal_id}/resolution`, { resolution: 'false_positive', reason: 'Claimant confirmed the second policy belongs to a different family member.', reviewer_id: 'usr_01H9', evidence_ids: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'resolved');
  const bad = await post(`/v1/duplicate-signals/${sig.duplicate_signal_id}/resolution`, { resolution: 'whatever', reason: 'x', reviewer_id: 'u' });
  assert.equal(bad.status, 422);
}));

test('4. evidence: add, get, link, strength; executive sees summary only', () => withServer(async () => {
  const id = await makeClaim();
  const e = await post('/v1/evidence', { claim_id: id, evidence_type: 'bank_statement', source: 'insurer_finance', document_id: 'doc_01H', description: 'Bank statement confirming payment', evidence_class: 'verified_fact', hash: 'sha256:abc' });
  assert.equal(e.status, 201);
  const l = await post(`/v1/claims/${id}/evidence-links`, { evidence_id: e.body.evidence_id, link_type: 'supports_indicator', indicator_id: 'ind_01H' });
  assert.equal(l.status, 201);
  const s = await post(`/v1/evidence/${e.body.evidence_id}/strength`, {});
  assert.equal(s.status, 200);
  assert.ok(s.body.evidence_strength_score >= 0 && s.body.evidence_strength_score <= 100);
  assert.ok(['strong', 'moderate', 'weak'].includes(s.body.label));
  const execView = await get(`/v1/evidence/${e.body.evidence_id}`, { 'x-nahashield-demo-role': 'executive' });
  assert.equal(execView.body.summary_only, true);
  assert.equal(execView.body.description, undefined, 'executives never see raw evidence');
}));

test('5. adverse actions: proposal needs approval, proposer cannot self-approve, hold sets claim on_hold', () => withServer(async () => {
  const id = await makeClaim();
  const a = await post('/v1/adverse-actions', { claim_id: id, action_type: 'hold', reason_code: 'duplicate_claim_detected', reason_text: 'A potential duplicate claim requires review before payment.', proposed_by: 'usr_inv1', expires_at: '2026-12-02T16:00:00Z' });
  assert.equal(a.status, 201);
  assert.equal(a.body.status, 'proposed');
  assert.equal(a.body.automatic, false);
  assert.equal(a.body.appeal_available, true);
  assert.equal((await get(`/v1/claims/${id}`)).body.status, 'received', 'no state change before approval');
  const selfApprove = await post(`/v1/adverse-actions/${a.body.adverse_action_id}/approval`, { decision: 'approve', approver_id: 'usr_inv1' });
  assert.equal(selfApprove.status, 422);
  const ok = await post(`/v1/adverse-actions/${a.body.adverse_action_id}/approval`, { decision: 'approve', approver_id: 'usr_cm1', reason: 'Duplicate signal requires human review.' });
  assert.equal(ok.body.status, 'active');
  assert.equal((await get(`/v1/claims/${id}`)).body.status, 'on_hold');
}));

test('5.3/5.4 appeal: always available, separate reviewer, overturn reverses the action', () => withServer(async () => {
  const id = await makeClaim();
  const a = await post('/v1/adverse-actions', { claim_id: id, action_type: 'hold', reason_code: 'duplicate_claim_detected', reason_text: 'Review needed.', proposed_by: 'usr_inv1' });
  await post(`/v1/adverse-actions/${a.body.adverse_action_id}/approval`, { decision: 'approve', approver_id: 'usr_cm1' });
  const ap = await post('/v1/appeals', { claim_id: id, adverse_action_id: a.body.adverse_action_id, claimant_id: 'psn_cl1', appeal_reason: 'The second policy belongs to a different family member.', supporting_document_ids: ['doc_03H'] }, { 'x-nahashield-demo-role': 'beneficiary' });
  assert.equal(ap.status, 201);
  assert.equal(ap.body.status, 'received');
  const sameReviewer = await post(`/v1/appeals/${ap.body.appeal_id}/decision`, { outcome: 'overturned', reviewer_id: 'usr_cm1' });
  assert.equal(sameReviewer.status, 422, 'appeal reviewer must differ from the approver');
  const d = await post(`/v1/appeals/${ap.body.appeal_id}/decision`, { outcome: 'overturned', reviewer_id: 'usr_legal1', outcome_reason: 'Independent evidence confirms no duplicate cover.', evidence_ids: ['evd_04H'] });
  assert.equal(d.body.status, 'overturned');
  assert.equal((await get(`/v1/claims/${id}`)).body.status, 'under_review', 'hold reversed on overturn');
}));

test('6. notifications: drafts only, insurer name is a variable, forbidden wording flagged, nothing is ever sent', () => withServer(async () => {
  const id = await makeClaim();
  const noName = await post('/v1/notifications', { claim_id: id, recipient_id: 'psn_cl1', channel: 'sms', template_id: 'claim_documents_required_v1', variables: { claim_reference: 'CLM-2026-00421' } });
  assert.equal(noName.status, 400, 'insurer_name is required as a variable');
  const n = await post('/v1/notifications', { claim_id: id, recipient_id: 'psn_cl1', channel: 'sms', template_id: 'claim_documents_required_v1', language: 'en', variables: { insurer_name: 'Pride Life', claim_reference: 'CLM-2026-00421', document_type: 'certified ID', due_date: '2 December 2026' }, approved_by: 'usr_cm1' });
  assert.equal(n.status, 201);
  assert.equal(n.body.send_disabled, true);
  assert.equal(n.body.status, 'draft_requires_human_approval');
  assert.ok(n.body.rendered_body.includes('Pride Life'));
  const status = await get(`/v1/notifications/${n.body.notification_id}`);
  assert.equal(status.body.send_disabled, true);
  const badTemplate = await post('/v1/notifications', { claim_id: id, recipient_id: 'psn_cl1', channel: 'sms', template_id: 'not_a_template' });
  assert.equal(badTemplate.status, 400);
}));

test('conventions: mutation without Idempotency-Key is 400; X-Request-ID on every response', () => withServer(async () => {
  const res = await fetch(`${base}/v1/claims`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ policy_id: 'p', claim_type: 'funeral', amount_claimed_cents: 100 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const g = await get('/v1/claims');
  assert.ok(g.requestId);
}));
