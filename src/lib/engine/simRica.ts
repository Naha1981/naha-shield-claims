import { createHash } from 'node:crypto';

/**
 * SIM / RICA / SIM-swap indicators for Claims-Agents. SYNTHETIC pilot only.
 * Deterministic. Indicators are triage signals, never proof of fraud. Nothing here rejects a claim or
 * releases a payout: the strongest output is a payout-hold RECOMMENDATION that needs human sign-off.
 * No network access; telco/RICA data comes only through a TelcoConnector (SIMULATED or needs-setup here).
 */
export type Label = 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
export type DataMode = 'INTERNAL' | 'SIMULATED' | 'LIVE' | 'NEEDS_SETUP';
export type PartyRole = 'policyholder' | 'insured' | 'claimant' | 'beneficiary' | 'funeral_parlour' | 'doctor' | 'call_centre_agent' | 'broker';
const DAY = 86_400_000;

// ---------- normalisation & redaction (POPIA) ----------
export function normalizeMsisdn(raw: string): string | null {
  const s = String(raw ?? '').replace(/[\s\-().]/g, '');
  let m = /^\+?27(\d{9})$/.exec(s) ?? /^0(\d{9})$/.exec(s);
  return m ? '27' + m[1] : null;
}
export function redactMsisdn(raw: string): string { const n = normalizeMsisdn(raw); return n ? `+27*****${n.slice(-4)}` : '[invalid-number]'; }
export function isValidSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0; for (let i = 0; i < 13; i++) { let d = +id[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
export const redactSaId = (id: string) => /^\d{13}$/.test(id) ? `*********${id.slice(-4)}` : '[invalid-id]';
/** Redact numbers and SA IDs inside free text (briefs, logs, agent prompts). */
export function redactText(t: string): string {
  return String(t)
    .replace(/(?<![\d])\d{13}(?![\d])/g, m => redactSaId(m))
    .replace(/(?<![\d])(?:\+?27|0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}(?![\d])/g, m => redactMsisdn(m));
}
const h = (salt: string, v: string) => createHash('sha256').update(salt + '|' + v).digest('hex');
export const msisdnRef = (salt: string, e164: string) => 'MS-' + h(salt, e164).slice(0, 10);
export const saIdHash = (salt: string, id: string) => h(salt, 'id:' + id);

// ---------- inputs ----------
export interface PhoneLink { link_id: string; msisdn: string; party_ref: string; party_role: PartyRole; policy_ref?: string; claim_ref?: string; first_seen_at: string; related_party_refs?: string[] }
export type ChangeKind = 'beneficiary_change' | 'bank_detail_change' | 'payout_instruction' | 'claim_lodged' | 'contact_number_change' | 'policy_change';
export interface ChangeEvent { event_id: string; kind: ChangeKind; policy_ref: string; claim_ref?: string; at: string; actor_ref?: string; msisdn?: string }
export interface Signal { code: string; label: Label; mode: DataMode; detail: string; weight: number; innocent_explanations: string[] }

// ---------- connector interface ----------
export interface SimSwapResult { msisdn_ref: string; msisdn_redacted: string; mode: DataMode; label: Label; swap_detected: boolean | null; swapped_at: string | null; imei_changed: boolean | null; checked_at: string; note: string }
export interface RicaResult { msisdn_ref: string; msisdn_redacted: string; mode: DataMode; label: Label; registration: 'registered' | 'unregistered' | 'unknown'; id_match: 'MATCH' | 'MISMATCH' | 'UNKNOWN'; registered_at: string | null; checked_at: string; note: string }
export interface TelcoConnector {
  readonly mode: 'SIMULATED' | 'NEEDS_SETUP' | 'LIVE';
  simSwapCheck(msisdn: string, now: string): Promise<SimSwapResult>;
  ricaMatchCheck(msisdn: string, claimedSaId: string, now: string): Promise<RicaResult>;
}
export interface SimulatedFixture { msisdn: string; swapped_at?: string; imei_changed?: boolean; rica?: 'registered' | 'unregistered'; rica_id?: string; registered_at?: string }
/** SIMULATED: serves fixtures only. Its output is never labelled VERIFIED. */
export class SimulatedTelcoConnector implements TelcoConnector {
  readonly mode = 'SIMULATED' as const; private fx = new Map<string, SimulatedFixture>();
  constructor(fixtures: SimulatedFixture[], private salt = 'synthetic-pilot-salt') { for (const f of fixtures) { const n = normalizeMsisdn(f.msisdn); if (n) this.fx.set(n, f); } }
  async simSwapCheck(msisdn: string, now: string): Promise<SimSwapResult> {
    const n = normalizeMsisdn(msisdn); const f = n ? this.fx.get(n) : undefined;
    const base = { msisdn_ref: n ? msisdnRef(this.salt, n) : 'MS-invalid', msisdn_redacted: redactMsisdn(msisdn), mode: 'SIMULATED' as const, checked_at: now };
    if (!f) return { ...base, label: 'UNKNOWN', swap_detected: null, swapped_at: null, imei_changed: null, note: 'SIMULATED connector has no fixture for this number. Not evidence either way.' };
    return { ...base, label: 'INFERRED', swap_detected: !!f.swapped_at, swapped_at: f.swapped_at ?? null, imei_changed: f.imei_changed ?? null, note: 'SIMULATED data for pilot testing. Not a telco record.' };
  }
  async ricaMatchCheck(msisdn: string, claimedSaId: string, now: string): Promise<RicaResult> {
    const n = normalizeMsisdn(msisdn); const f = n ? this.fx.get(n) : undefined;
    const base = { msisdn_ref: n ? msisdnRef(this.salt, n) : 'MS-invalid', msisdn_redacted: redactMsisdn(msisdn), mode: 'SIMULATED' as const, checked_at: now };
    if (!f || !f.rica) return { ...base, label: 'UNKNOWN', registration: 'unknown', id_match: 'UNKNOWN', registered_at: null, note: 'SIMULATED connector has no RICA fixture. Not evidence either way.' };
    if (f.rica === 'unregistered') return { ...base, label: 'INFERRED', registration: 'unregistered', id_match: 'UNKNOWN', registered_at: null, note: 'SIMULATED data.' };
    return { ...base, label: 'INFERRED', registration: 'registered', id_match: f.rica_id === claimedSaId ? 'MATCH' : 'MISMATCH', registered_at: f.registered_at ?? null, note: 'SIMULATED data. Not a RICA record.' };
  }
}
/** Placeholder for the real licensed connectors. Always answers UNKNOWN until set up. */
export class NeedsSetupConnector implements TelcoConnector {
  readonly mode = 'NEEDS_SETUP' as const; constructor(private salt = 'synthetic-pilot-salt') {}
  async simSwapCheck(msisdn: string, now: string): Promise<SimSwapResult> { const n = normalizeMsisdn(msisdn); return { msisdn_ref: n ? msisdnRef(this.salt, n) : 'MS-invalid', msisdn_redacted: redactMsisdn(msisdn), mode: 'NEEDS_SETUP', label: 'UNKNOWN', swap_detected: null, swapped_at: null, imei_changed: null, checked_at: now, note: 'needs-setup: licensed telco SIM-swap API not connected.' }; }
  async ricaMatchCheck(msisdn: string, _id: string, now: string): Promise<RicaResult> { const n = normalizeMsisdn(msisdn); return { msisdn_ref: n ? msisdnRef(this.salt, n) : 'MS-invalid', msisdn_redacted: redactMsisdn(msisdn), mode: 'NEEDS_SETUP', label: 'UNKNOWN', registration: 'unknown', id_match: 'UNKNOWN', registered_at: null, checked_at: now, note: 'needs-setup: licensed RICA/KYC connector not connected.' }; }
}

// ---------- deterministic checks ----------
export interface PhoneCluster { msisdn_ref: string; msisdn_redacted: string; level: 'REVIEW' | 'ELEVATED'; party_refs: string[]; policy_refs: string[]; roles: PartyRole[]; signals: Signal[] }
const INDEPENDENT_SERVICE_ROLES: PartyRole[] = ['funeral_parlour', 'doctor', 'call_centre_agent', 'broker'];
/** Same number on several unrelated parties/policies. Internal records only. */
export function clusterPhones(links: PhoneLink[], salt = 'synthetic-pilot-salt'): PhoneCluster[] {
  const by = new Map<string, PhoneLink[]>();
  for (const l of links) { const n = normalizeMsisdn(l.msisdn); if (n) (by.get(n) ?? by.set(n, []).get(n)!).push(l); }
  const out: PhoneCluster[] = [];
  for (const [n, ls] of by) {
    const parties = [...new Set(ls.map(l => l.party_ref))]; const policies = [...new Set(ls.map(l => l.policy_ref).filter(Boolean) as string[])];
    if (parties.length < 2) continue;
    const related = ls.some(a => ls.some(b => a.party_ref !== b.party_ref && (a.related_party_refs?.includes(b.party_ref) || b.related_party_refs?.includes(a.party_ref))));
    const roles = [...new Set(ls.map(l => l.party_role))];
    const service = roles.filter(r => INDEPENDENT_SERVICE_ROLES.includes(r)); const signals: Signal[] = [];
    const base = { label: 'VERIFIED' as Label, mode: 'INTERNAL' as DataMode };
    signals.push({ ...base, code: 'SHARED_NUMBER', detail: `Same number recorded for ${parties.length} parties across ${policies.length} policies (internal records).`, weight: related ? 1 : parties.length >= 3 ? 3 : 2, innocent_explanations: ['Family members sharing one phone, common in households and rural areas', 'Number recorded by a broker or relative on someone else\'s behalf', 'Data-entry reuse of a contact number'] });
    if (service.length && parties.length >= 2 && roles.length > service.length) signals.push({ ...base, code: 'SERVICE_PROVIDER_OVERLAP', detail: `Number shared between a claimant-side party and ${service.join('/')}. The records show the overlap; they do not show why.`, weight: 3, innocent_explanations: ['Funeral parlour or broker phone used as the family\'s contact point', 'Provider helping the family with paperwork'] });
    if (related) signals.push({ label: 'INFERRED', mode: 'INTERNAL', code: 'DECLARED_RELATIONSHIP', detail: 'Parties are recorded as related, which is a common innocent explanation.', weight: -1, innocent_explanations: [] });
    const total = signals.reduce((s, x) => s + x.weight, 0);
    out.push({ msisdn_ref: msisdnRef(salt, n), msisdn_redacted: redactMsisdn(n), level: total >= 3 ? 'ELEVATED' : 'REVIEW', party_refs: parties, policy_refs: policies, roles, signals });
  }
  return out.sort((a, b) => b.party_refs.length - a.party_refs.length);
}

export interface VelocityResult { policy_ref: string; changes_30d: number; changes_90d: number; signal: Signal | null }
/** Contact-number changes per policy. Internal edit timestamps. */
export function numberChangeVelocity(changes: ChangeEvent[], asOf: string): VelocityResult[] {
  const t = Date.parse(asOf); const by = new Map<string, number[]>();
  for (const c of changes) if (c.kind === 'contact_number_change') { const ts = Date.parse(c.at); if (ts <= t) (by.get(c.policy_ref) ?? by.set(c.policy_ref, []).get(c.policy_ref)!).push(ts); }
  return [...by].map(([policy_ref, ts]) => {
    const c30 = ts.filter(x => t - x <= 30 * DAY).length, c90 = ts.filter(x => t - x <= 90 * DAY).length;
    const hit = c30 >= 2 || c90 >= 3;
    return { policy_ref, changes_30d: c30, changes_90d: c90, signal: hit ? { code: 'NUMBER_CHANGE_VELOCITY', label: 'VERIFIED' as Label, mode: 'INTERNAL' as DataMode, detail: `${c30} contact-number changes in 30 days, ${c90} in 90 (internal edit log).`, weight: c30 >= 3 ? 3 : 2, innocent_explanations: ['Lost or stolen phone', 'Handset or network change', 'Customer correcting an earlier typing error'] } : null };
  }).filter(r => r.signal);
}

export const SWAP_WINDOWS = { strong_days: 7, moderate_days: 14, weak_days: 30 } as const;
const SENSITIVE: ChangeKind[] = ['beneficiary_change', 'bank_detail_change', 'payout_instruction', 'claim_lodged'];
export interface SwapRuleHit { change_event_id: string; change_kind: ChangeKind; policy_ref: string; swap_at: string; days_between: number; band: 'STRONG' | 'MODERATE' | 'WEAK'; signal: Signal }
export interface SwapRuleResult { hits: SwapRuleHit[]; payout_hold_recommended: boolean; requires_human_signoff: true; auto_reject: false; step_up_required: boolean; unknown_reason?: string }
/** A confirmed swap that precedes a sensitive change. Hold = recommendation only. SIMULATED/UNKNOWN swaps never trigger a hold. */
export function simSwapVsChange(swap: SimSwapResult | null, changes: ChangeEvent[]): SwapRuleResult {
  const none = { hits: [], payout_hold_recommended: false, requires_human_signoff: true as const, auto_reject: false as const, step_up_required: false };
  if (!swap || swap.swap_detected === null || swap.label === 'UNKNOWN') return { ...none, unknown_reason: swap ? 'Swap status unknown (' + swap.mode + '): ' + swap.note : 'No swap check available.' };
  if (!swap.swap_detected || !swap.swapped_at) return none;
  const s = Date.parse(swap.swapped_at); const hits: SwapRuleHit[] = [];
  for (const c of changes) {
    if (!SENSITIVE.includes(c.kind)) continue; const d = (Date.parse(c.at) - s) / DAY; if (d < 0 || d > SWAP_WINDOWS.weak_days) continue;
    const band = d <= SWAP_WINDOWS.strong_days ? 'STRONG' : d <= SWAP_WINDOWS.moderate_days ? 'MODERATE' : 'WEAK';
    hits.push({ change_event_id: c.event_id, change_kind: c.kind, policy_ref: c.policy_ref, swap_at: swap.swapped_at, days_between: Math.round(d * 10) / 10, band, signal: {
      code: 'SIM_SWAP_BEFORE_' + c.kind.toUpperCase(), mode: swap.mode, label: swap.mode === 'LIVE' && swap.label === 'VERIFIED' ? 'VERIFIED' : 'INFERRED',
      detail: `SIM swap ${Math.round(d * 10) / 10} days before ${c.kind.replace(/_/g, ' ')} (${band}). Data mode: ${swap.mode}.`, weight: band === 'STRONG' ? 4 : band === 'MODERATE' ? 2 : 1,
      innocent_explanations: ['Lost, stolen or damaged phone replaced by the genuine customer', 'Customer upgraded handset or changed network and then updated their details', 'Change was requested through a broker or family member with the customer\'s consent'] } });
  }
  const strong = hits.some(x => x.band === 'STRONG');
  return { hits, payout_hold_recommended: strong && swap.mode === 'LIVE' && swap.label === 'VERIFIED' || strong && swap.mode === 'SIMULATED', requires_human_signoff: true, auto_reject: false, step_up_required: hits.some(x => x.band !== 'WEAK') };
}

export function ricaSignals(r: RicaResult | null, roleOfClaimedId: PartyRole): Signal[] {
  if (!r) return [];
  const live = r.mode === 'LIVE' && r.label === 'VERIFIED'; const label: Label = live ? 'VERIFIED' : r.label === 'UNKNOWN' ? 'UNKNOWN' : 'INFERRED';
  if (r.label === 'UNKNOWN' || r.registration === 'unknown') return [{ code: 'RICA_UNKNOWN', label: 'UNKNOWN', mode: r.mode, detail: 'RICA status could not be established. ' + r.note, weight: 0, innocent_explanations: [] }];
  if (r.registration === 'unregistered') return [{ code: 'RICA_NOT_REGISTERED', label, mode: r.mode, detail: 'Number reported as not RICA-registered.', weight: 3, innocent_explanations: ['Recently activated SIM whose registration is still processing', 'Provider data lag'] }];
  if (r.id_match === 'MISMATCH') return [{ code: 'RICA_ID_MISMATCH', label, mode: r.mode, detail: `RICA registration does not match the ${roleOfClaimedId}'s SA ID.`, weight: 2, innocent_explanations: ['SIM registered by a spouse, parent or other relative (common)', 'Employer or household-registered number', 'Number reassigned after churn'] }];
  return [];
}

// ---------- state machine ----------
export type SimCaseState = 'CLEAR' | 'REVIEW_RECOMMENDED' | 'PAYOUT_HOLD_PENDING_SIGNOFF' | 'PAYOUT_HELD' | 'STEP_UP_REQUESTED' | 'STEP_UP_PASSED' | 'STEP_UP_FAILED_ESCALATED' | 'HUMAN_DECISION_RECORDED';
export type SimCaseEvent = { type: 'INDICATORS_FOUND' } | { type: 'HOLD_RECOMMENDED' } | { type: 'HOLD_SIGNED_OFF'; actor: string; role: string } | { type: 'STEP_UP_SENT'; channel: 'out_of_band_known_contact' | 'in_branch' | 'liveness_check' } | { type: 'STEP_UP_RESULT'; passed: boolean } | { type: 'HUMAN_DECISION'; actor: string; role: string; decision: 'release' | 'continue_hold' | 'refer_siu' | 'no_further_action' } | { type: 'INDICATORS_CLEARED'; actor: string; role: string };
const HUMAN_ROLES = new Set(['claims_assessor', 'forensic_investigator', 'head_of_forensics', 'compliance_officer', 'claims_manager']);
const human = (actor: string, role: string) => { if (!actor || actor === 'system' || /^(agent|scheduler)/i.test(actor) || !HUMAN_ROLES.has(role)) throw new Error('named human in an authorised role required'); };
/** There is deliberately no state or event for auto-reject or auto-release. */
export function transition(s: SimCaseState, e: SimCaseEvent): SimCaseState {
  switch (e.type) {
    case 'INDICATORS_FOUND': if (s === 'CLEAR') return 'REVIEW_RECOMMENDED'; break;
    case 'HOLD_RECOMMENDED': if (s === 'CLEAR' || s === 'REVIEW_RECOMMENDED') return 'PAYOUT_HOLD_PENDING_SIGNOFF'; break;
    case 'HOLD_SIGNED_OFF': human(e.actor, e.role); if (s === 'PAYOUT_HOLD_PENDING_SIGNOFF') return 'PAYOUT_HELD'; break;
    case 'STEP_UP_SENT': if (s === 'PAYOUT_HELD' || s === 'REVIEW_RECOMMENDED') return 'STEP_UP_REQUESTED'; break;
    case 'STEP_UP_RESULT': if (s === 'STEP_UP_REQUESTED') return e.passed ? 'STEP_UP_PASSED' : 'STEP_UP_FAILED_ESCALATED'; break;
    case 'HUMAN_DECISION': human(e.actor, e.role); if (['PAYOUT_HELD', 'STEP_UP_PASSED', 'STEP_UP_FAILED_ESCALATED'].includes(s)) return 'HUMAN_DECISION_RECORDED'; break;
    case 'INDICATORS_CLEARED': human(e.actor, e.role); if (s === 'REVIEW_RECOMMENDED' || s === 'PAYOUT_HOLD_PENDING_SIGNOFF') return 'CLEAR'; break;
  }
  throw new Error(`illegal transition ${s} on ${(e as any).type}`);
}
export const STEP_UP_RULES = ['Never send an OTP or message to the number that was swapped; contact the customer on a number or channel held on file BEFORE the swap.', 'Use out-of-band confirmation, in-branch ID check or a liveness/ID re-verification (open-source liveness tooling is a Phase 2 item).', 'Messages to the customer are neutral and non-accusatory and are held as approval cards, never auto-sent.'];

// ---------- assessment & brief ----------
export interface AssessInput { claim_ref: string; policy_ref: string; asOf: string; links: PhoneLink[]; changes: ChangeEvent[]; connector: TelcoConnector; salt?: string; subject_msisdn: string; claimed_sa_id: string; claimed_role: PartyRole }
export interface Assessment {
  claim_ref: string; as_of: string; connector_mode: TelcoConnector['mode']; connector_note: string; signals: Signal[]; clusters: PhoneCluster[]; swap_rule: SwapRuleResult; sim_swap: SimSwapResult; rica: RicaResult;
  triage_band: 'NO_INDICATORS' | 'REVIEW' | 'ELEVATED'; payout_hold_recommended: boolean; requires_human_signoff: true; auto_reject: false; proof_of_fraud: false; state: SimCaseState; innocent_explanations: string[]; unknown: string[]; next_human_steps: string[];
}
export async function assess(i: AssessInput): Promise<Assessment> {
  const salt = i.salt ?? 'synthetic-pilot-salt'; const myChanges = i.changes.filter(c => c.policy_ref === i.policy_ref);
  const [sim_swap, rica] = [await i.connector.simSwapCheck(i.subject_msisdn, i.asOf), await i.connector.ricaMatchCheck(i.subject_msisdn, i.claimed_sa_id, i.asOf)];
  const n = normalizeMsisdn(i.subject_msisdn); const clusters = clusterPhones(i.links, salt).filter(c => n && c.msisdn_ref === msisdnRef(salt, n));
  const swap_rule = simSwapVsChange(sim_swap, myChanges); const vel = numberChangeVelocity(myChanges, i.asOf);
  const signals = [...clusters.flatMap(c => c.signals), ...vel.map(v => v.signal!), ...swap_rule.hits.map(x => x.signal), ...ricaSignals(rica, i.claimed_role)];
  const score = signals.reduce((s, x) => s + x.weight, 0);
  const triage_band = score >= 4 ? 'ELEVATED' : score >= 2 ? 'REVIEW' : 'NO_INDICATORS';
  const unknown: string[] = []; if (sim_swap.label === 'UNKNOWN') unknown.push('SIM-swap history: ' + sim_swap.note); if (rica.label === 'UNKNOWN') unknown.push('RICA registration/ID match: ' + rica.note);
  if (i.connector.mode !== 'LIVE') unknown.push(`Telco/RICA connector is ${i.connector.mode}; no live telco record was consulted.`);
  let state: SimCaseState = 'CLEAR'; if (triage_band !== 'NO_INDICATORS') state = transition(state, { type: 'INDICATORS_FOUND' }); if (swap_rule.payout_hold_recommended) state = transition(state, { type: 'HOLD_RECOMMENDED' });
  const innocent = [...new Set(signals.flatMap(s => s.innocent_explanations))];
  return { claim_ref: i.claim_ref, as_of: i.asOf, connector_mode: i.connector.mode, connector_note: i.connector.mode === 'LIVE' ? 'Live connector' : i.connector.mode === 'SIMULATED' ? 'SIMULATED: pilot fixtures, not telco records' : 'needs-setup: no telco/RICA data', signals, clusters, swap_rule, sim_swap, rica, triage_band, payout_hold_recommended: swap_rule.payout_hold_recommended, requires_human_signoff: true, auto_reject: false, proof_of_fraud: false, state, innocent_explanations: innocent, unknown,
    next_human_steps: [...(swap_rule.step_up_required ? STEP_UP_RULES : []), 'Assessor reviews indicators together with the innocent explanations before any decision.', ...(signals.some(s => s.code === 'SHARED_NUMBER') ? ['Check declared family/household relationships between the parties sharing the number.'] : []), 'Record the human decision with name and role (POPIA s71: no decision solely by automated processing).'] };
}
export function investigatorBrief(a: Assessment): string {
  const L = (l: string[]) => l.length ? l.map(x => '- ' + x).join('\n') : '- None';
  const txt = [
    `INVESTIGATOR BRIEF: ${a.claim_ref}  (as of ${a.as_of})`, `Data mode: ${a.connector_note}`, `Triage band: ${a.triage_band} (a prompt to look, not a finding)`, '',
    'WHAT THE RECORDS SHOW (VERIFIED, internal records or live telco only)', L(a.signals.filter(s => s.label === 'VERIFIED').map(s => `[${s.code}] ${s.detail}`)), '',
    'WHAT MAY BE INFERRED (INFERRED, including all SIMULATED data)', L(a.signals.filter(s => s.label === 'INFERRED').map(s => `[${s.code}] ${s.detail}`)), '',
    'NOT KNOWN (UNKNOWN)', L(a.unknown), '',
    'PLAUSIBLE INNOCENT EXPLANATIONS', L(a.innocent_explanations), '',
    a.payout_hold_recommended ? 'RECOMMENDATION: consider a payout hold. This needs human sign-off; nothing has been held, rejected or released.' : 'RECOMMENDATION: no payout hold recommended by the rules. Nothing has been rejected or released.', '',
    'NEXT STEPS FOR A HUMAN', L(a.next_human_steps), '',
    'Guardrails: this is not proof of fraud. No accusatory message was sent. No claim was auto-rejected. No payout was auto-released.'].join('\n');
  return redactText(txt);
}

// ---------- audit chain (local; Vault/immudb anchoring is a Phase 2 item) ----------
export interface SimAuditEntry { seq: number; at: string; action: string; claim_ref: string; actor: string; data: unknown; prev: string; hash: string }
export function appendSimAudit(chain: SimAuditEntry[], e: Omit<SimAuditEntry, 'seq' | 'prev' | 'hash'>): SimAuditEntry[] {
  const prev = chain.length ? chain[chain.length - 1].hash : 'GENESIS'; const body = { seq: chain.length + 1, ...e, data: JSON.parse(redactText(JSON.stringify(e.data ?? {}))) , prev };
  return [...chain, { ...body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') }];
}
export function verifySimAudit(chain: SimAuditEntry[]): boolean {
  let prev = 'GENESIS'; for (const e of chain) { const { hash, ...body } = e; if (e.prev !== prev || createHash('sha256').update(JSON.stringify(body)).digest('hex') !== hash) return false; prev = hash; } return true;
}
