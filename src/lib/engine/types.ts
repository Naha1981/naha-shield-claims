import type { IngestedAttachmentMeta } from './evidenceIngestion';

export type RoleId =
  | 'head_of_forensics'
  | 'legal_recoveries'
  | 'finance_cfo'
  | 'underwriter'
  | 'compliance_dpo';

export type EvidenceTag =
  | 'Verified Fact'
  | 'Documented Allegation'
  | 'Inference'
  | 'Hypothesis'
  | 'Unknown';

export type TitleType = 'Freehold' | 'Sectional' | 'Communal / PTO' | 'None';

export type EmploymentType =
  | 'Salaried'
  | 'Self-Employed'
  | 'Unemployed'
  | 'Incarcerated';

export interface RecoveryCaseInput {
  case_id: string;
  policy_ref: string;
  claim_ref: string;
  defendant_alias: string;
  payout_date: string;
  original_payout: number;
  fraud_basis: string;
  title_type: TitleType;
  primary_residence: boolean;
  est_sale_proceeds: number;
  senior_bonds: number;
  municipal_arrears: number;
  legal_costs: number;
  employment: EmploymentType;
  ring_flag: boolean;
  forced_sale_discount?: number;
  registered_owner?: string;
  legal_owner?: string;
  beneficial_owner?: string;
  assigned_owner?: string;
  prescription_date?: string;
  s300_deadline?: string;
  status?: string;
}

export interface EightLayerAssetProfile {
  registered_owner: string;
  legal_owner: string;
  beneficial_owner: string;
  market_value: number;
  forced_sale_value: number;
  nrv_low: number;
  nrv_high: number;
  legally_accessible: boolean;
  practically_recoverable: number;
}

export interface RecoveryTriageOutput {
  accessible: 0 | 1;
  forced_sale_discount: number;
  forced_sale_proceeds: number;
  conservative_equity: number;
  nrv_low: number;
  nrv_high: number;
  practically_recoverable: number;
  rule_46a_flag: boolean;
  ipilra_pto_flag: boolean;
  early_write_off: boolean;
  futile_spend_avoided: number;
  recommended_route: string;
  s300_forum: 'District (≤R300k)' | 'Regional (≤R1m)' | 'High Court' | null;
  s300_warning: string | null;
  state_referral_pack: string | null;
  eight_layers: EightLayerAssetProfile;
}

export type LedgerBasis = 'Live' | 'Backtest';

export type LedgerEventType =
  | 'Policy cancelled (unauthorised)'
  | 'Claim repudiated'
  | 'Claim withdrawn'
  | 'Commission held/clawed back'
  | 'Cash recovered'
  | 'Futile spend avoided'
  | 'Judgment / order obtained'
  | 'Criminal arrest / conviction'
  | 'Repayment promise'
  | 'False positive review';

export interface LedgerEntryInput {
  entry_id: string;
  case_ref: string;
  basis: LedgerBasis;
  event_type: LedgerEventType;
  description: string;
  amount_at_stake: number;
  legal_costs: number;
  flagged_before_payout: boolean;
  existing_controls_flagged: boolean;
  human_confirmed: boolean;
  bank_reconciled: boolean;
  forensics_signoff: boolean;
  forensics_signoff_by?: string | null;
  finance_signoff: boolean;
  finance_signoff_by?: string | null;
  cleared_fp: boolean;
  review_hours: number;
  event_date: string;
}

export type LedgerLanguageLabel =
  | 'protected / recovered'
  | 'would have protected'
  | 'awaiting dual sign-off'
  | 'no credit — existing controls'
  | 'n/a — not money'
  | 'friction logged'
  | 'exposure';

export interface LedgerEntryEvaluation {
  live_protected: number;
  would_have_protected: number;
  net_cash_recovered: number;
  futile_spend_avoided: number;
  fp_review_cost: number;
  booking_factor: number;
  language_label: LedgerLanguageLabel;
  why_not_counted: string | null;
  is_counted_rand_value: boolean;
}

export interface LedgerSummary {
  confirmed_fraudulent_loss: number;
  judgment_order_value: number;
  agreed_repayment_plans: number;
  legal_costs_spent: number;
  futile_spend_avoided: number;
  bank_reconciled_cash_received: number;
  incremental_protected_live: number;
  would_have_protected_backtest: number;
  fp_review_cost_total: number;
  cleared_fp_count: number;
  awaiting_signoff_count: number;
}

