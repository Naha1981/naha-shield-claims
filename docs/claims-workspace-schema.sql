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
