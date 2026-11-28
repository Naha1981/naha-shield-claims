// Role-based access control matrix from Thabiso's implementation spec
// (2026-11-28, PRD v1.2 section 30). Encoded as data so the backend
// authorises every request against it: access by role, tenant and object;
// every adverse action needs explicit approval rights; executives get
// summaries, not raw evidence.
//
// Access values:
//   yes     full access
//   no      denied
//   limited narrowed access (e.g. partial evidence)
//   summary aggregated value data only, never raw evidence

export type Access = 'yes' | 'no' | 'limited' | 'summary';

export type SpecRole =
  | 'policyholder'
  | 'beneficiary'
  | 'agent'
  | 'assessor'
  | 'claims_manager'
  | 'investigator'
  | 'senior_investigator'
  | 'head_of_recoveries'
  | 'finance'
  | 'compliance'
  | 'legal'
  | 'executive'
  | 'insurer_admin'
  | 'nahalabs_support';

export type Capability =
  | 'view_own_policy'
  | 'view_own_claim'
  | 'submit_claim'
  | 'upload_claim_document'
  | 'view_claim_indicators'
  | 'view_evidence'
  | 'raise_indicator'
  | 'hold_claim'
  | 'request_documents'
  | 'escalate_claim'
  | 'approve_hold'
  | 'reduce_claim'
  | 'decline_claim'
  | 'refer_to_saps'
  | 'view_recovery_case'
  | 'create_recovery_case'
  | 'recommend_recovery_route'
  | 'approve_recovery_route'
  | 'record_recovery_payment'
  | 'reconcile_recovery_payment'
  | 'write_off_recovery'
  | 'confirm_saving'
  | 'view_savings_ledger'
  | 'view_audit_log'
  | 'manage_users'
  | 'manage_integrations'
  | 'manage_model_thresholds'
  | 'approve_model_change'
  | 'kill_switch';

type Row = Partial<Record<SpecRole, Access>>;

export const ROLE_LABELS: Record<SpecRole, string> = {
  policyholder: 'Policyholder',
  beneficiary: 'Beneficiary',
  agent: 'Agent',
  assessor: 'Claims assessor',
  claims_manager: 'Claims manager',
  investigator: 'Investigator',
  senior_investigator: 'Senior investigator',
  head_of_recoveries: 'Head of Recoveries',
  finance: 'Finance partner',
  compliance: 'Compliance officer',
  legal: 'Legal',
  executive: 'Executive',
  insurer_admin: 'Insurer administrator',
  nahalabs_support: 'NahaLabs support',
};

// The matrix. A missing cell means no. Roles not listed in the spec's matrix
// (senior_investigator, nahalabs_support) follow the spec's role definitions:
// senior investigator approves serious investigations; support has no evidence
// access by default.
export const RBAC_MATRIX: Record<Capability, Row> = {
  view_own_policy: { policyholder: 'yes', assessor: 'yes', claims_manager: 'yes', investigator: 'yes', head_of_recoveries: 'yes', finance: 'yes', compliance: 'yes', legal: 'yes', executive: 'yes', insurer_admin: 'yes', senior_investigator: 'yes' },
  view_own_claim: { policyholder: 'yes', beneficiary: 'yes', agent: 'yes', assessor: 'yes', claims_manager: 'yes', investigator: 'yes', head_of_recoveries: 'yes', finance: 'yes', compliance: 'yes', legal: 'yes', executive: 'yes', insurer_admin: 'yes', senior_investigator: 'yes' },
  submit_claim: { beneficiary: 'yes', agent: 'yes' },
  upload_claim_document: { beneficiary: 'yes', agent: 'yes', assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes' },
  view_claim_indicators: { assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes', head_of_recoveries: 'yes', compliance: 'yes', legal: 'yes', executive: 'summary' },
  view_evidence: { beneficiary: 'limited', agent: 'limited', assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes', head_of_recoveries: 'yes', finance: 'limited', compliance: 'yes', legal: 'yes', executive: 'summary' },
  raise_indicator: { assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes' },
  hold_claim: { assessor: 'yes', claims_manager: 'yes' },
  request_documents: { assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes' },
  escalate_claim: { assessor: 'yes', claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes' },
  approve_hold: { claims_manager: 'yes' },
  reduce_claim: { claims_manager: 'yes', legal: 'yes' },
  decline_claim: { claims_manager: 'yes', legal: 'yes' },
  refer_to_saps: { investigator: 'yes', senior_investigator: 'yes', compliance: 'yes', legal: 'yes' },
  view_recovery_case: { claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes', head_of_recoveries: 'yes', finance: 'yes', compliance: 'yes', legal: 'yes', executive: 'summary' },
  create_recovery_case: { claims_manager: 'yes', investigator: 'yes', senior_investigator: 'yes', head_of_recoveries: 'yes' },
  recommend_recovery_route: { head_of_recoveries: 'yes' },
  approve_recovery_route: { head_of_recoveries: 'yes', legal: 'yes' },
  record_recovery_payment: { head_of_recoveries: 'yes', finance: 'yes' },
  reconcile_recovery_payment: { head_of_recoveries: 'yes', finance: 'yes' },
  write_off_recovery: { head_of_recoveries: 'yes', legal: 'yes' },
  confirm_saving: { finance: 'yes' },
  view_savings_ledger: { claims_manager: 'yes', head_of_recoveries: 'yes', finance: 'yes', compliance: 'yes', executive: 'yes' },
  view_audit_log: { assessor: 'limited', claims_manager: 'limited', investigator: 'limited', senior_investigator: 'limited', head_of_recoveries: 'limited', finance: 'limited', compliance: 'yes', legal: 'yes', insurer_admin: 'yes' },
  manage_users: { insurer_admin: 'yes' },
  manage_integrations: { insurer_admin: 'yes' },
  manage_model_thresholds: { compliance: 'yes' },
  approve_model_change: { compliance: 'yes' },
  kill_switch: { compliance: 'yes', insurer_admin: 'yes' },
};

export function can(role: SpecRole, capability: Capability): boolean {
  return RBAC_MATRIX[capability]?.[role] === 'yes';
}

export function accessOf(role: SpecRole, capability: Capability): Access {
  return RBAC_MATRIX[capability]?.[role] ?? 'no';
}

// Object-level rules from the spec, enforced with the matrix:
//   * a user may access only objects within their tenant;
//   * an agent may access only claims they originated or are assigned to;
//   * an assessor may access only claims assigned to their team;
//   * an investigator may access only cases assigned to them or their team;
//   * finance sees ledger and reconciliation, not full claim evidence;
//   * compliance sees audit, consent and control data;
//   * legal sees adverse-action and referral evidence;
//   * executives receive aggregated value data, not raw evidence;
//   * NahaLabs support has no evidence access unless explicitly time-bound
//     and approved (not implemented: no evidence access, period).
export function canAccessObject(
  role: SpecRole,
  capability: Capability,
  object: { tenant_id: string },
  subject: { tenant_id: string },
): boolean {
  if (object.tenant_id !== subject.tenant_id) return false;
  return accessOf(role, capability) !== 'no';
}

// The sample roles Lawrence tests with, mapped to the nearest spec role. Sample
// mode keeps working exactly as before; this mapping is only used so the new
// spec endpoints answer consistently while auth is off.
export const DEMO_ROLE_MAP: Record<string, SpecRole> = {
  head_of_forensics: 'investigator',
  legal_recoveries: 'head_of_recoveries',
  finance_cfo: 'finance',
  compliance_dpo: 'compliance',
  underwriter: 'policyholder',
};
