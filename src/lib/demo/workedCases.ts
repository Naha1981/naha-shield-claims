// Worked-case data (Thabiso's spec 7 API shapes, spec 6 content).
// All fictional sample data. Insurer and person names are variables/neutral
// roles - never a real insurer or person. Amounts are CENTS here (API shape);
// screens format them as rands. Every figure is a sample figure.

export interface WorkedCaseSummary {
  case_id: string; title: string; case_type: 'no_fraud' | 'fraud_detected';
  insurer: string; product: string; claim_reference: string;
  amount_claimed: number; fraud_risk: string; duplicate_risk: string; evidence_strength: string;
  decision: string; outcome: string; outcome_label: string;
  revenue_protected: number; revenue_saved: number; revenue_recovered: number;
  summary: string;
}
export interface CaseStep { step_id: string; title: string; description: string; logic: string; deliverable: string }
export interface CaseIndicator { indicator_id: string; title: string; severity: string; description: string; innocent_explanation: string }
export interface CaseEvidence { evidence_id: string; type: string; class: string; description: string }
export interface CaseDecision { decision: string; reason: string; approver: string; approved_at: string }
export interface CaseValue { revenue_protected: number; revenue_saved: number; revenue_recovered: number; claimant_experience: string; compliance_outcome: string }
export interface ShieldExplanation { bottom_line: string; why: string[]; evidence: { type: string; description: string }[]; innocent_explanations: string[]; next_step: string }
export interface WorkedCase extends WorkedCaseSummary {
  policyholder: string; deceased: string; claimant: string; relationship: string; agent: string;
  amount_paid: number;
  timeline: CaseStep[]; indicators: CaseIndicator[]; evidence: CaseEvidence[];
  case_decision: CaseDecision; value: CaseValue; shield_explanation: ShieldExplanation;
}

// Insurer name is a placeholder variable. The landing page lets the viewer
// type their own insurer name; the API serves this neutral placeholder.
export const INSURER_PLACEHOLDER = 'Sample Insurer';

