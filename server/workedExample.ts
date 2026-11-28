// Worked-example seeder (Thabiso's worked-example order + spec 6).
// Loads the synthetic sample case into the real claims workspace so Lawrence
// can click through the actual system with no upload. Synthetic data only,
// clearly labelled sample. Idempotent: re-seeding replaces the sample claims.
// The duplicate check runs through the REAL engine (crossClaimMatching).

import express from 'express';
import { createHash } from 'node:crypto';
import { workspaceStore } from './workspaceApi';
import { runDuplicateCheck, type ClaimFacts } from '../src/lib/engine/crossClaimMatching';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
let seq = 0;
const nid = (p: string) => `${p}_ex${(++seq).toString(36).padStart(6, '0')}`;

const SAMPLE_POLICIES = ['POL-EX-421', 'POL-EX-887', 'POL-EX-880'];

type ClaimRow = Parameters<typeof workspaceStore.claims.set>[1];

function sampleClaims(tenant: string): ClaimRow[] {
  const t = now();
  const base = {
    tenant_id: tenant, claim_type: 'funeral', channel: 'worked_example',
    amount_approved_cents: 0, amount_paid_cents: 0,
    fraud_risk_score: null as number | null, duplicate_risk_score: null as number | null,
    evidence_strength_score: null as number | null,
    clock_status: 'within_sla', clock_due_at: t, documents: [], notes: [], indicators: [], evidence_links: [], consent_ids: [] as string[],
    created_at: t,
  };
  const note = (content: string) => ({ note_id: nid('nte'), note_type: 'sample_label', content, visibility: 'internal', author_id: 'worked_example', created_at: t });
  const doc = (type: string, seed: string) => ({ document_id: nid('doc'), document_type: type, storage_reference: 'sample://worked-example', sha256_hash: sha(seed), uploaded_by: 'worked_example' });

  const case1 = {
    ...base,
    claim_id: 'CLM-2026-00421', policy_id: 'POL-EX-421', status: 'paid',
    deceased_person_id: 'pex_deceased_421', claimant_person_id: 'pex_claimant_421',
    date_of_death: '2026-05-12', amount_claimed_cents: 2_500_000,
    amount_approved_cents: 2_500_000, amount_paid_cents: 2_500_000,
    agent_id: 'agent_118', owner_id: 'worked_example',
    fraud_risk_score: 8, duplicate_risk_score: 5, evidence_strength_score: 95,
    submitted_at: '2026-05-14T08:00:00.000Z', decided_at: '2026-05-15T15:00:00.000Z',
    documents: [doc('death_certificate', 'sample-death-cert-421'), doc('id_document', 'sample-id-421'), doc('bank_statement', 'sample-bank-421')],
    notes: [note('SAMPLE worked example. Fictional people. Cleared and paid in 1 business day.')],
    consent_ids: ['cns_ex421'],
  } as unknown as ClaimRow;

  const case2dup = {
    ...base,
    claim_id: 'CLM-2026-00880', policy_id: 'POL-EX-880', status: 'paid',
    deceased_person_id: 'pex_deceased_887', claimant_person_id: 'pex_claimant_880',
    date_of_death: '2026-06-03', amount_claimed_cents: 2_500_000,
    amount_approved_cents: 2_500_000, amount_paid_cents: 2_500_000,
    agent_id: 'agent_204', owner_id: 'worked_example',
    submitted_at: '2026-06-04T09:00:00.000Z', decided_at: '2026-06-06T15:00:00.000Z',
    documents: [doc('death_certificate', 'sample-death-cert-887')],
    notes: [note('SAMPLE worked example. The earlier claim on the same fictional deceased under a second policy.')],
    consent_ids: ['cns_ex880'],
  } as unknown as ClaimRow;

  const case2 = {
    ...base,
    claim_id: 'CLM-2026-00887', policy_id: 'POL-EX-887', status: 'held',
    deceased_person_id: 'pex_deceased_887', claimant_person_id: 'pex_claimant_887',
    date_of_death: '2026-06-03', amount_claimed_cents: 7_500_000,
    agent_id: 'agent_204', owner_id: 'worked_example',
    fraud_risk_score: 92, evidence_strength_score: 78,
    submitted_at: '2026-06-05T08:00:00.000Z',
    documents: [doc('death_certificate', 'sample-death-cert-887'), doc('claim_form', 'sample-form-887')],
    notes: [
      note('SAMPLE worked example. Fictional people. Policy 21 days old; cover raised R25,000 to R75,000 ten days before death; SIM swap 36h before bank change; consent incomplete. Indicator, not a finding of fraud.'),
    ],
    indicators: [
      { indicator_id: nid('ind'), rule_id: 'TIMING-01', severity: 'high', status: 'open', summary: 'Policy only 21 days old at date of death. Indicator, not a finding of fraud.' },
      { indicator_id: nid('ind'), rule_id: 'TIMING-02', severity: 'high', status: 'open', summary: 'Cover raised R25,000 to R75,000 ten days before death. Indicator, not a finding of fraud.' },
      { indicator_id: nid('ind'), rule_id: 'KYC-03', severity: 'medium', status: 'open', summary: 'SIM swap 36 hours before the bank detail change. Indicator, not a finding of fraud.' },
      { indicator_id: nid('ind'), rule_id: 'NET-04', severity: 'medium', status: 'open', summary: 'Bank account appears on 3 unrelated claims. Indicator, not a finding of fraud.' },
      { indicator_id: nid('ind'), rule_id: 'CONSENT-05', severity: 'medium', status: 'open', summary: 'Consent incomplete; must be fixed before checks can rely on personal data.' },
    ],
    consent_ids: [] as string[],
  } as unknown as ClaimRow;

  return [case1, case2dup, case2];
}

