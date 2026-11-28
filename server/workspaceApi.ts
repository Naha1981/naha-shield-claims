// Claims workspace APIs from Thabiso's spec 2 sections 2-6: claims, duplicate
// detection, evidence, adverse actions + appeals, and notification drafts.
// In-memory, synthetic data only. Same conventions as the recovery API:
// Idempotency-Key on mutations, X-Request-ID on responses, consistent error
// envelope, RBAC matrix + tenant object checks. POPIA pattern holds: checks
// recommend, humans decide; adverse actions need approval; appeals always
// available; notifications are DRAFTS ONLY - the app never sends SMS or email.

import express from 'express';
import { randomUUID } from 'node:crypto';
import { accessOf, canAccessObject, DEMO_ROLE_MAP, type Access, type Capability, type SpecRole } from './rbacMatrix';
import { authUserOf } from './auth';
import { runDuplicateCheck, type ClaimFacts } from '../src/lib/engine/crossClaimMatching';
import { renderDraft, wordingProblems, MESSAGE_TEMPLATES, type TemplateId, type TemplateVars } from './messageTemplates';

const KNOWN_ROLES: SpecRole[] = ['policyholder', 'beneficiary', 'agent', 'assessor', 'claims_manager', 'investigator', 'senior_investigator', 'head_of_recoveries', 'finance', 'compliance', 'legal', 'executive', 'insurer_admin', 'nahalabs_support'];
interface Subject { role: SpecRole; tenant_id: string; user_id: string }

interface Claim {
  claim_id: string; tenant_id: string; policy_id: string; claim_type: string; status: string;
  deceased_person_id?: string; claimant_person_id?: string; date_of_death?: string;
  amount_claimed_cents: number; amount_approved_cents: number; amount_paid_cents: number;
  channel?: string; agent_id?: string; owner_id?: string;
  fraud_risk_score: number | null; duplicate_risk_score: number | null; evidence_strength_score: number | null;
  clock_status: string; clock_due_at: string;
  documents: { document_id: string; document_type: string; storage_reference?: string; sha256_hash?: string; uploaded_by?: string }[];
  notes: { note_id: string; note_type: string; content: string; visibility: string; author_id: string; created_at: string }[];
  indicators: { indicator_id: string; rule_id: string; severity: string; status: string; summary: string }[];
  evidence_links: { evidence_id: string; link_type: string; indicator_id?: string }[];
  consent_ids: string[];
  submitted_at: string; created_at: string; decided_at?: string; payment_instruction?: Record<string, unknown>;
}
interface DupCheck { duplicate_check_id: string; tenant_id: string; claim_id: string; check_scope: string[]; status: string; result?: ReturnType<typeof runDuplicateCheck>; created_at: string }
interface DupSignal { duplicate_signal_id: string; tenant_id: string; claim_id: string; duplicate_check_id: string; match_type: string; match_confidence: number; recommended_action: string; status: 'open' | 'resolved'; resolution?: { resolution: string; reason: string; reviewer_id: string; at: string } }
interface EvidenceItem { evidence_id: string; tenant_id: string; claim_id: string; evidence_type: string; source: string; document_id?: string; description?: string; evidence_class?: string; hash?: string; strength?: Record<string, unknown>; created_at: string }
interface AdverseAction { adverse_action_id: string; tenant_id: string; claim_id: string; action_type: string; reason_code: string; reason_text: string; evidence_ids: string[]; proposed_by: string; status: 'proposed' | 'active' | 'rejected' | 'reversed'; expires_at?: string; approval?: { decision: string; approver_id: string; reason?: string; at: string }; automatic: false; appeal_available: true; created_at: string }
interface Appeal { appeal_id: string; tenant_id: string; claim_id: string; adverse_action_id: string; claimant_id: string; appeal_reason: string; status: 'received' | 'overturned' | 'upheld'; decision?: { outcome: string; reviewer_id: string; outcome_reason?: string; at: string }; created_at: string }
interface Notification { notification_id: string; tenant_id: string; claim_id: string; recipient_id: string; channel: string; template_id: string; language: string; status: string; rendered_body?: string; wording_warnings: string[]; approved_by?: string; send_disabled: true; created_at: string }

