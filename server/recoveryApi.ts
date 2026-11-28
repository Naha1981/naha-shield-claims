// Recovery action API from Thabiso's spec 1 section 1 (16 endpoints).
// In-memory, synthetic data only. Auth: when NAHASHIELD_LOGIN=on the global
// /api middleware has already required a bearer token and we use its role;
// with login off (Lawrence's demo) the demo-role header maps through
// DEMO_ROLE_MAP so the demo keeps working.
// Hard rules from the spec: Idempotency-Key on every mutation, X-Request-ID
// correlation on every response, object-level tenant authorisation, cash is
// recognised only after reconciliation clears it, and nothing here ever
// repudiates a claim, accuses a person, or starts recovery without human
// approval. Webhook events are recorded in memory, never dispatched (no
// external contact).

import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { accessOf, canAccessObject, DEMO_ROLE_MAP, type Access, type Capability, type SpecRole } from './rbacMatrix';
import { authUserOf } from './auth';

type Route = 'internal_review' | 'demand_letter' | 'civil_claim' | 'compensation_order' | 'criminal_referral' | 'write_off';
type CaseStatus = 'open' | 'investigating' | 'pending_approval' | 'pursuing' | 'closed_recovered' | 'closed_written_off';

interface Evidence { evidence_id: string; evidence_type: string; source: string; document_id?: string; description?: string; hash?: string; added_by: string; added_at: string }
interface Valuation { asset_type?: string; tenure_type?: string; estimated_sale_proceeds_cents: number; legal_costs_cents: number; auction_costs_cents: number; outstanding_bond_cents: number; arrears_cents: number; probability_of_recovery: number; time_to_recovery_months?: number; net_realisable_value_cents: number; expected_value_cents: number; recommended_route: Route; confidence: string; reason: string; calculated_at: string }
interface RecoveryAction { action_id: string; action_type: string; recipient_type?: string; channel?: string; template_id?: string; scheduled_for?: string; status: 'pending_approval' | 'approved' | 'rejected'; approval_required: true; decision?: { decision: string; approver_id: string; reason?: string; at: string } }
interface Payment { payment_id: string; payment_reference: string; amount_cents: number; received_at: string; bank_statement_id?: string; reconciliation_status: 'pending' | 'cleared'; matched_by?: string; cleared_at?: string }
interface AuditEntry { seq: number; at: string; actor_role: string; actor_id: string; action: string; details: Record<string, unknown>; prev_hash: string; hash: string }
interface RecoveryCase {
  recovery_case_id: string; claim_id: string; policy_id?: string; tenant_id: string; status: CaseStatus;
  amount_paid_cents: number; reason: string; notes?: string; owner_id?: string; route?: Route; recommended_route?: Route;
  evidence: Evidence[]; valuation?: Valuation; route_decision?: { route: Route; decision: string; approver_id: string; reason?: string; at: string };
  actions: RecoveryAction[]; payments: Payment[]; amount_written_off_cents: number;
  audit: AuditEntry[]; events: { event: string; at: string; dispatched: false }[];
  created_at: string; updated_at: string;
}

