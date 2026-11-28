import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapHeaders,
  parseClaimDate,
  ingestCsvText,
  ingestClaimRows,
} from './claimsFileIngest';
import { parseCsv, analyseRows } from './leakageEngine';

// A messy insurer-style export: own column names, mixed date and amount
// formats, gaps and duplicate export rows. Fully fictional.
const MESSY_HEADER =
  'Claim No,Policy #,Insured ID,Deceased Name,Holder ID,Claimant Full Name,Beneficiary,Acc No,Cell,Death Certificate No,Funeral Home,Certifying Doctor,Broker,Amount Paid (R),Date of Loss,Policy Start,Claim Status,Family';
const MESSY_ROWS = [
  // Clean baseline claims, Jun-Nov 2026, mixed formats.
  ...Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    const dates = ['2026-06-12', '14/07/2026', '3 Aug 2026', '2026-09-02', '22/09/2026', '2026-10-05', '30/10/2026', '"Nov 8, 2026"', '2026-11-15', '25/11/2026'];
    return [
      `SYN-M-${n}`, `POL-M-${n}`, `ID-M-${n}`, `Fictional life ${n}`, `HDR-M-${n}`,
      `Fictional claimant ${n}`, `Fictional beneficiary ${n}`, `ACC-M-${n}`, `CELL-M-${n}`,
      `CERT-M-${n}`, `Fictional Parlour ${n}`, `Fictional Dr ${n}`, i % 3 === 0 ? 'Fictional Broker X' : `Fictional Broker ${i % 3}`,
      i % 2 === 0 ? `R ${120000 + i * 5000}` : String(120000 + i * 5000),
      dates[i], `2024-0${(i % 9) + 1}-15`, i === 4 ? 'Declined' : 'Paid', `FAM-M-${n}`,
    ].join(',');
  }),
  // Duplicate payment: one claim reference paid twice.
  'SYN-M-011,POL-M-011,ID-M-011,Fictional life 011,HDR-M-011,Fictional claimant 011,Fictional beneficiary 011,ACC-M-011,CELL-M-011,CERT-M-011,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R 240 000,05/10/2026,2024-01-20,Paid,FAM-M-011',
  'SYN-M-011,POL-M-011,ID-M-011,Fictional life 011,HDR-M-011,Fictional claimant 011,Fictional beneficiary 011,ACC-M-011,CELL-M-011,CERT-M-011,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R 240 000,06/10/2026,2024-01-20,Paid,FAM-M-011',
  // Shared bank account across unrelated claimants.
  'SYN-M-012,POL-M-012,ID-M-012,Fictional life 012,HDR-M-012,Fictional claimant 012,Fictional beneficiary 012,ACC-M-MULE,CELL-M-012,CERT-M-012,Fictional Parlour B,Fictional Dr B,Fictional Broker 2,195000.00,2026-08-14,2023-06-01,Paid,FAM-M-012',
  'SYN-M-013,POL-M-013,ID-M-013,Fictional life 013,HDR-M-013,Fictional claimant 013,Fictional beneficiary 013,ACC-M-MULE,CELL-M-013,CERT-M-013,Fictional Parlour C,Fictional Dr C,Fictional Broker 1,"210,000.00",30/10/2026,2022-11-19,Paid,FAM-M-013',
  // Reused death certificate across three unrelated claims.
  'SYN-M-014,POL-M-014,ID-M-014,Fictional life 014,HDR-M-014,Fictional claimant 014,Fictional beneficiary 014,ACC-M-014,CELL-M-014,CERT-REUSED,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R150000,25/08/2026,2024-05-05,Paid,FAM-M-014',
  'SYN-M-015,POL-M-015,ID-M-015,Fictional life 015,HDR-M-015,Fictional claimant 015,Fictional beneficiary 015,ACC-M-015,CELL-M-015,CERT-REUSED,Fictional Parlour B,Fictional Dr B,Fictional Broker 2,175000,29/09/2026,2024-07-07,Paid,FAM-M-015',
  'SYN-M-016,POL-M-016,ID-M-016,Fictional life 016,HDR-M-016,Fictional claimant 016,Fictional beneficiary 016,ACC-M-016,CELL-M-016,CERT-REUSED,Fictional Parlour C,Fictional Dr C,Fictional Broker 1,160000,15/11/2026,2024-09-09,Paid,FAM-M-016',
  // Claim soon after policy start.
  'SYN-M-017,POL-M-017,ID-M-017,Fictional life 017,HDR-M-017,Fictional claimant 017,Fictional beneficiary 017,ACC-M-017,CELL-M-017,CERT-M-017,Fictional Parlour A,Fictional Dr A,Fictional Broker X,R 400 000,20/10/2026,01/08/2026,Paid,FAM-M-017',
  // Gaps: missing claim number, missing amount, missing date.
  ',POL-M-018,ID-M-018,Fictional life 018,HDR-M-018,Fictional claimant 018,Fictional beneficiary 018,ACC-M-018,CELL-M-018,CERT-M-018,Fictional Parlour A,Fictional Dr A,Fictional Broker 2,90000,2026-09-19,2024-01-01,Paid,FAM-M-018',
  'SYN-M-019,POL-M-019,ID-M-019,Fictional life 019,HDR-M-019,Fictional claimant 019,Fictional beneficiary 019,ACC-M-019,CELL-M-019,CERT-M-019,Fictional Parlour B,Fictional Dr B,Fictional Broker 1,,2026-07-21,2024-01-01,Paid,FAM-M-019',
  'SYN-M-020,POL-M-020,ID-M-020,Fictional life 020,HDR-M-020,Fictional claimant 020,Fictional beneficiary 020,ACC-M-020,CELL-M-020,CERT-M-020,Fictional Parlour C,Fictional Dr C,Fictional Broker 2,85000,,2024-01-01,Paid,FAM-M-020',
];
const MESSY_CSV = MESSY_HEADER + '\n' + MESSY_ROWS.join('\n') + '\n';