function factsOf(c: Record<string, unknown>): ClaimFacts {
  return {
    tenant_id: String(c.tenant_id), claim_id: String(c.claim_id), policy_id: String(c.policy_id ?? ''),
    insured_person: c.deceased_person_id ? { id_number_hash: String(c.deceased_person_id) } : undefined,
    claimant: c.claimant_person_id ? { id_number_hash: String(c.claimant_person_id) } : undefined,
    agent_id: c.agent_id ? String(c.agent_id) : undefined,
    claim_submitted_at: String(c.submitted_at ?? ''),
    consent_id: Array.isArray(c.consent_ids) ? (c.consent_ids[0] as string | undefined) : undefined,
  };
}

export function workedExampleRoutes(): express.Router {
  const r = express.Router();

  r.post('/seed', (req, res) => {
    const tenant = String(req.headers['x-tenant-id'] ?? 'ten_demo');
    // Idempotent re-seed: drop previous sample claims and their signals.
    for (const [id, c] of [...workspaceStore.claims.entries()]) {
      if (SAMPLE_POLICIES.includes(String((c as unknown as Record<string, unknown>).policy_id))) workspaceStore.claims.delete(id);
    }
    for (const [id, s] of [...workspaceStore.dupSignals.entries()]) {
      if (String(s.claim_id).startsWith('CLM-2026-004') || String(s.claim_id).startsWith('CLM-2026-008')) workspaceStore.dupSignals.delete(id);
    }
    const rows = sampleClaims(tenant);
    for (const c of rows) workspaceStore.claims.set(String((c as unknown as Record<string, unknown>).claim_id), c);

    // Real engine: duplicate check on CLM-2026-00887 against the seeded set.
    const target = rows.find((c) => String((c as unknown as Record<string, unknown>).claim_id) === 'CLM-2026-00887')!;
    const others = rows.filter((c) => c !== target).map((c) => factsOf(c as unknown as Record<string, unknown>));
    const result = runDuplicateCheck(factsOf(target as unknown as Record<string, unknown>), others, { require_consent: false, requesting_tenant: tenant });
    const t = now();
    if (result.duplicate_risk_score !== null) {
      (target as unknown as Record<string, unknown>).duplicate_risk_score = result.duplicate_risk_score;
      for (const m of result.matches) {
        workspaceStore.dupSignals.set(nid('dup'), {
          duplicate_signal_id: nid('dup'), tenant_id: tenant, claim_id: 'CLM-2026-00887',
          duplicate_check_id: result.check_id, match_type: m.match_type,
          match_confidence: m.match_confidence, recommended_action: m.recommended_action, status: 'open',
        } as never);
      }
    }

    res.status(201).json({
      seeded: true, sample: true, tenant_id: tenant,
      claims: ['CLM-2026-00421', 'CLM-2026-00880', 'CLM-2026-00887'],
      duplicate_check: {
        claim_id: 'CLM-2026-00887',
        duplicate_risk_score: result.duplicate_risk_score,
        risk_level: result.risk_level,
        matches: result.matches.map((m) => ({ match_type: m.match_type, matched_claim_id: m.matched_claim_id ?? null, match_confidence: m.match_confidence, recommended_action: m.recommended_action })),
        innocent_explanations: result.innocent_explanations,
        human_review_required: result.human_review_required,
      },
      checked_at: t,
    });
  });

  return r;
}

// Spec 7 API payloads: GET /worked-cases and /worked-cases/:caseId.
// Cents in the API, fictional sample data, insurer name a placeholder variable.
import { listPayload, detailPayload } from '../src/lib/demo/workedCases';

export function workedCasesRoutes(): express.Router {
  const r = express.Router();
  r.get('/worked-cases', (_req, res) => {
    res.json(listPayload());
  });
  r.get('/worked-cases/:caseId', (req, res) => {
    const payload = detailPayload(String(req.params.caseId));
    if (!payload) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Worked case not found.' } });
    res.json(payload);
  });
  return r;
}