export const WORKED_CASES: WorkedCase[] = [
  {
    case_id: 'worked_case_001',
    title: 'Valid funeral claim approved quickly',
    case_type: 'no_fraud',
    insurer: INSURER_PLACEHOLDER,
    product: 'Funeral cover',
    claim_reference: 'CLM-2026-00421',
    policyholder: 'Policyholder (fictional person)',
    deceased: 'Deceased (fictional person)',
    claimant: 'Spouse of the deceased (fictional person)',
    relationship: 'spouse',
    agent: 'Agent 118 (sample)',
    amount_claimed: 2_500_000,
    amount_paid: 2_500_000,
    fraud_risk: 'low', duplicate_risk: 'low', evidence_strength: 'strong',
    decision: 'approved', outcome: 'cleared', outcome_label: 'Cleared - no fraud',
    revenue_protected: 0, revenue_saved: 0, revenue_recovered: 0,
    summary: 'A valid claim was verified and paid quickly without any fraud indicators.',
    timeline: [
      { step_id: 'step_001', title: 'Claim received', description: 'The agent submitted the claim through the agent app.', logic: 'Claim created and policy linked.', deliverable: 'Claim record created.' },
      { step_id: 'step_002', title: 'Automated checks run', description: 'NahaShield ran identity, death, beneficiary, duplicate, document, and agent checks.', logic: 'All checks passed.', deliverable: 'Check results recorded.' },
      { step_id: 'step_003', title: 'No fraud indicators', description: 'No fraud or duplicate-cover indicators were detected.', logic: 'Risk score below threshold.', deliverable: 'Low-risk classification.' },
      { step_id: 'step_004', title: 'Human approval', description: 'A claims assessor approved payment.', logic: 'Human approval required before payment.', deliverable: 'Payment instruction issued.' },
      { step_id: 'step_005', title: 'Claim paid', description: 'Claim paid to the verified beneficiary within 1 business day.', logic: 'Payment released after approval.', deliverable: 'Claim closed as paid.' },
    ],
    indicators: [],
    evidence: [
      { evidence_id: 'evd_001', type: 'policy_record', class: 'verified_fact', description: 'Policy active and premiums paid.' },
      { evidence_id: 'evd_002', type: 'death_register', class: 'verified_fact', description: 'Death registered on 12 May 2026.' },
      { evidence_id: 'evd_003', type: 'beneficiary_record', class: 'verified_fact', description: 'Claimant is the recorded spouse and authorised beneficiary.' },
    ],
    case_decision: { decision: 'approved', reason: 'All required verification checks passed.', approver: 'Claims assessor (role, fictional)', approved_at: '2026-05-15T10:12:00Z' },
    value: { revenue_protected: 0, revenue_saved: 0, revenue_recovered: 0, claimant_experience: 'positive', compliance_outcome: 'compliant' },
    shield_explanation: {
      bottom_line: 'This is a valid claim. All checks passed and payment was approved.',
      why: ['Policy active and premiums paid.', 'Death verified.', 'Claimant is the authorised beneficiary.', 'No duplicate cover detected.'],
      evidence: [
        { type: 'verified_fact', description: 'Policy active.' },
        { type: 'verified_fact', description: 'Death verified.' },
        { type: 'verified_fact', description: 'Beneficiary verified.' },
      ],
      innocent_explanations: [],
      next_step: 'Release payment.',
    },
  },
  {
    case_id: 'worked_case_002',
    title: 'Fraud pattern detected before payment',
    case_type: 'fraud_detected',
    insurer: INSURER_PLACEHOLDER,
    product: 'Funeral cover',
    claim_reference: 'CLM-2026-00887',
    policyholder: 'Policyholder (fictional person)',
    deceased: 'Deceased (fictional person)',
    claimant: 'Cousin of the deceased (fictional person)',
    relationship: 'cousin (not immediate family)',
    agent: 'Agent 204 (sample)',
    amount_claimed: 7_500_000,
    amount_paid: 0,
    fraud_risk: 'high', duplicate_risk: 'high', evidence_strength: 'strong',
    decision: 'declined', outcome: 'fraud_prevented', outcome_label: 'Fraud prevented',
    revenue_protected: 7_500_000, revenue_saved: 7_500_000, revenue_recovered: 0,
    summary: 'Multiple high-risk indicators were detected and payment was held before payout.',
    timeline: [
      { step_id: 'step_001', title: 'Claim received', description: 'The agent submitted the claim through the agent app.', logic: 'Claim created and policy linked.', deliverable: 'Claim record created.' },
      { step_id: 'step_002', title: 'Automated checks run', description: 'NahaShield ran identity, death, beneficiary, duplicate, payment, telecom, provider, and agent checks.', logic: 'Multiple high-risk indicators detected.', deliverable: 'High-risk classification.' },
      { step_id: 'step_003', title: 'Payment held', description: 'A claims assessor held payment before payout.', logic: 'High-risk indicators require human review.', deliverable: 'Revenue protected.' },
      { step_id: 'step_004', title: 'Investigation', description: 'An investigator reviewed the evidence and linked claims.', logic: 'Cross-claim and provider patterns confirmed.', deliverable: 'Evidence pack prepared.' },
      { step_id: 'step_005', title: 'Claim declined', description: 'A senior claims manager declined the claim after 5 business days, with reasons and an appeal route.', logic: 'Material misrepresentation and invalid consent evidence.', deliverable: 'Revenue saved.' },
    ],
    indicators: [
      { indicator_id: 'ind_001', title: 'Claim submitted within two days of death', severity: 'medium', description: 'Claim was submitted very soon after the death.', innocent_explanation: 'Family may have submitted the claim quickly.' },
      { indicator_id: 'ind_002', title: 'Policy issued 21 days before claim', severity: 'high', description: 'Policy was issued shortly before the claim.', innocent_explanation: 'Policy may have been taken out for legitimate reasons.' },
      { indicator_id: 'ind_003', title: 'Cover increased ten days before death', severity: 'high', description: 'Cover increased from R25,000 to R75,000 shortly before death.', innocent_explanation: 'Cover increase may have been legitimate.' },
      { indicator_id: 'ind_004', title: 'SIM swap before bank-account change', severity: 'high', description: 'SIM swap occurred 36 hours before the bank-account change.', innocent_explanation: 'SIM swap may have been legitimate.' },
      { indicator_id: 'ind_005', title: 'Bank account linked to multiple claims', severity: 'high', description: 'Same bank account linked to three unrelated claims.', innocent_explanation: 'Family members may share a bank account.' },
      { indicator_id: 'ind_006', title: 'Same funeral parlour linked to multiple claims', severity: 'medium', description: 'Same parlour linked to 11 claims in 40 days.', innocent_explanation: 'Busy parlour may process many legitimate claims.' },
      { indicator_id: 'ind_007', title: 'Same doctor linked to multiple claims', severity: 'medium', description: 'Same doctor linked to nine claims in 40 days.', innocent_explanation: 'Doctor may serve a large community.' },
      { indicator_id: 'ind_008', title: 'Claimant is not immediate family', severity: 'medium', description: 'The claimant is a cousin, not immediate family.', innocent_explanation: 'Extended family often handles funerals.' },
      { indicator_id: 'ind_009', title: 'Consent evidence incomplete', severity: 'high', description: 'Consent evidence was incomplete.', innocent_explanation: 'Documents may have been lost or not yet submitted.' },
    ],
    evidence: [
      { evidence_id: 'evd_004', type: 'policy_record', class: 'verified_fact', description: 'Policy issued 21 days before claim.' },
      { evidence_id: 'evd_005', type: 'cover_change_log', class: 'verified_fact', description: 'Cover increased ten days before death.' },
      { evidence_id: 'evd_006', type: 'telecom_record', class: 'verified_fact', description: 'SIM swap occurred 36 hours before the bank-account change.' },
      { evidence_id: 'evd_007', type: 'payment_graph', class: 'verified_fact', description: 'Same bank account linked to three unrelated claims.' },
      { evidence_id: 'evd_008', type: 'provider_graph', class: 'verified_fact', description: 'Same parlour linked to 11 claims in 40 days.' },
      { evidence_id: 'evd_009', type: 'provider_graph', class: 'verified_fact', description: 'Same doctor linked to nine claims in 40 days.' },
      { evidence_id: 'evd_010', type: 'consent_vault', class: 'documented_allegation', description: 'Consent evidence incomplete.' },
    ],
    case_decision: { decision: 'declined', reason: 'Material misrepresentation and invalid consent evidence.', approver: 'Senior claims manager (role, fictional)', approved_at: '2026-06-12T10:00:00Z' },
    value: { revenue_protected: 7_500_000, revenue_saved: 7_500_000, revenue_recovered: 0, claimant_experience: 'neutral', compliance_outcome: 'compliant' },
    shield_explanation: {
      bottom_line: 'Multiple high-risk indicators were detected. Payment was held before payout. Indicators are not a finding of fraud; humans decided.',
      why: ['Policy issued shortly before claim.', 'Cover increased before death.', 'SIM swap before bank-account change.', 'Same bank account linked to multiple claims.', 'Consent evidence incomplete.'],
      evidence: [
        { type: 'verified_fact', description: 'Policy issued 21 days before claim.' },
        { type: 'verified_fact', description: 'Cover increased before death.' },
        { type: 'verified_fact', description: 'SIM swap before bank-account change.' },
        { type: 'verified_fact', description: 'Same bank account linked to multiple claims.' },
        { type: 'documented_allegation', description: 'Consent evidence incomplete.' },
      ],
      innocent_explanations: ['Family member may have changed banking details.', 'SIM swap may have been legitimate.', 'Funeral parlour may be high-volume.', 'Doctor may serve a large community.'],
      next_step: 'Hold payment and investigate.',
    },
  },
];

export const listPayload = () => ({
  data: WORKED_CASES.map(({ timeline: _t, indicators: _i, evidence: _e, case_decision: _d, value: _v, shield_explanation: _s, policyholder: _p, deceased: _dd, claimant: _c, relationship: _r, agent: _a, amount_paid: _ap, ...summary }) => summary),
  meta: { page: 1, page_size: 20, total: WORKED_CASES.length, total_pages: 1 },
});

export const detailPayload = (caseId: string) => {
  const c = WORKED_CASES.find((w) => w.case_id === caseId);
  if (!c) return null;
  const { case_decision, ...rest } = c;
  return { data: { ...rest, decision: c.decision, case_decision }, meta: { generated_at: new Date().toISOString(), data_type: 'fictional_sample' } };
};

export const fmtCents = (cents: number): string =>
  'R' + (cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