export type BeneficiaryRelationship =
  | 'Spouse / Child'
  | 'Parent / Sibling'
  | 'Other Family'
  | 'Non-immediate';

export type ConsentLanguage =
  | 'English'
  | 'isiZulu'
  | 'isiXhosa'
  | 'Sesotho'
  | 'Afrikaans';

export interface ConsentPolicyInput {
  policy_id: string;
  product_type: string;
  proposer_alias: string;
  assured_alias: string;
  payer_alias: string;
  proposer_ne_assured: boolean;
  payer_ne_assured: boolean;
  cover_amount: number;
  accidental_multiplier: number;
  cover_increase_12m: boolean;
  unrelated_lives_same_payer: number;
  beneficiary_relationship: BeneficiaryRelationship;
  independent_contact_on_file: boolean;
  contact_source: string;
  consent_record_exists: boolean;
  consent_via_independent_channel: boolean;
  preferred_language: ConsentLanguage;
  duress_alert: boolean;
  cert_hash?: string | null;
  /** Optional synthetic attribute strictly ignored by PEPUDA-compliant consent rules */
  assured_age_band?: string;
}

export interface ConsentPolicyEvaluation {
  third_party: boolean;
  contact_independence_status:
    | 'n/a'
    | 'Independent contact on file'
    | 'Contact Independence Unverified — Escalate';
  consent_tier: 'n/a' | 'Standard' | 'Escalated';
  consent_gap_status: 'OK' | 'CONSENT GAP' | 'CHANNEL NOT INDEPENDENT';
  exposure_at_gap: number;
  escalation_reasons: string[];
}

export interface EvidenceItemRecord {
  evidence_id: string;
  org_id: string;
  case_ref: string;
  title: string;
  content_summary: string;
  evidence_tag: EvidenceTag;
  source_adapter: string;
  sha256_content: string;
  prev_chain_hash: string;
  chain_hash: string;
  uploader_id: string;
  access_authority: string;
  custody_log: Array<{ actor: string; action: string; ts: string }>;
  created_at: string;
  attachment_meta?: IngestedAttachmentMeta;
}

export interface VaultVerificationResult {
  valid: boolean;
  checked_count: number;
  failed_index: number | null;
  failed_evidence_id: string | null;
  reason: string | null;
}

export interface TippingOffLintResult {
  ok: boolean;
  violations: string[];
}

export interface ClaimPreviewRecord {
  claim_id: string;
  policy_ref: string;
  deceased_alias: string;
  submitted_at: string;
  death_to_reg_days: number;
  inception_to_death_days: number;
  bi1663_box24_word_of_mouth: boolean;
  living_person_signal: boolean;
  dha_office_outlier: boolean;
  certifier_cluster_id: string | null;
  parlour_name: string;
  voluntary_parlour_elected: boolean;
  avs_r_status: 'MATCHED' | 'MISMATCH' | 'UNVERIFIED';
  agent_churn_flag: boolean;
  claim_amount: number;
  has_dispute_notice: boolean;
  dispute_opened_at: string | null;
  dispute_reason: string | null;
  status: string;
}

export interface ClaimTimerStatus {
  initial_deadline_iso: string;
  initial_business_days_elapsed: number;
  initial_business_days_remaining: number;
  initial_breached: boolean;
  dispute_deadline_iso: string | null;
  dispute_business_days_elapsed: number | null;
  dispute_business_days_remaining: number | null;
  dispute_breached: boolean;
  fic_advisory_deadline_iso: string;
  clock_label: string;
}

export interface HumanDecisionRecord {
  decision_id: string;
  org_id: string;
  target_type:
    | 'recovery_route'
    | 'consent_hold'
    | 'claim_deferment'
    | 'claim_repudiation';
  target_ref: string;
  selected_action: string;
  reviewer_id: string;
  reviewer_role: RoleId;
  objective_reasons: string[];
  counsel_note?: string;
  decided_at: string;
}

export interface AuditLogRecord {
  audit_id: string;
  org_id: string;
  actor_role: RoleId;
  actor_id: string;
  action: string;
  object_type: string;
  object_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface KpiAuditNoteRecord {
  note_id: string;
  org_id: string;
  content: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_role: RoleId;
  include_in_pdf: boolean;
}

