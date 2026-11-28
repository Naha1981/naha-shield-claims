-- NahaShield insurer-ready claims workspace schema (PostgreSQL).
-- From Thabiso's implementation specs, 2026-11-28 (PRD v1.2 sections 26-30,
-- merged from both messages; no table appears twice).
-- Design principles:
--   * PostgreSQL is the system of record.
--   * All money is stored as integer cents.
--   * Every table carries tenant_id.
--   * Every sensitive action is audit-logged.
--   * Every adverse action stores approver, reason, evidence, and appeal rights.
--   * No raw ID numbers, banking details, or biometric templates in plaintext.

-- 2.1 Tenants and users

CREATE TABLE tenants (
  tenant_id UUID PRIMARY KEY,
  tenant_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  email_hash TEXT NOT NULL,
  full_name_encrypted TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_role_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL,
  granted_by UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- 2.1a Policies, persons, beneficiaries (core reference data)

CREATE TABLE policies (
  policy_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  policy_number TEXT NOT NULL,
  insurer_id UUID NOT NULL,
  broker_id UUID,
  agent_id UUID,
  policyholder_id UUID NOT NULL,
  status TEXT NOT NULL,
  cover_amount_cents BIGINT NOT NULL,
  premium_amount_cents BIGINT NOT NULL,
  issued_at TIMESTAMPTZ,
  lapsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  person_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  id_number_hash TEXT NOT NULL,
  full_name_encrypted TEXT,
  date_of_birth DATE,
  phone_hash TEXT,
  email_hash TEXT,
  address_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE beneficiaries (
  beneficiary_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  policy_id UUID NOT NULL REFERENCES policies(policy_id),
  person_id UUID NOT NULL REFERENCES persons(person_id),
  relationship TEXT NOT NULL,
  share_percentage NUMERIC(5,2),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 Claims workspace


CREATE TABLE claims (
  claim_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  policy_id UUID NOT NULL REFERENCES policies(policy_id),
  claim_number TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL,
  deceased_person_id UUID REFERENCES persons(person_id),
  claimant_person_id UUID REFERENCES persons(person_id),
  agent_id UUID,
  amount_claimed_cents BIGINT NOT NULL DEFAULT 0,
  amount_approved_cents BIGINT NOT NULL DEFAULT 0,
  amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  amount_reduced_cents BIGINT NOT NULL DEFAULT 0,
  amount_recovered_cents BIGINT NOT NULL DEFAULT 0,
  fraud_risk_score NUMERIC(5,2),
  duplicate_risk_score NUMERIC(5,2),
  evidence_strength_score NUMERIC(5,2),
  clock_status TEXT,
  clock_due_at TIMESTAMPTZ,
  owner_id UUID,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claim_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claim_documents (
  document_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  document_type TEXT NOT NULL,
  storage_reference TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  perceptual_hash TEXT,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status TEXT,
  verification_result JSONB
);

CREATE TABLE claim_indicators (
  indicator_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  severity TEXT NOT NULL,
  risk_score NUMERIC(5,2),
  status TEXT NOT NULL,
  evidence_ids UUID[],
  innocent_explanations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);

CREATE TABLE claim_notes (
  note_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  author_id UUID NOT NULL,
  note_type TEXT NOT NULL,
  content_encrypted TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3 Adverse actions and appeals

CREATE TABLE adverse_actions (
  adverse_action_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  action_type TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  status TEXT NOT NULL,
  proposed_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  evidence_ids UUID[],
  claimant_notified BOOLEAN DEFAULT false,
  appeal_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  appeal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  adverse_action_id UUID NOT NULL REFERENCES adverse_actions(adverse_action_id),
  claimant_id UUID NOT NULL,
  appeal_reason TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewer_id UUID,
  reviewer_role TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_reason TEXT,
  evidence_ids UUID[]
);

CREATE TABLE claimant_notifications (
  notification_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  recipient_id UUID NOT NULL,
  channel TEXT NOT NULL,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  approved_by UUID,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 Recovery schema

CREATE TABLE recovery_cases (
  recovery_case_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  status TEXT NOT NULL,
  route TEXT,
  amount_paid_cents BIGINT NOT NULL,
  amount_recovered_cents BIGINT NOT NULL DEFAULT 0,
  amount_written_off_cents BIGINT NOT NULL DEFAULT 0,
  estimated_recovery_cents BIGINT,
  estimated_cost_cents BIGINT,
  net_realisable_value_cents BIGINT,
  probability_of_recovery NUMERIC(5,4),
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_actions (
  recovery_action_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  action_type TEXT NOT NULL,
  recipient_type TEXT,
  recipient_id UUID,
  channel TEXT,
  template_id TEXT,
  status TEXT NOT NULL,
  approval_required BOOLEAN DEFAULT true,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_payments (
  recovery_payment_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  payment_reference TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  bank_statement_id UUID,
  reconciliation_status TEXT NOT NULL,
  reconciled_by UUID,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_valuations (
  valuation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recovery_case_id UUID NOT NULL REFERENCES recovery_cases(recovery_case_id),
  asset_type TEXT,
  tenure_type TEXT,
  estimated_sale_proceeds_cents BIGINT,
  legal_costs_cents BIGINT,
  auction_costs_cents BIGINT,
  outstanding_bond_cents BIGINT,
  arrears_cents BIGINT,
  probability_of_recovery NUMERIC(5,4),
  net_realisable_value_cents BIGINT,
  recommended_route TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5 Duplicate detection schema

CREATE TABLE duplicate_checks (
  duplicate_check_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  check_scope JSONB NOT NULL,
  duplicate_risk_score NUMERIC(5,2),
  risk_level TEXT,
  status TEXT NOT NULL,
  consent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE duplicate_signals (
  duplicate_signal_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  duplicate_check_id UUID REFERENCES duplicate_checks(duplicate_check_id),
  rule_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_confidence NUMERIC(5,4),
  matched_entity_type TEXT NOT NULL,
  matched_entity_id UUID NOT NULL,
  related_claim_id UUID,
  related_policy_id UUID,
  evidence_ids UUID[],
  innocent_explanations JSONB,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);

CREATE TABLE duplicate_matches (
  duplicate_match_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_claim_id UUID NOT NULL,
  target_claim_id UUID,
  target_policy_id UUID,
  match_type TEXT NOT NULL,
  match_score NUMERIC(5,4),
  matched_fields JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.6 Evidence and audit

CREATE TABLE evidence_items (
  evidence_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  evidence_type TEXT NOT NULL,
  source TEXT NOT NULL,
  document_id UUID,
  description TEXT,
  evidence_class TEXT NOT NULL,
  evidence_strength_score NUMERIC(5,2),
  sha256_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence_links (
  evidence_link_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL REFERENCES claims(claim_id),
  evidence_id UUID NOT NULL REFERENCES evidence_items(evidence_id),
  link_type TEXT NOT NULL,
  indicator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.7 Indexes

CREATE INDEX idx_claims_tenant_status ON claims (tenant_id, status);
CREATE INDEX idx_claims_tenant_owner ON claims (tenant_id, owner_id);
CREATE INDEX idx_claims_tenant_clock ON claims (tenant_id, clock_status, clock_due_at);
CREATE INDEX idx_claims_tenant_amount ON claims (tenant_id, amount_claimed_cents DESC);
CREATE INDEX idx_claims_tenant_risk ON claims (tenant_id, fraud_risk_score DESC);
CREATE INDEX idx_claims_tenant_submitted ON claims (tenant_id, submitted_at DESC);

CREATE INDEX idx_duplicate_signals_tenant_claim ON duplicate_signals (tenant_id, claim_id);
CREATE INDEX idx_duplicate_signals_tenant_status ON duplicate_signals (tenant_id, status);
CREATE INDEX idx_duplicate_signals_tenant_rule ON duplicate_signals (tenant_id, rule_id);
CREATE INDEX idx_duplicate_signals_tenant_score ON duplicate_signals (tenant_id, match_confidence DESC);
CREATE INDEX idx_duplicate_matches_tenant_source ON duplicate_matches (tenant_id, source_claim_id);
CREATE INDEX idx_duplicate_matches_tenant_target ON duplicate_matches (tenant_id, target_claim_id);
CREATE INDEX idx_duplicate_matches_tenant_policy ON duplicate_matches (tenant_id, target_policy_id);

CREATE INDEX idx_evidence_tenant_claim ON evidence_items (tenant_id, claim_id);
CREATE INDEX idx_evidence_tenant_class ON evidence_items (tenant_id, evidence_class);
CREATE INDEX idx_evidence_tenant_strength ON evidence_items (tenant_id, evidence_strength_score DESC);

CREATE INDEX idx_adverse_actions_tenant_claim ON adverse_actions (tenant_id, claim_id);
CREATE INDEX idx_adverse_actions_tenant_status ON adverse_actions (tenant_id, status);
CREATE INDEX idx_adverse_actions_tenant_expiry ON adverse_actions (tenant_id, expires_at) WHERE status = 'active';
CREATE INDEX idx_appeals_tenant_claim ON appeals (tenant_id, claim_id);
CREATE INDEX idx_appeals_tenant_status ON appeals (tenant_id, status);
CREATE INDEX idx_appeals_tenant_submitted ON appeals (tenant_id, submitted_at DESC);

CREATE INDEX idx_audit_events_tenant_subject ON audit_events (tenant_id, subject_type, subject_id);
CREATE INDEX idx_audit_events_tenant_actor ON audit_events (tenant_id, actor_id, created_at DESC);
CREATE INDEX idx_audit_events_tenant_event ON audit_events (tenant_id, event_type, created_at DESC);

CREATE INDEX idx_claim_indicators_innocent ON claim_indicators USING GIN (innocent_explanations);
CREATE INDEX idx_duplicate_signals_innocent ON duplicate_signals USING GIN (innocent_explanations);
CREATE INDEX idx_claim_events_payload ON claim_events USING GIN (payload);

-- ---------------------------------------------------------------------------
-- Fuzzy-match query tuning (Thabiso's spec 5 section 2, adapted to this schema)
-- Applies when a real PostgreSQL database is introduced. The local demo engine
-- mirrors the trigram similarity in src/lib/engine/crossClaimMatching.ts.
-- Adaptation notes:
--   * persons.full_name is stored ENCRYPTED (full_name_encrypted), so trigram
--     indexes and similarity() run against a separate lowercase search column
--     (full_name_search) maintained at write time, never against plaintext.
--   * All candidate queries filter tenant_id first (tenant isolation + index use),
--     exact hashes before fuzzy, fuzzy candidates capped at 200, results at 50.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes (GIN)
CREATE INDEX idx_persons_full_name_search_trgm ON persons USING GIN (full_name_search gin_trgm_ops);
CREATE INDEX idx_persons_phone_hash_trgm ON persons USING GIN (phone_hash gin_trgm_ops);
CREATE INDEX idx_persons_email_hash_trgm ON persons USING GIN (email_hash gin_trgm_ops);
CREATE INDEX idx_persons_address_hash_trgm ON persons USING GIN (address_hash gin_trgm_ops);

-- Exact-match indexes
CREATE INDEX idx_persons_tenant_id_hash ON persons (tenant_id, id_number_hash);
CREATE INDEX idx_persons_tenant_phone_hash ON persons (tenant_id, phone_hash);
CREATE INDEX idx_persons_tenant_email_hash ON persons (tenant_id, email_hash);
CREATE INDEX idx_persons_tenant_address_hash ON persons (tenant_id, address_hash);
CREATE INDEX idx_claims_tenant_deceased ON claims (tenant_id, deceased_person_id);
CREATE INDEX idx_claims_tenant_claimant ON claims (tenant_id, claimant_person_id);
-- idx_duplicate_matches_tenant_source / _target already exist above.

-- Partial indexes: active claims and open signals only
CREATE INDEX idx_claims_active_tenant_deceased ON claims (tenant_id, deceased_person_id)
  WHERE status IN ('received', 'under_review', 'on_hold');
CREATE INDEX idx_claims_active_tenant_claimant ON claims (tenant_id, claimant_person_id)
  WHERE status IN ('received', 'under_review', 'on_hold');
CREATE INDEX idx_duplicate_signals_open_tenant ON duplicate_signals (tenant_id, rule_id, match_confidence DESC)
  WHERE status = 'open';

-- Candidate-query pattern: narrow by tenant + exact hashes first, then trigram.
-- WITH candidate_persons AS (
--   SELECT p.person_id, p.id_number_hash, p.date_of_birth,
--          similarity(p.full_name_search, lower($1)) AS name_similarity
--   FROM persons p
--   WHERE p.tenant_id = $2
--     AND (p.id_number_hash = $3 OR p.phone_hash = $4 OR p.address_hash = $5
--          OR p.full_name_search % lower($1))
--   ORDER BY name_similarity DESC, p.id_number_hash = $3 DESC,
--            p.phone_hash = $4 DESC, p.address_hash = $5 DESC
--   LIMIT 200
-- )
-- SELECT c.claim_id, cp.person_id AS candidate_person_id, cp.name_similarity,
--        CASE WHEN cp.id_number_hash = $3 THEN 1.00
--             WHEN cp.phone_hash = $4 THEN 0.80
--             WHEN cp.address_hash = $5 THEN 0.65
--             ELSE cp.name_similarity END AS match_score
-- FROM claims c JOIN candidate_persons cp ON cp.person_id = c.deceased_person_id
-- WHERE c.tenant_id = $2 AND c.claim_id <> $6
-- ORDER BY match_score DESC LIMIT 50;
-- Verify with EXPLAIN (ANALYZE, BUFFERS); never ILIKE '%term%' without the trigram index.