test('messy insurer column names map onto the canonical columns', () => {
  const mapping = mapHeaders(MESSY_HEADER.split(','));
  assert.equal(mapping.matched.claim_ref, 'Claim No');
  assert.equal(mapping.matched.policy_ref, 'Policy #');
  assert.equal(mapping.matched.insured_name, 'Deceased Name');
  assert.equal(mapping.matched.claimant_name, 'Claimant Full Name');
  assert.equal(mapping.matched.bank_account, 'Acc No');
  assert.equal(mapping.matched.phone, 'Cell');
  assert.equal(mapping.matched.document_hash, 'Death Certificate No');
  assert.equal(mapping.matched.funeral_parlour, 'Funeral Home');
  assert.equal(mapping.matched.doctor, 'Certifying Doctor');
  assert.equal(mapping.matched.agent, 'Broker');
  assert.equal(mapping.matched.amount_zar, 'Amount Paid (R)');
  assert.equal(mapping.matched.claim_date, 'Date of Loss');
  assert.equal(mapping.matched.policy_inception_date, 'Policy Start');
  assert.equal(mapping.matched.status, 'Claim Status');
  assert.equal(mapping.matched.household, 'Family');
  assert.deepEqual(mapping.unmapped, []);
});

test('date parsing understands ISO, day-first, month names and Excel serials', () => {
  assert.equal(parseClaimDate('2026-10-05'), '2026-10-05');
  assert.equal(parseClaimDate('05/10/2026'), '2026-10-05');
  assert.equal(parseClaimDate('5-10-2026'), '2026-10-05');
  assert.equal(parseClaimDate('05.10.2026'), '2026-10-05');
  assert.equal(parseClaimDate('3 Aug 2026'), '2026-08-03');
  assert.equal(parseClaimDate('Nov 8, 2026'), '2026-11-08');
  assert.equal(parseClaimDate('2026/10/05'), '2026-10-05');
  // Excel serial 46341 = 2026-11-15 (days since 1899-12-30).
  assert.equal(parseClaimDate('46341'), '2026-11-15');
  assert.equal(parseClaimDate('not a date'), null);
  assert.equal(parseClaimDate(''), null);
});

test('ingest reports gaps, removes exact duplicate rows and covers six months', () => {
  const { rows, report } = ingestCsvText(MESSY_CSV, 'messy.csv', parseCsv);
  assert.equal(report.rows_read, MESSY_ROWS.length);
  assert.equal(report.duplicate_rows_removed, 0, 'the duplicate claim rows differ only by ref repetition, so both stay for the duplicate-payment rule');
  assert.equal(report.rows_missing_ref, 1);
  assert.equal(report.rows_missing_amount, 1);
  assert.equal(report.rows_missing_date, 1);
  assert.equal(report.months_covered, 6);
  assert.equal(report.first_claim_date, '2026-06-12');
  assert.equal(report.last_claim_date, '2026-11-25');
  assert.equal(rows.length, MESSY_ROWS.length);
  // Missing claim number got a row-N label so the claim is still reviewable.
  assert(rows.some((r) => r.claim_ref.startsWith('row-')));
});

test('exact duplicate export rows are removed once and counted', () => {
  const headers = ['Claim No', 'Amount Paid (R)', 'Date of Loss'];
  const row = { 'Claim No': 'SYN-DUP-1', 'Amount Paid (R)': '1000', 'Date of Loss': '2026-10-01' };
  const { rows, report } = ingestClaimRows(headers, [row, { ...row }, { ...row, 'Claim No': 'SYN-DUP-2' }], 'dups.csv');
  assert.equal(rows.length, 2);
  assert.equal(report.duplicate_rows_removed, 1);
});

test('a file without a claim reference column fails with the columns it saw', () => {
  assert.throws(
    () => ingestCsvText('Fruit,Colour\nApple,Red\n', 'fruit.csv', parseCsv),
    /No claim reference column found[\s\S]*"Fruit"/,
  );
});

test('end to end: messy CSV still finds the leakage and the money to recover', () => {
  const { rows } = ingestCsvText(MESSY_CSV, 'messy.csv', parseCsv);
  const out = analyseRows(rows);
  const rules = new Set(out.findings.map((f) => f.rule));
  assert(rules.has('Possible duplicate payment'), [...rules].join('; '));
  assert(rules.has('Shared bank account across unrelated claims'));
  assert(rules.has('Reused document across claims'));
  assert(rules.has('Claim soon after policy start'));
  const dup = out.findings.find((f) => f.rule === 'Possible duplicate payment');
  assert.equal(dup?.amount_flagged_zar, 480000);
  // Recovery candidates carry rand values for the chase list.
  assert(out.recovery_candidates.length > 0);
  assert(out.recovery_candidates.every((c) => c.paid_zar > 0 && c.suggested_next_step));
  assert(out.summary.flagged_paid_zar > 0);
});
