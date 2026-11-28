// Worked example constants (Thabiso's spec 6 + worked-example order).
// Everything here is SYNTHETIC SAMPLE DATA for Lawrence's walkthrough.
// Insurer name is always a variable, never hardcoded. All rand figures are
// sample figures, not insurer or bank proof. Fees/ROI are sample pricing,
// not an offer. Person names are fictional placeholders.
// Counts reconciled across spec 6's tables - every change is logged in
// docs/build-inputs/RECONCILIATION.md.

import {
  bankAccountClusterIndicator,
  simSwapIndicator,
} from '../connectors';

export const SAMPLE_INSURER_DEFAULT = 'Sample Insurer';

export interface ExampleCase {
  reference: string;
  product: string;
  amountCents: number;
  claimantLabel: string;
  deceasedLabel: string;
  relationship: string;
  agent: string;
  dateOfDeath: string;
  submitted: string;
  decided: string;
  outcome: string;
  shieldOutcome: string;
}

export const CASE_1: ExampleCase = {
  reference: 'CLM-2026-00421',
  product: 'Funeral cover',
  amountCents: 2_500_000,
  claimantLabel: 'Spouse (fictional person)',
  deceasedLabel: 'Policyholder (fictional person)',
  relationship: 'Spouse',
  agent: 'Agent 118 (sample)',
  dateOfDeath: '12 May 2026',
  submitted: '14 May 2026',
  decided: '15 May 2026',
  outcome: 'Approved and paid',
  shieldOutcome: 'Cleared - no fraud',
};

export const CASE_2: ExampleCase = {
  reference: 'CLM-2026-00887',
  product: 'Funeral cover',
  amountCents: 7_500_000,
  claimantLabel: 'Claimant, not immediate family (fictional person)',
  deceasedLabel: 'Deceased (fictional person)',
  relationship: 'Not immediate family',
  agent: 'Agent 204 (sample)',
  dateOfDeath: '3 June 2026',
  submitted: '5 June 2026',
  decided: '12 June 2026',
  outcome: 'Declined after human investigation',
  shieldOutcome: 'Flagged - human review - declined',
};

export const CASE_2_SCORES = { fraud: 92, duplicate: 88, evidence: 78 };

export const CASE_2_INDICATORS: { label: string; innocent: string }[] = [
  { label: 'Policy only 21 days old at date of death', innocent: 'New policies are common; many are genuine.' },
  { label: 'Cover raised from R25,000 to R75,000 ten days before death', innocent: 'Families raise cover for real reasons, like a new baby.' },
  { label: simSwapIndicator().label, innocent: simSwapIndicator().innocent },
  { label: bankAccountClusterIndicator().label, innocent: 'Families share accounts, especially in one household.' },
  { label: 'Funeral parlour on 11 claims in 40 days', innocent: 'A busy parlour serves many families.' },
  { label: 'Doctor on 9 claims in 40 days', innocent: 'A local doctor signs many certificates.' },
  { label: 'Claimant is not immediate family', innocent: 'Extended family often handles funerals.' },
  { label: 'Consent incomplete', innocent: 'Paperwork gaps happen; it must be fixed, not assumed fraud.' },
];

export const CASE_2_TIMELINE: { step: string; when: string }[] = [
  { step: 'Claim received', when: '5 June 2026' },
  { step: 'Checks run; risk 92 - held the same day', when: '5 June 2026' },
  { step: 'Human investigator reviews every indicator with its innocent explanation', when: '6-9 June 2026' },
  { step: 'Investigation findings documented; humans decide', when: '10 June 2026' },
  { step: 'Declined with reasons; appeal route explained', when: '12 June 2026' },
  { step: 'Recovery case opened for related paid claims', when: '12 June 2026' },
];

// Six-month sample board. Money terms strictly separate:
// protected (paused before payment) / saved (stopped or reduced, confirmed) /
// found (wrongly paid, found later) / recovered (cash cleared the bank).
export const BOARD = {
  claimsReviewed: 12_000,
  claimsPaid: 11_940,
  clearedLegitimateTotal: 11_940, // never flagged 11,680 + flagged, not held 140 + held then cleared 120
  claimsFlagged: 320,
  claimsHeld: 180,
  clearedAfterHold: 120,
  declinedOrReduced: 60,
  wrongfulPaymentsFound: 45,
  recoveredCases: 18,
  protectedCents: 486_000_000,
  savedCents: 342_000_000,
  foundCents: 118_000_000,
  recoveredCents: 61_000_000,
  flaggedUnconfirmedCents: 144_000_000,
  clearedLegitimateCents: 286_000_000,
  savedCases: 60,
  attribution: { classA: 37, classB: 17, classC: 6 },
  creditableSavingsCents: 273_600_000,
  avgProtectedCents: 2_700_000,
  avgFoundCents: 2_622_200,
  avgRecoveredCents: 3_388_900,
  writeOffRecommendedCents: 57_000_000,
  topRisk: 'Duplicate bank account',
  topIndicator: 'Cover increase before death',
  topAgentRisk: 'Agent 204 (sample)',
  topProviderRisk: 'Parlour 22 (sample)',
};

export const FUTURE_PROTECTION = [
  ['Duplicate policies blocked', '74'],
  ['Duplicate claims blocked', '38'],
  ['High-risk agents restricted', '6'],
  ['High-risk providers monitored', '4'],
  ['Syndicate patterns detected', '3'],
  ['Claimant education sent', '2,400'],
  ['Policyholder education sent', '8,600'],
] as const;

// Sample pricing model - NOT an offer.
export const FEE_ROWS = [
  { label: 'Saved revenue, Class A (15%)', grossCents: 204_000_000, billableCents: 204_000_000, feeCents: 30_600_000 },
  { label: 'Saved revenue, Class B (7.5% of 50% attributed)', grossCents: 108_000_000, billableCents: 54_000_000, feeCents: 4_050_000 },
  { label: 'Saved revenue, Class C (0%)', grossCents: 30_000_000, billableCents: 0, feeCents: 0 },
  { label: 'Recovered cash (20%)', grossCents: 61_000_000, billableCents: 61_000_000, feeCents: 12_200_000 },
  { label: 'Retrospective found revenue (10% of 50% attributed)', grossCents: 118_000_000, billableCents: 59_000_000, feeCents: 5_900_000 },
];

export const ROI = {
  totalValueCents: 334_600_000, // saved 3.42m + recovered 610k - 684k overlap
  feeCents: 52_750_000,
  netBenefitCents: 281_850_000,
  multiple: '5.34x', // net benefit / fee; equals a 434% return over the fee
  roiPct: '434%',
  feePctOfValue: '15.8%',
  feePctOfClaimsPaid: '0.18%',
};

export const ASISA = {
  line: 'ASISA reported 2,282 fraudulent or dishonest funeral claims worth R80.8 million in 2020 (about R35,400 per case).',
  url: 'https://www.asisa.org.za/media-releases/archived-media-releases/life-insurers-report-significant-increases-in-funeral-insurance-fraud-for-2020/',
  verified: 'Verified against the ASISA media release on 28 Nov 2026.',
};

export const fmtR = (cents: number): string =>
  'R' + (cents / 100).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
