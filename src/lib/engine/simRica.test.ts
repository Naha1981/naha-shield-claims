import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMsisdn, redactMsisdn, redactSaId, redactText, isValidSaId, clusterPhones, numberChangeVelocity, simSwapVsChange, SimulatedTelcoConnector, NeedsSetupConnector, transition, assess, investigatorBrief, appendSimAudit, verifySimAudit, type PhoneLink, type ChangeEvent, type SimAuditEntry } from './simRica';

const ID_A = '8001015009087'; // standard SA ID test number (Luhn valid)
const ID_B = '9202204720082';
const num = '0821234567';
const L = (p: Partial<PhoneLink> & { party_ref: string }): PhoneLink => ({ link_id: 'L' + Math.random(), msisdn: num, party_role: 'claimant', policy_ref: 'POL-' + p.party_ref, first_seen_at: '2026-10-01T00:00:00Z', ...p });
const C = (kind: ChangeEvent['kind'], at: string, policy_ref = 'POL-1'): ChangeEvent => ({ event_id: 'E-' + kind + at, kind, policy_ref, at });

test('normalisation and redaction', () => {
  assert.equal(normalizeMsisdn('082 123 4567'), '27821234567'); assert.equal(normalizeMsisdn('+27-82-123-4567'), '27821234567'); assert.equal(normalizeMsisdn('12345'), null);
  assert.equal(redactMsisdn('0821234567'), '+27*****4567'); assert.equal(redactSaId(ID_A), '*********9087');
  assert.ok(isValidSaId(ID_A)); assert.ok(!isValidSaId('8001015009088'));
  const t = redactText(`call 082 123 4567 or +27821234567 id ${ID_A} ref 20261127`);
  assert.ok(!t.includes('1234567') && !t.includes(ID_A) && t.includes('ref 20261127'));
});
test('clustering: shared number flagged, family relationship softens, singles ignored, no raw MSISDN in output', () => {
  const unrelated = clusterPhones([L({ party_ref: 'P1' }), L({ party_ref: 'P2' }), L({ party_ref: 'P3' }), L({ party_ref: 'P9', msisdn: '0839999999' })]);
  assert.equal(unrelated.length, 1); assert.equal(unrelated[0].level, 'ELEVATED'); assert.equal(unrelated[0].party_refs.length, 3);
  const fam = clusterPhones([L({ party_ref: 'P1', related_party_refs: ['P2'] }), L({ party_ref: 'P2' })]);
  assert.equal(fam[0].level, 'REVIEW'); assert.ok(fam[0].signals.every(s => s.innocent_explanations.length || s.weight < 0));
  const svc = clusterPhones([L({ party_ref: 'P1' }), L({ party_ref: 'FP1', party_role: 'funeral_parlour' })]);
  assert.ok(svc[0].signals.some(s => s.code === 'SERVICE_PROVIDER_OVERLAP'));
  assert.ok(!JSON.stringify(unrelated).includes('821234567'));
});
test('velocity', () => {
  const asOf = '2026-11-27T00:00:00Z';
  assert.equal(numberChangeVelocity([C('contact_number_change', '2026-11-20T00:00:00Z')], asOf).length, 0);
  assert.equal(numberChangeVelocity([C('contact_number_change', '2026-11-20T00:00:00Z'), C('contact_number_change', '2026-11-25T00:00:00Z')], asOf)[0].signal!.weight, 2);
  assert.equal(numberChangeVelocity([C('contact_number_change', '2026-09-20T00:00:00Z'), C('contact_number_change', '2026-10-25T00:00:00Z'), C('contact_number_change', '2026-11-25T00:00:00Z')], asOf).length, 1);
  assert.equal(numberChangeVelocity([C('contact_number_change', '2026-12-01T00:00:00Z')], asOf).length, 0); // future-dated ignored
});
const conn = (swapped_at?: string) => new SimulatedTelcoConnector([{ msisdn: num, swapped_at, imei_changed: true, rica: 'registered', rica_id: ID_B, registered_at: '2026-11-01T00:00:00Z' }]);
test('swap rule: strong/moderate/weak windows, order matters, hold is recommendation only', async () => {
  const sw = await conn('2026-11-20T00:00:00Z').simSwapCheck(num, '2026-11-27T00:00:00Z');
  const r = simSwapVsChange(sw, [C('bank_detail_change', '2026-11-22T00:00:00Z'), C('beneficiary_change', '2026-11-30T00:00:00Z'), C('beneficiary_change', '2026-11-10T00:00:00Z'), C('policy_change', '2026-11-21T00:00:00Z')]);
  assert.deepEqual(r.hits.map(h => h.band), ['STRONG', 'MODERATE']); assert.equal(r.requires_human_signoff, true); assert.equal(r.auto_reject, false);
  assert.ok(r.hits.every(h => h.signal.label === 'INFERRED' && h.signal.innocent_explanations.length >= 2)); // SIMULATED never VERIFIED
  const none = simSwapVsChange(await new NeedsSetupConnector().simSwapCheck(num, 'x'), [C('bank_detail_change', '2026-11-22T00:00:00Z')]);
  assert.equal(none.payout_hold_recommended, false); assert.match(none.unknown_reason!, /needs-setup/);
  assert.equal(simSwapVsChange(await conn().simSwapCheck(num, 'x'), [C('bank_detail_change', '2026-11-22T00:00:00Z')]).hits.length, 0);
});
test('state machine: no auto-reject or auto-release; humans only', () => {
  let s = transition('CLEAR', { type: 'INDICATORS_FOUND' }); s = transition(s, { type: 'HOLD_RECOMMENDED' });
  assert.throws(() => transition(s, { type: 'HOLD_SIGNED_OFF', actor: 'agent-7', role: 'claims_assessor' }), /human/);
  assert.throws(() => transition(s, { type: 'HOLD_SIGNED_OFF', actor: 'system', role: 'claims_assessor' }), /human/);
  assert.throws(() => transition(s, { type: 'HUMAN_DECISION', actor: 'thandi', role: 'claims_assessor', decision: 'release' }), /illegal/);
  s = transition(s, { type: 'HOLD_SIGNED_OFF', actor: 'thandi', role: 'claims_assessor' }); assert.equal(s, 'PAYOUT_HELD');
  s = transition(s, { type: 'STEP_UP_SENT', channel: 'out_of_band_known_contact' }); s = transition(s, { type: 'STEP_UP_RESULT', passed: false }); assert.equal(s, 'STEP_UP_FAILED_ESCALATED');
  assert.throws(() => transition(s, { type: 'HUMAN_DECISION', actor: 'x', role: 'intake_clerk', decision: 'release' }), /authorised/);
  assert.equal(transition(s, { type: 'HUMAN_DECISION', actor: 'thandi', role: 'head_of_forensics', decision: 'continue_hold' }), 'HUMAN_DECISION_RECORDED');
});
test('assess + brief: labels, innocent explanations, connector mode, redaction, guardrails', async () => {
  const a = await assess({ claim_ref: 'SYN-SIM-01', policy_ref: 'POL-1', asOf: '2026-11-27T00:00:00Z', subject_msisdn: num, claimed_sa_id: ID_A, claimed_role: 'beneficiary', connector: conn('2026-11-20T00:00:00Z'),
    links: [L({ party_ref: 'P1', policy_ref: 'POL-1' }), L({ party_ref: 'P2', policy_ref: 'POL-2' })], changes: [C('bank_detail_change', '2026-11-22T00:00:00Z')] });
  assert.equal(a.connector_mode, 'SIMULATED'); assert.equal(a.payout_hold_recommended, true); assert.equal(a.proof_of_fraud, false); assert.equal(a.auto_reject, false); assert.equal(a.state, 'PAYOUT_HOLD_PENDING_SIGNOFF');
  assert.ok(a.signals.some(s => s.code === 'RICA_ID_MISMATCH' && s.label === 'INFERRED')); assert.ok(a.signals.every(s => s.label !== 'VERIFIED' || s.mode === 'INTERNAL'));
  const b = investigatorBrief(a);
  for (const k of ['VERIFIED', 'INFERRED', 'NOT KNOWN', 'INNOCENT', 'SIMULATED', 'not proof of fraud', 'human sign-off']) assert.ok(b.includes(k), k);
  assert.ok(!b.includes('821234567') && !b.includes(ID_A) && !/fraudster|guilty|criminal/i.test(b));
  const n = await assess({ claim_ref: 'SYN-SIM-02', policy_ref: 'POL-1', asOf: '2026-11-27T00:00:00Z', subject_msisdn: num, claimed_sa_id: ID_A, claimed_role: 'claimant', connector: new NeedsSetupConnector(), links: [], changes: [C('bank_detail_change', '2026-11-22T00:00:00Z')] });
  assert.equal(n.triage_band, 'NO_INDICATORS'); assert.equal(n.payout_hold_recommended, false); assert.ok(n.unknown.length >= 2); assert.match(investigatorBrief(n), /needs-setup/);
});
test('audit chain redacts and detects tamper', () => {
  let c: SimAuditEntry[] = []; c = appendSimAudit(c, { at: 't1', action: 'ASSESSED', claim_ref: 'X', actor: 'agent', data: { note: 'called 0821234567 id ' + ID_A } });
  c = appendSimAudit(c, { at: 't2', action: 'HOLD_SIGNED_OFF', claim_ref: 'X', actor: 'thandi', data: {} });
  assert.ok(verifySimAudit(c)); assert.ok(!JSON.stringify(c).includes(ID_A)); c[0] = { ...c[0], action: 'EDITED' }; assert.ok(!verifySimAudit(c));
});