const claims = new Map<string, Claim>();
const dupChecks = new Map<string, DupCheck>();
const dupSignals = new Map<string, DupSignal>();
const evidence = new Map<string, EvidenceItem>();
const adverseActions = new Map<string, AdverseAction>();
const appeals = new Map<string, Appeal>();
const notifications = new Map<string, Notification>();
const idem = new Map<string, { status: number; body: unknown }>();
let seq = 0;
const nid = (p: string) => `${p}_${(++seq).toString(36).padStart(8, '0')}`;
const now = () => new Date().toISOString();

function subjectOf(req: express.Request): Subject {
  const auth = authUserOf(req);
  if (auth) return { role: auth.user.role as SpecRole, tenant_id: auth.user.tenant_id, user_id: auth.user.user_id };
  const demoHeader = String(req.headers['x-nahashield-demo-role'] ?? '');
  const role = (DEMO_ROLE_MAP[demoHeader] ?? demoHeader) as SpecRole;
  return { role: KNOWN_ROLES.includes(role) ? role : 'claims_manager', tenant_id: String(req.headers['x-tenant-id'] ?? 'ten_demo'), user_id: 'usr_demo' };
}

export function workspaceApiRoutes(): express.Router {
  const r = express.Router();

  r.use((req, res, next) => {
    res.setHeader('x-request-id', String(req.headers['x-request-id'] ?? `req_${randomUUID()}`));
    next();
  });
  r.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const key = String(req.headers['idempotency-key'] ?? '');
    if (!key) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Mutating calls need an Idempotency-Key header so a retry never repeats an action.', request_id: res.getHeader('x-request-id') } });
    const scoped = `${req.method} ${req.path} ${key}`;
    const seen = idem.get(scoped);
    if (seen) return res.status(seen.status).json(seen.body);
    const json = res.json.bind(res);
    res.json = ((body: unknown) => { idem.set(scoped, { status: res.statusCode, body }); return json(body); }) as typeof res.json;
    next();
  });

  const err = (res: express.Response, status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, details, request_id: res.getHeader('x-request-id') } });

  const authorize = (req: express.Request, res: express.Response, capabilities: Capability[], object?: { tenant_id: string }): (Subject & { access: Access }) | null => {
    const s = subjectOf(req);
    const best = capabilities.reduce<Access>((a, c) => {
      const order: Access[] = ['no', 'summary', 'limited', 'yes'];
      const cur = accessOf(s.role, c);
      return order.indexOf(cur) > order.indexOf(a) ? cur : a;
    }, 'no');
    if (best === 'no') { err(res, 403, 'FORBIDDEN', 'Your role does not have permission for this action.'); return null; }
    if (object && !canAccessObject(s.role, capabilities[0], object, s)) { err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.'); return null; }
    return { ...s, access: best };
  };

  const publicClaim = (c: Claim) => ({
    claim_id: c.claim_id, policy_id: c.policy_id, tenant_id: c.tenant_id, claim_type: c.claim_type, status: c.status,
    amount_claimed_cents: c.amount_claimed_cents, amount_approved_cents: c.amount_approved_cents, amount_paid_cents: c.amount_paid_cents,
    fraud_risk_score: c.fraud_risk_score, duplicate_risk_score: c.duplicate_risk_score, evidence_strength_score: c.evidence_strength_score,
    clock_status: c.clock_status, clock_due_at: c.clock_due_at, owner_id: c.owner_id ?? null, agent_id: c.agent_id ?? null,
    indicators: c.indicators, documents: c.documents.map((d) => ({ ...d, storage_reference: undefined })), notes_count: c.notes.length,
    next_action: c.indicators.some((i) => i.status === 'open') ? 'review_duplicate_signal' : null,
    automatic_adverse_action: false, appeal_available: true,
    submitted_at: c.submitted_at, created_at: c.created_at, decided_at: c.decided_at ?? null,
  });

  // ---- 2. Claims API ----

  // 2.1 Create claim
  r.post('/claims', (req, res) => {
    const s = authorize(req, res, ['submit_claim', 'escalate_claim']); if (!s) return;
    const b = req.body ?? {};
    if (!b.policy_id || !b.claim_type || typeof b.amount_claimed_cents !== 'number' || b.amount_claimed_cents <= 0) {
      return err(res, 400, 'VALIDATION_ERROR', 'One or more fields are invalid.', [{ field: 'amount_claimed_cents', issue: 'must_be_positive_integer' }]);
    }
    const created = now();
    const due = new Date(Date.parse(created) + 4 * 24 * 3600 * 1000).toISOString();
    const c: Claim = {
      claim_id: nid('clm'), tenant_id: s.tenant_id, policy_id: String(b.policy_id), claim_type: String(b.claim_type), status: 'received',
      deceased_person_id: b.deceased_person_id, claimant_person_id: b.claimant_person_id, date_of_death: b.date_of_death,
      amount_claimed_cents: b.amount_claimed_cents, amount_approved_cents: 0, amount_paid_cents: 0,
      channel: b.channel, agent_id: b.agent_id,
      fraud_risk_score: null, duplicate_risk_score: null, evidence_strength_score: null,
      clock_status: 'running', clock_due_at: due,
      documents: ((b.documents ?? []) as { document_type: string; storage_reference?: string; sha256_hash?: string }[]).map((d) => ({ document_id: nid('doc'), ...d })),
      notes: [], indicators: [], evidence_links: [], consent_ids: b.consent_id ? [String(b.consent_id)] : [],
      submitted_at: created, created_at: created,
    };
    claims.set(c.claim_id, c);
    res.status(201).json(publicClaim(c));
  });

  // 2.3 List claims (filter in the store, not after loading)
  r.get('/claims', (req, res) => {
    const s = authorize(req, res, ['view_own_claim']); if (!s) return;
    const q = req.query;
    let items = [...claims.values()].filter((c) => c.tenant_id === s.tenant_id);
    if (q.status) items = items.filter((c) => c.status === q.status);
    if (q.clock_status) items = items.filter((c) => c.clock_status === q.clock_status);
    if (q.owner_id) items = items.filter((c) => c.owner_id === q.owner_id);
    if (q.agent_id) items = items.filter((c) => c.agent_id === q.agent_id);
    if (q.risk_level) items = items.filter((c) => (c.duplicate_risk_score ?? 0) >= (q.risk_level === 'high' ? 85 : q.risk_level === 'medium' ? 70 : 0) && (q.risk_level === 'low' ? (c.duplicate_risk_score ?? 0) < 70 : true));
    if (q.min_amount_cents) items = items.filter((c) => c.amount_claimed_cents >= Number(q.min_amount_cents));
    if (q.max_amount_cents) items = items.filter((c) => c.amount_claimed_cents <= Number(q.max_amount_cents));
    if (q.submitted_from) items = items.filter((c) => c.submitted_at >= String(q.submitted_from));
    if (q.submitted_to) items = items.filter((c) => c.submitted_at <= String(q.submitted_to) + 'T23:59:59Z');
    const sort = String(q.sort ?? 'submitted_at');
    const dir = q.order === 'asc' ? 1 : -1;
    items.sort((a, b) => dir * String((a as unknown as Record<string, unknown>)[sort] ?? '').localeCompare(String((b as unknown as Record<string, unknown>)[sort] ?? '')));
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25)));
    const total = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    res.json({ items: items.map(publicClaim), page, page_size: pageSize, total_count: total });
  });

  const getClaim = (req: express.Request, res: express.Response, caps: Capability[]): { c: Claim; s: Subject & { access: Access } } | null => {
    const c = claims.get(String(req.params.claimId ?? req.params.id));
    if (!c) { err(res, 404, 'NOT_FOUND', 'Claim not found.'); return null; }
    const s = authorize(req, res, caps, c);
    return s ? { c, s } : null;
  };

  // 2.2 Get claim
  r.get('/claims/:claimId', (req, res) => {
    const got = getClaim(req, res, ['view_own_claim']); if (!got) return;
    res.json(publicClaim(got.c));
  });

  // 2.4 Assign claim
  r.post('/claims/:claimId/assignment', (req, res) => {
    const got = getClaim(req, res, ['escalate_claim']); if (!got) return;
    const { c } = got;
    const b = req.body ?? {};
    if (!b.assignee_id) return err(res, 400, 'VALIDATION_ERROR', 'assignee_id is required.', [{ field: 'assignee_id', issue: 'required' }]);
    c.owner_id = String(b.assignee_id);
    c.notes.push({ note_id: nid('nte'), note_type: 'assignment', content: `Assigned: ${String(b.assignment_reason ?? 'review')}`, visibility: 'internal', author_id: got.s.user_id, created_at: now() });
    res.json(publicClaim(c));
  });

  // 2.5 Add claim note
  r.post('/claims/:claimId/notes', (req, res) => {
    const got = getClaim(req, res, ['raise_indicator', 'view_claim_indicators']); if (!got) return;
    const { c, s } = got;
    const b = req.body ?? {};
    if (!b.note_type || !b.content) return err(res, 400, 'VALIDATION_ERROR', 'note_type and content are required.');
    const n = { note_id: nid('nte'), note_type: String(b.note_type), content: String(b.content), visibility: String(b.visibility ?? 'internal'), author_id: s.user_id, created_at: now() };
    c.notes.push(n);
    res.status(201).json(n);
  });

  // 2.6 Add claim document
  r.post('/claims/:claimId/documents', (req, res) => {
    const got = getClaim(req, res, ['upload_claim_document']); if (!got) return;
    const { c } = got;
    const b = req.body ?? {};
    if (!b.document_type) return err(res, 400, 'VALIDATION_ERROR', 'document_type is required.');
    const d = { document_id: nid('doc'), document_type: String(b.document_type), storage_reference: b.storage_reference, sha256_hash: b.sha256_hash, uploaded_by: b.uploaded_by };
    c.documents.push(d);
    res.status(201).json(d);
  });

  const factsOf = (c: Claim): ClaimFacts => ({
    tenant_id: c.tenant_id, claim_id: c.claim_id, policy_id: c.policy_id,
    insured_person: c.deceased_person_id ? { id_number_hash: c.deceased_person_id } : undefined,
    claimant: c.claimant_person_id ? { id_number_hash: c.claimant_person_id } : undefined,
    agent_id: c.agent_id,
    document: c.documents.find((d) => d.sha256_hash) ? { sha256_hash: c.documents.find((d) => d.sha256_hash)!.sha256_hash } : undefined,
    consent_id: c.consent_ids[0],
    claim_submitted_at: c.submitted_at,
  });

  // 2.7 Run claim checks (synthetic checks; duplicate uses the real engine)
  r.post('/claims/:claimId/checks', (req, res) => {
    const got = getClaim(req, res, ['view_claim_indicators']); if (!got) return;
    const { c } = got;
    const wanted: string[] = (req.body?.checks ?? ['identity', 'death', 'beneficiary', 'duplicate', 'fraud', 'documents', 'clock']) as string[];
    const results = wanted.map((check) => {
      if (check === 'duplicate') {
        const others = [...claims.values()].filter((o) => o.tenant_id === c.tenant_id && o.claim_id !== c.claim_id).map(factsOf);
        const result = runDuplicateCheck(factsOf(c), others, { require_consent: false });
        c.duplicate_risk_score = result.duplicate_risk_score;
        if (result.duplicate_risk_score >= 70) {
          const sig: DupSignal = { duplicate_signal_id: nid('dup'), tenant_id: c.tenant_id, claim_id: c.claim_id, duplicate_check_id: result.check_id, match_type: result.matches[0]?.match_type ?? 'unknown', match_confidence: result.matches[0]?.match_confidence ?? 0, recommended_action: result.recommended_action, status: 'open' };
          dupSignals.set(sig.duplicate_signal_id, sig);
          c.indicators.push({ indicator_id: nid('ind'), rule_id: 'DUP-01', severity: result.risk_level, status: 'open', summary: 'A possible duplicate signal needs human review. No action has been taken on the claim.' });
          return { check_type: check, status: 'failed', result: 'duplicate_claim_detected', duplicate_signal_id: sig.duplicate_signal_id };
        }
        return { check_type: check, status: 'passed', result: 'no_duplicate_found' };
      }
      if (check === 'documents') return { check_type: check, status: c.documents.length > 0 ? 'passed' : 'failed', result: c.documents.length > 0 ? 'documents_present' : 'documents_missing' };
      if (check === 'clock') return { check_type: check, status: 'passed', result: c.clock_status };
      // identity, death, beneficiary, fraud: synthetic stand-ins until real integrations exist.
      return { check_type: check, status: 'passed', result: 'synthetic_pass' };
    });
    res.json({ claim_id: c.claim_id, checks: results, synthetic: true, automatic_adverse_action: false });
  });

  // 2.8 Claim decision (human decision only; evidence-based)
  r.post('/claims/:claimId/decision', (req, res) => {
    const got = getClaim(req, res, ['decline_claim', 'reduce_claim', 'approve_hold']); if (!got) return;
    const { c } = got;
    const b = req.body ?? {};
    if (!b.decision || !b.approver_id || !b.reason_code) return err(res, 400, 'VALIDATION_ERROR', 'decision, reason_code and approver_id are required.');
    if (!['approve', 'decline', 'reduce'].includes(b.decision)) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'decision must be approve, decline or reduce.');
    if (b.decision === 'approve') { c.status = 'approved'; c.amount_approved_cents = Number(b.amount_approved_cents ?? c.amount_claimed_cents); }
    if (b.decision === 'decline') c.status = 'declined';
    if (b.decision === 'reduce') { c.status = 'approved'; c.amount_approved_cents = Number(b.amount_approved_cents ?? 0); }
    c.decided_at = now();
    c.notes.push({ note_id: nid('nte'), note_type: 'decision', content: `${b.decision}: ${String(b.reason_text ?? b.reason_code)}`, visibility: 'internal', author_id: String(b.approver_id), created_at: now() });
    res.json({ ...publicClaim(c), appeal_available: true });
  });

  // 2.9 Claim payment instruction (records an instruction; no money moves here)
  r.post('/claims/:claimId/payment-instruction', (req, res) => {
    const got = getClaim(req, res, ['record_recovery_payment', 'confirm_saving']); if (!got) return;
    const { c } = got;
    const b = req.body ?? {};
    if (!b.beneficiary_id || typeof b.amount_cents !== 'number' || !b.approved_by) return err(res, 400, 'VALIDATION_ERROR', 'beneficiary_id, amount_cents and approved_by are required.');
    if (c.status !== 'approved') return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'Only an approved claim can receive a payment instruction.');
    if (b.amount_cents > c.amount_approved_cents) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'Payment cannot exceed the approved amount.');
    c.payment_instruction = { payment_id: nid('payi'), beneficiary_id: b.beneficiary_id, amount_cents: b.amount_cents, payment_method: b.payment_method ?? 'eft', approved_by: b.approved_by, instructed_at: now(), status: 'instructed_not_dispatched' };
    res.status(201).json(c.payment_instruction);
  });

  // ---- 3. Duplicate detection API ----

  // 3.1 Run duplicate check (real engine; consent and validation from TC-DUP-027/028)
  r.post('/duplicate-checks', (req, res) => {
    const s = authorize(req, res, ['view_claim_indicators']); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id) return err(res, 400, 'VALIDATION_ERROR', 'claim_id is required.');
    const c = claims.get(String(b.claim_id));
    if (!c) return err(res, 404, 'NOT_FOUND', 'Claim not found.');
    if (c.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const scope: string[] = b.check_scope ?? ['same_deceased', 'same_claimant', 'same_beneficiary', 'same_bank_account', 'same_phone', 'same_device', 'same_address', 'same_agent', 'same_provider', 'same_document'];
    // TC-DUP-031: a repeat submission returns the existing check (202), one job only.
    const existing = [...dupChecks.values()].find((d) => d.tenant_id === s.tenant_id && d.claim_id === c.claim_id && JSON.stringify(d.check_scope) === JSON.stringify(scope));
    if (existing) return res.status(202).json({ duplicate_check_id: existing.duplicate_check_id, status: existing.status, idempotent: true });
    const facts = factsOf(c);
    if (b.consent_id && !c.consent_ids.includes(String(b.consent_id))) c.consent_ids.push(String(b.consent_id));
    facts.consent_id = b.consent_id ?? c.consent_ids[0];
    const others = [...claims.values()].filter((o) => o.tenant_id === c.tenant_id && o.claim_id !== c.claim_id).map(factsOf);
    const result = runDuplicateCheck(facts, others, { require_consent: true, requesting_tenant: s.tenant_id });
    if (result.error) return err(res, result.error.status, result.error.code, result.error.code === 'CONSENT_REQUIRED' ? 'Consent is required before a duplicate check can run.' : 'The claim data is not valid for a duplicate check.', result.error.field ? [{ field: result.error.field, issue: result.error.code }] : undefined);
    const d: DupCheck = { duplicate_check_id: nid('dupchk'), tenant_id: s.tenant_id, claim_id: c.claim_id, check_scope: scope, status: 'completed', result, created_at: now() };
    dupChecks.set(d.duplicate_check_id, d);
    for (const m of result.matches) {
      const sig: DupSignal = { duplicate_signal_id: nid('dup'), tenant_id: s.tenant_id, claim_id: c.claim_id, duplicate_check_id: d.duplicate_check_id, match_type: m.match_type, match_confidence: m.match_confidence, recommended_action: m.recommended_action, status: 'open' };
      dupSignals.set(sig.duplicate_signal_id, sig);
    }
    c.duplicate_risk_score = result.duplicate_risk_score;
    res.status(201).json({
      duplicate_check_id: d.duplicate_check_id, claim_id: c.claim_id,
      duplicate_risk_score: result.duplicate_risk_score, risk_level: result.risk_level,
      matches: result.matches.map((m) => ({ match_type: m.match_type, matched_claim_id: m.matched_claim_id ?? null, match_confidence: m.match_confidence, matched_fields: m.matched_fields, recommended_action: m.recommended_action })),
      innocent_explanations: result.innocent_explanations, human_review_required: result.human_review_required,
      automatic_adverse_action: false, accusation_wording: false, appeal_available: true,
    });
  });

  // 3.2 Get duplicate check
  r.get('/duplicate-checks/:id', (req, res) => {
    const s = authorize(req, res, ['view_claim_indicators']); if (!s) return;
    const d = dupChecks.get(String(req.params.id));
    if (!d) return err(res, 404, 'NOT_FOUND', 'Duplicate check not found.');
    if (d.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    res.json({ duplicate_check_id: d.duplicate_check_id, claim_id: d.claim_id, check_scope: d.check_scope, status: d.status, created_at: d.created_at, result: d.result ?? null, signals: [...dupSignals.values()].filter((x) => x.duplicate_check_id === d.duplicate_check_id) });
  });

  // 3.3 Resolve duplicate signal (human resolution with reason)
  r.post('/duplicate-signals/:id/resolution', (req, res) => {
    const s = authorize(req, res, ['raise_indicator', 'view_claim_indicators']); if (!s) return;
    const sig = dupSignals.get(String(req.params.id));
    if (!sig) return err(res, 404, 'NOT_FOUND', 'Duplicate signal not found.');
    if (sig.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const b = req.body ?? {};
    if (!b.resolution || !b.reason || !b.reviewer_id) return err(res, 400, 'VALIDATION_ERROR', 'resolution, reason and reviewer_id are required.');
    if (!['false_positive', 'confirmed_duplicate', 'legitimate_link'].includes(b.resolution)) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'resolution must be false_positive, confirmed_duplicate or legitimate_link.');
    sig.status = 'resolved';
    sig.resolution = { resolution: String(b.resolution), reason: String(b.reason), reviewer_id: String(b.reviewer_id), at: now() };
    res.json(sig);
  });

  // ---- 4. Evidence API ----

  // 4.1 Add evidence
  r.post('/evidence', (req, res) => {
    const s = authorize(req, res, ['upload_claim_document', 'raise_indicator']); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id || !b.evidence_type || !b.source) return err(res, 400, 'VALIDATION_ERROR', 'claim_id, evidence_type and source are required.');
    const c = claims.get(String(b.claim_id));
    if (!c) return err(res, 404, 'NOT_FOUND', 'Claim not found.');
    if (c.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const e: EvidenceItem = { evidence_id: nid('evd'), tenant_id: s.tenant_id, claim_id: c.claim_id, evidence_type: String(b.evidence_type), source: String(b.source), document_id: b.document_id, description: b.description, evidence_class: b.evidence_class, hash: b.hash, created_at: now() };
    evidence.set(e.evidence_id, e);
    res.status(201).json(e);
  });

  // 4.2 Get evidence (executives get a summary, never raw evidence)
  r.get('/evidence/:id', (req, res) => {
    const s = authorize(req, res, ['view_evidence']); if (!s) return;
    const e = evidence.get(String(req.params.id));
    if (!e) return err(res, 404, 'NOT_FOUND', 'Evidence not found.');
    if (e.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    if (s.access === 'summary') return res.json({ evidence_id: e.evidence_id, claim_id: e.claim_id, evidence_type: e.evidence_type, evidence_class: e.evidence_class ?? null, created_at: e.created_at, summary_only: true });
    res.json(e);
  });

  // 4.3 Link evidence to claim
  r.post('/claims/:claimId/evidence-links', (req, res) => {
    const got = getClaim(req, res, ['raise_indicator', 'upload_claim_document']); if (!got) return;
    const { c } = got;
    const b = req.body ?? {};
    if (!b.evidence_id || !b.link_type) return err(res, 400, 'VALIDATION_ERROR', 'evidence_id and link_type are required.');
    const e = evidence.get(String(b.evidence_id));
    if (!e || e.tenant_id !== c.tenant_id) return err(res, 404, 'NOT_FOUND', 'Evidence not found.');
    const link = { evidence_id: e.evidence_id, link_type: String(b.link_type), indicator_id: b.indicator_id };
    c.evidence_links.push(link);
    res.status(201).json(link);
  });

  // 4.4 Calculate evidence strength (deterministic, explainable)
  r.post('/evidence/:id/strength', (req, res) => {
    const s = authorize(req, res, ['view_evidence']); if (!s) return;
    const e = evidence.get(String(req.params.id));
    if (!e) return err(res, 404, 'NOT_FOUND', 'Evidence not found.');
    if (e.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const sourceReliability = ({ insurer_finance: 90, home_affairs: 95, bank: 90, claimant: 50, agent: 60, insurer: 80 } as Record<string, number>)[e.source] ?? 50;
    const linkedClaim = claims.get(e.claim_id);
    const corroboration = Math.min(100, 40 + 20 * (linkedClaim?.evidence_links.filter((l) => l.evidence_id === e.evidence_id).length ?? 0) + (linkedClaim?.documents.length ?? 0) * 5);
    const provenance = e.hash ? 85 : 40;
    const ageDays = (Date.now() - Date.parse(e.created_at)) / 86_400_000;
    const recency = Math.max(20, Math.round(100 - ageDays * 2));
    const score = Math.round(sourceReliability * 0.35 + corroboration * 0.25 + provenance * 0.2 + recency * 0.2);
    const label = score >= 70 ? 'strong' : score >= 40 ? 'moderate' : 'weak';
    e.strength = { evidence_id: e.evidence_id, evidence_strength_score: score, source_reliability: sourceReliability, corroboration, provenance, recency, label };
    if (linkedClaim) linkedClaim.evidence_strength_score = score;
    res.json(e.strength);
  });

  // ---- 5. Adverse-action API (approval-gated; appeal always available) ----

  // 5.1 Create adverse action (proposal only, never automatic)
  r.post('/adverse-actions', (req, res) => {
    const s = authorize(req, res, ['hold_claim', 'raise_indicator']); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id || !b.action_type || !b.reason_code || !b.reason_text || !b.proposed_by) return err(res, 400, 'VALIDATION_ERROR', 'claim_id, action_type, reason_code, reason_text and proposed_by are required.');
    const c = claims.get(String(b.claim_id));
    if (!c) return err(res, 404, 'NOT_FOUND', 'Claim not found.');
    if (c.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const a: AdverseAction = { adverse_action_id: nid('adv'), tenant_id: s.tenant_id, claim_id: c.claim_id, action_type: String(b.action_type), reason_code: String(b.reason_code), reason_text: String(b.reason_text), evidence_ids: b.evidence_ids ?? [], proposed_by: String(b.proposed_by), status: 'proposed', expires_at: b.expires_at, automatic: false, appeal_available: true, created_at: now() };
    adverseActions.set(a.adverse_action_id, a);
    res.status(201).json({ ...a, human_approval_required: true });
  });

  // 5.2 Approve adverse action (only approvers; claim changes state only now)
  r.post('/adverse-actions/:id/approval', (req, res) => {
    const s = authorize(req, res, ['approve_hold', 'decline_claim']); if (!s) return;
    const a = adverseActions.get(String(req.params.id));
    if (!a) return err(res, 404, 'NOT_FOUND', 'Adverse action not found.');
    if (a.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const b = req.body ?? {};
    if (!b.decision || !b.approver_id) return err(res, 400, 'VALIDATION_ERROR', 'decision and approver_id are required.');
    if (a.proposed_by === String(b.approver_id)) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'The proposer cannot approve their own adverse action.');
    a.approval = { decision: String(b.decision), approver_id: String(b.approver_id), reason: b.reason, at: now() };
    a.status = b.decision === 'approve' ? 'active' : 'rejected';
    const c = claims.get(a.claim_id);
    if (c && a.status === 'active' && a.action_type === 'hold') c.status = 'on_hold';
    res.json({ ...a, appeal_available: true });
  });

  // 5.3 Create appeal (always available to claimant side)
  r.post('/appeals', (req, res) => {
    const s = authorize(req, res, ['submit_claim', 'view_own_claim']); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id || !b.adverse_action_id || !b.claimant_id || !b.appeal_reason) return err(res, 400, 'VALIDATION_ERROR', 'claim_id, adverse_action_id, claimant_id and appeal_reason are required.');
    const a = adverseActions.get(String(b.adverse_action_id));
    if (!a) return err(res, 404, 'NOT_FOUND', 'Adverse action not found.');
    if (a.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const ap: Appeal = { appeal_id: nid('apl'), tenant_id: s.tenant_id, claim_id: String(b.claim_id), adverse_action_id: a.adverse_action_id, claimant_id: String(b.claimant_id), appeal_reason: String(b.appeal_reason), status: 'received', created_at: now() };
    appeals.set(ap.appeal_id, ap);
    res.status(201).json(ap);
  });

  // 5.4 Decide appeal (a separate reviewer; overturning reverses the action)
  r.post('/appeals/:id/decision', (req, res) => {
    const s = authorize(req, res, ['decline_claim', 'approve_hold']); if (!s) return;
    const ap = appeals.get(String(req.params.id));
    if (!ap) return err(res, 404, 'NOT_FOUND', 'Appeal not found.');
    if (ap.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const b = req.body ?? {};
    if (!b.outcome || !b.reviewer_id) return err(res, 400, 'VALIDATION_ERROR', 'outcome and reviewer_id are required.');
    if (!['overturned', 'upheld'].includes(b.outcome)) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'outcome must be overturned or upheld.');
    const a = adverseActions.get(ap.adverse_action_id);
    if (a?.approval?.approver_id === String(b.reviewer_id)) return err(res, 422, 'BUSINESS_RULE_VIOLATION', 'The appeal reviewer must be different from the original approver.');
    ap.status = b.outcome;
    ap.decision = { outcome: String(b.outcome), reviewer_id: String(b.reviewer_id), outcome_reason: b.outcome_reason, at: now() };
    if (b.outcome === 'overturned' && a) {
      a.status = 'reversed';
      const c = claims.get(a.claim_id);
      if (c && c.status === 'on_hold') c.status = 'under_review';
    }
    res.json(ap);
  });

  // ---- 6. Notification API: DRAFTS ONLY. The app never sends SMS or email. ----

  // 6.1 Create a notification draft (template rendering; sending is disabled by design)
  r.post('/notifications', (req, res) => {
    const s = authorize(req, res, ['request_documents', 'raise_indicator']); if (!s) return;
    const b = req.body ?? {};
    if (!b.claim_id || !b.recipient_id || !b.channel || !b.template_id) return err(res, 400, 'VALIDATION_ERROR', 'claim_id, recipient_id, channel and template_id are required.');
    if (!MESSAGE_TEMPLATES.some((t) => t.id === b.template_id)) return err(res, 400, 'VALIDATION_ERROR', 'Unknown template_id.');
    const c = claims.get(String(b.claim_id));
    if (!c) return err(res, 404, 'NOT_FOUND', 'Claim not found.');
    if (c.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    const vars: TemplateVars = { ...(b.variables ?? {}) } as TemplateVars;
    if (!vars.insurer_name) return err(res, 400, 'VALIDATION_ERROR', 'variables.insurer_name is required. The insurer name is always a variable, never hardcoded.');
    const draft = renderDraft(b.template_id as TemplateId, vars);
    const warnings = wordingProblems(draft.body);
    const n: Notification = {
      notification_id: nid('ntf'), tenant_id: s.tenant_id, claim_id: c.claim_id, recipient_id: String(b.recipient_id),
      channel: String(b.channel), template_id: String(b.template_id), language: String(b.language ?? 'en'),
      status: warnings.length ? 'draft_needs_rewording' : draft.status,
      rendered_body: draft.body, wording_warnings: warnings, approved_by: b.approved_by,
      send_disabled: true, created_at: now(),
    };
    notifications.set(n.notification_id, n);
    res.status(201).json({ ...n, message: 'Draft only. NahaShield never sends SMS or email to claimants; a person sends approved wording from the insurer\'s own systems.' });
  });

  // 6.2 Get notification status
  r.get('/notifications/:id', (req, res) => {
    const s = authorize(req, res, ['request_documents', 'raise_indicator', 'view_claim_indicators']); if (!s) return;
    const n = notifications.get(String(req.params.id));
    if (!n) return err(res, 404, 'NOT_FOUND', 'Notification not found.');
    if (n.tenant_id !== s.tenant_id) return err(res, 403, 'TENANT_ACCESS_DENIED', 'This record belongs to another organisation.');
    res.json(n);
  });

  return r;
}

export function resetWorkspaceStore() {
  claims.clear(); dupChecks.clear(); dupSignals.clear(); evidence.clear();
  adverseActions.clear(); appeals.clear(); notifications.clear(); idem.clear(); seq = 0;
}
// Exported for the duplicate-checks tests that seed claims directly.
export const workspaceStore = { claims, dupSignals, dupChecks };
