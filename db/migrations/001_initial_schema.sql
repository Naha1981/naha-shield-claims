-- NahaShield Initial PostgreSQL Schema v1.0
-- Enforces POPIA s71 (no auto-decisions), append-only hash-chained evidence vault,
-- mandatory evidence_tag, and single-tenant org_id isolation with RLS defence in depth.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Organisation & RBAC
CREATE TABLE IF NOT EXISTS org_config (
  org_id TEXT PRIMARY KEY,
  org_name TEXT NOT NULL,
  residency_region TEXT NOT NULL DEFAULT 'af-south-1',
  forced_sale_discount NUMERIC(5,4) NOT NULL DEFAULT 0.2500,
  booking_factor_unauthorised NUMERIC(5,4) NOT NULL DEFAULT 0.1000,
  fp_hourly_cost_zar NUMERIC(10,2) NOT NULL DEFAULT 250.00,
  psi_phase3_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('head_of_forensics', 'legal_recoveries', 'finance_cfo', 'underwriter', 'compliance_dpo')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Lawful Basis Register
CREATE TABLE IF NOT EXISTS data_sources (
  source_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  source_name TEXT NOT NULL,
  adapter_mode TEXT NOT NULL CHECK (adapter_mode IN ('SIMULATED_ADAPTER', 'BATCH_CSV', 'INSURER_API')),
  lawful_basis TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  dpo_signed_off BOOLEAN NOT NULL DEFAULT FALSE,
  dpo_signoff_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Append-Only Hash-Chained Evidence Vault
CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  case_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  content_summary TEXT NOT NULL,
  evidence_tag TEXT NOT NULL CHECK (evidence_tag IN ('Verified Fact', 'Documented Allegation', 'Inference', 'Hypothesis', 'Unknown')),
  source_adapter TEXT NOT NULL,
  sha256_content TEXT NOT NULL,
  prev_chain_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  access_authority TEXT NOT NULL,
  custody_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION nahashield_block_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'evidence_items is append-only: % is prohibited for forensic admissibility', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_evidence_append_only ON evidence_items;
CREATE TRIGGER trg_evidence_append_only
BEFORE UPDATE OR DELETE ON evidence_items
FOR EACH ROW EXECUTE FUNCTION nahashield_block_evidence_mutation();

-- 4. Recovery Desk (M1)
CREATE TABLE IF NOT EXISTS loss_register (
  case_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  policy_ref TEXT NOT NULL,
  claim_ref TEXT NOT NULL,
  defendant_alias TEXT NOT NULL,
  payout_date DATE NOT NULL,
  original_payout NUMERIC(14,2) NOT NULL,
  fraud_basis TEXT NOT NULL,
  title_type TEXT NOT NULL CHECK (title_type IN ('Freehold', 'Sectional', 'Communal / PTO', 'None')),
  primary_residence BOOLEAN NOT NULL DEFAULT FALSE,
  est_sale_proceeds NUMERIC(14,2) NOT NULL DEFAULT 0,
  senior_bonds NUMERIC(14,2) NOT NULL DEFAULT 0,
  municipal_arrears NUMERIC(14,2) NOT NULL DEFAULT 0,
  legal_costs NUMERIC(14,2) NOT NULL DEFAULT 0,
  employment TEXT NOT NULL CHECK (employment IN ('Salaried', 'Self-Employed', 'Unemployed', 'Incarcerated')),
  ring_flag BOOLEAN NOT NULL DEFAULT FALSE,
  registered_owner TEXT NOT NULL,
  legal_owner TEXT NOT NULL,
  beneficial_owner TEXT NOT NULL,
  assigned_owner TEXT NOT NULL,
  prescription_date DATE,
  s300_deadline DATE,
  status TEXT NOT NULL DEFAULT 'Triaged',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Human-in-the-Loop Decisions (POPIA s71 enforced at DB constraint level)
CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  target_type TEXT NOT NULL CHECK (target_type IN ('recovery_route', 'consent_hold', 'claim_deferment', 'claim_repudiation')),
  target_ref TEXT NOT NULL,
  selected_action TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  objective_reasons TEXT[] NOT NULL CHECK (array_length(objective_reasons, 1) >= 1),
  counsel_note TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Co-Signed Savings & Recovery Ledger (C1)
CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  case_ref TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('Live', 'Backtest')),
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_at_stake NUMERIC(14,2) NOT NULL,
  legal_costs NUMERIC(14,2) NOT NULL DEFAULT 0,
  flagged_before_payout BOOLEAN NOT NULL DEFAULT FALSE,
  existing_controls_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  human_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  bank_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  forensics_signoff BOOLEAN NOT NULL DEFAULT FALSE,
  forensics_signoff_by TEXT,
  finance_signoff BOOLEAN NOT NULL DEFAULT FALSE,
  finance_signoff_by TEXT,
  cleared_fp BOOLEAN NOT NULL DEFAULT FALSE,
  review_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  event_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Consent & Cover Integrity (M2)
CREATE TABLE IF NOT EXISTS consent_policies (
  policy_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  product_type TEXT NOT NULL,
  proposer_alias TEXT NOT NULL,
  assured_alias TEXT NOT NULL,
  payer_alias TEXT NOT NULL,
  proposer_ne_assured BOOLEAN NOT NULL,
  payer_ne_assured BOOLEAN NOT NULL,
  cover_amount NUMERIC(14,2) NOT NULL,
  accidental_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1,
  cover_increase_12m BOOLEAN NOT NULL DEFAULT FALSE,
  unrelated_lives_same_payer INTEGER NOT NULL DEFAULT 1,
  beneficiary_relationship TEXT NOT NULL,
  independent_contact_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  contact_source TEXT NOT NULL,
  consent_record_exists BOOLEAN NOT NULL DEFAULT FALSE,
  consent_via_independent_channel BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_language TEXT NOT NULL DEFAULT 'English',
  duress_alert BOOLEAN NOT NULL DEFAULT FALSE,
  cert_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Claims Corroboration (M3 Phase 2 Preview)
CREATE TABLE IF NOT EXISTS claims_preview (
  claim_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  policy_ref TEXT NOT NULL,
  deceased_alias TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  death_to_reg_days INTEGER NOT NULL,
  inception_to_death_days INTEGER NOT NULL,
  bi1663_box24_word_of_mouth BOOLEAN NOT NULL DEFAULT FALSE,
  living_person_signal BOOLEAN NOT NULL DEFAULT FALSE,
  dha_office_outlier BOOLEAN NOT NULL DEFAULT FALSE,
  certifier_cluster_id TEXT,
  parlour_name TEXT NOT NULL,
  voluntary_parlour_elected BOOLEAN NOT NULL DEFAULT FALSE,
  avs_r_status TEXT NOT NULL,
  agent_churn_flag BOOLEAN NOT NULL DEFAULT FALSE,
  claim_amount NUMERIC(14,2) NOT NULL,
  has_dispute_notice BOOLEAN NOT NULL DEFAULT FALSE,
  dispute_opened_at TIMESTAMPTZ,
  dispute_reason TEXT,
  status TEXT NOT NULL
);

-- 9. Immutable Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org_config(org_id),
  actor_role TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row-Level Security (RLS) on all tenant tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE loss_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims_preview ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