const cases = new Map<string, RecoveryCase>();
const idempotency = new Map<string, { status: number; body: unknown }>();
let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36).padStart(8, '0')}`;
const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function subjectOf(req: express.Request): { role: SpecRole; tenant_id: string; user_id: string } {
  const auth = authUserOf(req);
  if (auth) return { role: auth.user.role as SpecRole, tenant_id: auth.user.tenant_id, user_id: auth.user.user_id };
  const demoHeader = String(req.headers['x-nahashield-demo-role'] ?? '');
  const role = (DEMO_ROLE_MAP[demoHeader] ?? demoHeader) as SpecRole;
  const known: SpecRole[] = ['policyholder', 'beneficiary', 'agent', 'assessor', 'claims_manager', 'investigator', 'senior_investigator', 'head_of_recoveries', 'finance', 'compliance', 'legal', 'executive', 'insurer_admin', 'nahalabs_support'];
  return { role: known.includes(role) ? role : 'head_of_recoveries', tenant_id: String(req.headers['x-tenant-id'] ?? 'ten_demo'), user_id: 'usr_demo' };
}

export function recoveryRoutes(): express.Router {
  const r = express.Router();

  // Correlation ID on every response.
  r.use((req, res, next) => {
    res.setHeader('x-request-id', String(req.headers['x-request-id'] ?? randomUUID()));
    next();
  });

  // Idempotency-Key required on mutations; replay a stored response on repeat.
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const key = String(req.headers['idempotency-key'] ?? '');
    if (!key) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Mutating calls need an Idempotency-Key header so a retry never repeats an action.' } });
    const scoped = `${req.method} ${req.path} ${key}`;
    const seen = idempotency.get(scoped);
    if (seen) return res.status(seen.status).json(seen.body);
    const json = res.json.bind(res);
    res.json = ((body: unknown) => { idempotency.set(scoped, { status: res.statusCode, body }); return json(body); }) as typeof res.json;
    next();
  });

  const authorize = (req: express.Request, res: express.Response, capability: Capability, kase?: RecoveryCase): { role: SpecRole; tenant_id: string; user_id: string; access: Access } | null => {
    const subject = subjectOf(req);
    if (accessOf(subject.role, capability) === 'no') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role does not have permission for this action. Ask your administrator if you believe this is wrong.' } });
      return null;
    }
    if (kase && !canAccessObject(subject.role, capability, kase, subject)) {
      res.status(403).json({ error: { code: 'TENANT_ACCESS_DENIED', message: 'This record belongs to another organisation.' } });
      return null;
    }
    return { ...subject, access: accessOf(subject.role, capability) };
  };

  const audit = (kase: RecoveryCase, actor: { role: string; user_id: string }, action: string, details: Record<string, unknown>) => {
    const prev = kase.audit[kase.audit.length - 1];
    const prev_hash = prev ? prev.hash : 'GENESIS';
    const entry: AuditEntry = { seq: kase.audit.length + 1, at: now(), actor_role: actor.role, actor_id: actor.user_id, action, details, prev_hash, hash: '' };
    entry.hash = sha(JSON.stringify([prev_hash, entry.seq, entry.at, entry.actor_role, entry.actor_id, entry.action, entry.details]));
    kase.audit.push(entry);
    kase.updated_at = entry.at;
  };
  const emit = (kase: RecoveryCase, event: string) => kase.events.push({ event, at: now(), dispatched: false });

  const publicCase = (k: RecoveryCase) => ({
    recovery_case_id: k.recovery_case_id, claim_id: k.claim_id, policy_id: k.policy_id, tenant_id: k.tenant_id,
    status: k.status, amount_paid_cents: k.amount_paid_cents,
    amount_recovered_cents: k.payments.filter((p) => p.reconciliation_status === 'cleared').reduce((s, p) => s + p.amount_cents, 0),
    amount_written_off_cents: k.amount_written_off_cents,
    net_realisable_value_cents: k.valuation?.net_realisable_value_cents ?? null,
    recommended_route: k.recommended_route ?? k.route ?? null, route: k.route ?? null, owner_id: k.owner_id ?? null,
    evidence: k.evidence, valuation: k.valuation ?? null, route_decision: k.route_decision ?? null,
    actions: k.actions, payments: k.payments, events: k.events,
    human_approval_required: true, automatic_adverse_action: false,
    created_at: k.created_at, updated_at: k.updated_at,
  });

  // 1.1 Create recovery case
  r.post('/', (req, res) => {
    const s = authorize(req, res, 'create_recovery_case'); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id || typeof b.amount_paid_cents !== 'number' || !b.reason) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'claim_id, reason and amount_paid_cents are required.' } });
    }
    const k: RecoveryCase = {
      recovery_case_id: nid('rcv'), claim_id: String(b.claim_id), policy_id: b.policy_id, tenant_id: s.tenant_id,
      status: 'open', amount_paid_cents: b.amount_paid_cents, reason: String(b.reason), notes: b.notes,
      route: b.initial_route, recommended_route: b.initial_route, owner_id: b.owner_id,
      evidence: [], actions: [], payments: [], amount_written_off_cents: 0, audit: [], events: [],
      created_at: now(), updated_at: now(),
    };
    for (const e of (b.evidence_ids ?? []) as string[]) k.evidence.push({ evidence_id: e, evidence_type: 'linked', source: 'insurer', added_by: s.user_id, added_at: now() });
    audit(k, s, 'recovery_case.created', { claim_id: k.claim_id, reason: k.reason, amount_paid_cents: k.amount_paid_cents });
    emit(k, 'recovery_case.created');
    cases.set(k.recovery_case_id, k);
    res.status(201).json(publicCase(k));
  });

  // 1.2 List recovery cases
  r.get('/', (req, res) => {
    const s = authorize(req, res, 'view_recovery_case'); if (!s) return;
    const q = req.query;
    let items = [...cases.values()].filter((k) => k.tenant_id === s.tenant_id);
    if (q.status) items = items.filter((k) => k.status === q.status);
    if (q.route) items = items.filter((k) => (k.recommended_route ?? k.route) === q.route);
    if (q.owner_id) items = items.filter((k) => k.owner_id === q.owner_id);
    if (q.min_amount_cents) items = items.filter((k) => k.amount_paid_cents >= Number(q.min_amount_cents));
    if (q.max_amount_cents) items = items.filter((k) => k.amount_paid_cents <= Number(q.max_amount_cents));
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25)));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    const view = s.access === 'summary' ? summaryCase : publicCase;
    res.json({ items: items.map(view), page, page_size: pageSize, total_count: total });
  });

  const getCase = (req: express.Request, res: express.Response, capability: Capability): { k: RecoveryCase; s: { role: SpecRole; tenant_id: string; user_id: string; access: Access } } | null => {
    const k = cases.get(String(req.params.id ?? req.params.recovery_case_id));
    if (!k) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recovery case not found.' } }); return null; }
    const s = authorize(req, res, capability, k);
    return s ? { k, s } : null;
  };

  // Executives get aggregated value data, never raw evidence (RBAC 'summary').
  const summaryCase = (k: RecoveryCase) => ({
    recovery_case_id: k.recovery_case_id, claim_id: k.claim_id, tenant_id: k.tenant_id, status: k.status,
    amount_paid_cents: k.amount_paid_cents,
    amount_recovered_cents: k.payments.filter((p) => p.reconciliation_status === 'cleared').reduce((s, p) => s + p.amount_cents, 0),
    amount_written_off_cents: k.amount_written_off_cents,
    recommended_route: k.recommended_route ?? k.route ?? null,
    created_at: k.created_at, updated_at: k.updated_at,
  });

  // 1.3 Get recovery case
  r.get('/:id', (req, res) => {
    const got = getCase(req, res, 'view_recovery_case'); if (!got) return;
    res.json(got.s.access === 'summary' ? summaryCase(got.k) : publicCase(got.k));
  });

  // 1.4 Update recovery case (non-financial fields)
  r.patch('/:id', (req, res) => {
    const got = getCase(req, res, 'create_recovery_case'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    for (const f of ['owner_id', 'route', 'status', 'notes'] as const) if (b[f] !== undefined) (k as unknown as Record<string, unknown>)[f] = b[f];
    audit(k, s, 'recovery_case.updated', { fields: Object.keys(b) });
    res.json(publicCase(k));
  });

  // 1.5 Add recovery evidence
  r.post('/:id/evidence', (req, res) => {
    const got = getCase(req, res, 'create_recovery_case'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (!b.evidence_type || !b.source) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'evidence_type and source are required.' } });
    const e: Evidence = { evidence_id: nid('evd'), evidence_type: String(b.evidence_type), source: String(b.source), document_id: b.document_id, description: b.description, hash: b.hash, added_by: s.user_id, added_at: now() };
    k.evidence.push(e);
    audit(k, s, 'recovery_case.evidence_added', { evidence_id: e.evidence_id, evidence_type: e.evidence_type });
    res.status(201).json(e);
  });

  const valuate = (b: Record<string, number | string | undefined>): Valuation => {
    const proceeds = Number(b.estimated_sale_proceeds_cents ?? 0);
    const costs = Number(b.legal_costs_cents ?? 0) + Number(b.auction_costs_cents ?? 0) + Number(b.outstanding_bond_cents ?? 0) + Number(b.arrears_cents ?? 0);
    const p = Number(b.probability_of_recovery ?? 0);
    const nrv = proceeds - costs;
    // Spec 1 section 1.6 pins this example: 1 500 000 proceeds, 4 500 000 costs,
    // p=0.15 -> expected -2 775 000 = NRV + p * proceeds.
    const expected = Math.round(nrv + p * proceeds);
    const recommended_route: Route = nrv < 0 || expected < 0 ? 'write_off' : p >= 0.5 ? 'civil_claim' : 'compensation_order';
    const confidence = p >= 0.6 ? 'high' : p >= 0.2 ? 'medium' : 'low';
    const reason = expected < 0
      ? 'Estimated recovery is materially below estimated legal and recovery costs.'
      : 'Expected recovery exceeds estimated costs; a human must still approve any route.';
    return {
      asset_type: b.asset_type as string | undefined, tenure_type: b.tenure_type as string | undefined,
      estimated_sale_proceeds_cents: proceeds, legal_costs_cents: Number(b.legal_costs_cents ?? 0),
      auction_costs_cents: Number(b.auction_costs_cents ?? 0), outstanding_bond_cents: Number(b.outstanding_bond_cents ?? 0),
      arrears_cents: Number(b.arrears_cents ?? 0), probability_of_recovery: p,
      time_to_recovery_months: b.time_to_recovery_months as number | undefined,
      net_realisable_value_cents: nrv, expected_value_cents: expected, recommended_route, confidence, reason,
      calculated_at: now(),
    };
  };

  // 1.6 Calculate recovery valuation
  r.post('/:id/valuation', (req, res) => {
    const got = getCase(req, res, 'recommend_recovery_route'); if (!got) return;
    const { k, s } = got;
    const v = valuate(req.body ?? {});
    k.valuation = v;
    audit(k, s, 'recovery_case.valuation_calculated', { net_realisable_value_cents: v.net_realisable_value_cents, expected_value_cents: v.expected_value_cents, recommended_route: v.recommended_route });
    res.json({ net_realisable_value_cents: v.net_realisable_value_cents, expected_value_cents: v.expected_value_cents, recommended_route: v.recommended_route, confidence: v.confidence, reason: v.reason });
  });

  // 1.7 Recommend recovery route (recommendation only; human approval always required)
  r.post('/:id/route-recommendation', (req, res) => {
    const got = getCase(req, res, 'recommend_recovery_route'); if (!got) return;
    const { k, s } = got;
    const v = k.valuation;
    const recommended: Route = v ? v.recommended_route : 'internal_review';
    const alternatives: Route[] = (['civil_claim', 'compensation_order', 'write_off', 'demand_letter'] as Route[]).filter((x) => x !== recommended).slice(0, 2);
    const reason = v
      ? v.expected_value_cents < 0
        ? 'Estimated recovery is below estimated costs, so writing off is recommended.'
        : 'Asset value is low, but a compensation order may be viable if the respondent has income or assets.'
      : 'No valuation yet; start with an internal review.';
    const evidence_gaps = ['employment_income', 'bank_account_ownership', 'asset_register'].filter((g) => !k.evidence.some((e) => e.evidence_type === g));
    k.recommended_route = recommended;
    audit(k, s, 'recovery_case.route_recommended', { recommended_route: recommended });
    emit(k, 'recovery_case.route_recommended');
    res.json({ recommended_route: recommended, alternative_routes: alternatives, reason, evidence_gaps, human_approval_required: true });
  });

  // 1.8 Approve recovery route
  r.post('/:id/route-approval', (req, res) => {
    const got = getCase(req, res, 'approve_recovery_route'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (!b.route || !b.decision || !b.approver_id) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'route, decision and approver_id are required.' } });
    k.route_decision = { route: b.route, decision: String(b.decision), approver_id: String(b.approver_id), reason: b.reason, at: now() };
    if (b.decision === 'approve') { k.route = b.route; k.status = 'pursuing'; }
    audit(k, s, 'recovery_case.route_decision', { route: b.route, decision: b.decision });
    emit(k, 'recovery_case.route_approved');
    res.json(publicCase(k));
  });

  // 1.9 Create recovery action (never executes; approval always required)
  r.post('/:id/actions', (req, res) => {
    const got = getCase(req, res, 'create_recovery_case'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (!b.action_type) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'action_type is required.' } });
    const a: RecoveryAction = { action_id: nid('act'), action_type: String(b.action_type), recipient_type: b.recipient_type, channel: b.channel, template_id: b.template_id, scheduled_for: b.scheduled_for, status: 'pending_approval', approval_required: true };
    k.actions.push(a);
    k.status = 'pending_approval';
    audit(k, s, 'recovery_case.action_created', { action_id: a.action_id, action_type: a.action_type });
    emit(k, 'recovery_case.action_created');
    res.status(201).json(a);
  });

  // 1.10 Approve recovery action
  r.post('/:id/actions/:actionId/approval', (req, res) => {
    const got = getCase(req, res, 'approve_recovery_route'); if (!got) return;
    const { k, s } = got;
    const a = k.actions.find((x) => x.action_id === req.params.actionId);
    if (!a) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recovery action not found.' } });
    const b = req.body ?? {};
    if (!b.decision || !b.approver_id) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'decision and approver_id are required.' } });
    a.decision = { decision: String(b.decision), approver_id: String(b.approver_id), reason: b.reason, at: now() };
    a.status = b.decision === 'approve' ? 'approved' : 'rejected';
    audit(k, s, 'recovery_case.action_decision', { action_id: a.action_id, decision: b.decision });
    emit(k, 'recovery_case.action_approved');
    res.json(a);
  });

  // 1.11 Record recovery payment (pending until reconciled)
  r.post('/:id/payments', (req, res) => {
    const got = getCase(req, res, 'record_recovery_payment'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (!b.payment_reference || typeof b.amount_cents !== 'number' || !b.received_at) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'payment_reference, amount_cents and received_at are required.' } });
    const p: Payment = { payment_id: nid('pay'), payment_reference: String(b.payment_reference), amount_cents: b.amount_cents, received_at: String(b.received_at), bank_statement_id: b.bank_statement_id, reconciliation_status: 'pending' };
    k.payments.push(p);
    audit(k, s, 'recovery_case.payment_received', { payment_id: p.payment_id, amount_cents: p.amount_cents, reconciliation_status: 'pending' });
    emit(k, 'recovery_case.payment_received');
    res.status(201).json(p);
  });

  // 1.12 Reconcile recovery payment (only cleared funds count as recovered)
  r.post('/:id/payments/:paymentId/reconcile', (req, res) => {
    const got = getCase(req, res, 'reconcile_recovery_payment'); if (!got) return;
    const { k, s } = got;
    const p = k.payments.find((x) => x.payment_id === req.params.paymentId);
    if (!p) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found.' } });
    const b = req.body ?? {};
    p.reconciliation_status = 'cleared';
    p.matched_by = b.matched_by ? String(b.matched_by) : s.user_id;
    p.cleared_at = now();
    audit(k, s, 'recovery_case.payment_cleared', { payment_id: p.payment_id, amount_cents: p.amount_cents });
    emit(k, 'recovery_case.payment_cleared');
    res.json({ payment_id: p.payment_id, reconciliation_status: 'cleared', amount_recovered_cents: p.amount_cents, ledger_status: 'recovered', cleared_at: p.cleared_at });
  });

  // 1.13 Write off recovery case (human approval recorded)
  r.post('/:id/write-off', (req, res) => {
    const got = getCase(req, res, 'write_off_recovery'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (typeof b.amount_written_off_cents !== 'number' || !b.reason || !b.approver_id) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'amount_written_off_cents, reason and approver_id are required.' } });
    k.amount_written_off_cents = b.amount_written_off_cents;
    audit(k, s, 'recovery_case.written_off', { amount_written_off_cents: b.amount_written_off_cents, approver_id: b.approver_id });
    emit(k, 'recovery_case.written_off');
    res.json(publicCase(k));
  });

  // 1.14 Close recovery case
  r.post('/:id/close', (req, res) => {
    const got = getCase(req, res, 'approve_recovery_route'); if (!got) return;
    const { k, s } = got;
    const b = req.body ?? {};
    if (!b.closure_reason || !b.approver_id) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'closure_reason and approver_id are required.' } });
    k.status = b.closure_reason === 'recovered' ? 'closed_recovered' : 'closed_written_off';
    audit(k, s, 'recovery_case.closed', { closure_reason: b.closure_reason, approver_id: b.approver_id });
    emit(k, 'recovery_case.closed');
    res.json(publicCase(k));
  });

  // 1.15 Recovery audit trail (hash-chained; validity recomputed on read)
  r.get('/:id/audit', (req, res) => {
    const got = getCase(req, res, 'view_audit_log'); if (!got) return;
    // The audit trail is restricted to full-audit roles (compliance, legal, admin).
    if (got.s.access !== 'yes') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role has limited audit access. Compliance can pull the full trail.' } });
    const { k } = got;
    let prev = 'GENESIS';
    let valid = true;
    for (const e of k.audit) {
      if (e.prev_hash !== prev || e.hash !== sha(JSON.stringify([e.prev_hash, e.seq, e.at, e.actor_role, e.actor_id, e.action, e.details]))) { valid = false; break; }
      prev = e.hash;
    }
    res.json({ recovery_case_id: k.recovery_case_id, chain_valid: valid, entries: k.audit });
  });

  return r;
}

// Test helper: reset in-memory state between test runs.
export function resetRecoveryStore() { cases.clear(); idempotency.clear(); seq = 0; }
