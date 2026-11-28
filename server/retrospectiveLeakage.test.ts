import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseLeakage,
  demoCsv,
  parseCsv,
  rowsFromCsv,
  parseAmount,
  LEAKAGE_COLUMNS,
} from './retrospectiveLeakage';

test('CSV parser handles quotes, commas inside fields and CRLF', () => {
  const text = 'claim_ref,insured_name,amount_zar\r\nSYN-1,"Surname, Name","R 1 250,00"\r\n';
  const rows = rowsFromCsv(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].insured_name, 'Surname, Name');
  assert.equal(parseAmount(rows[0].amount_zar), 1250);
  assert.deepEqual(parseCsv('a,b\n')[0], ['a', 'b']);
});

test('sample file exercises every rule family and stays fully synthetic', () => {
  const csv = demoCsv();
  assert(csv.startsWith(LEAKAGE_COLUMNS.join(',')));
  const out = analyseLeakage(csv);
  const rules = new Set(out.findings.map((f) => f.rule));
  for (const expected of [
    'Possible duplicate payment',
    'Shared bank account across unrelated claims',
    'Beneficiary across unrelated lives',
    'Reused document across claims',
    'Claim soon after policy start',
    "Cover held over another person's life",
    'Same insured identity paid more than once',
    'Originator concentration',
    'Funeral parlour across many claims',
  ]) {
    assert(rules.has(expected), `missing rule: ${expected}`);
  }
  assert(out.findings.every((f) => f.status === 'Needs human investigation'));
  assert(out.findings.every((f) => f.innocent_explanation && f.evidence_rows.length > 0 && f.next_check));
  assert(out.summary.claims_analysed > 30);
  assert(out.summary.flagged_paid_zar > 0 && out.summary.flagged_paid_zar <= out.summary.total_paid_zar);
  assert(out.recovery_candidates.length > 0);
  assert(out.recovery_candidates.every((c) => c.paid_zar > 0 && c.suggested_next_step));
});

test('innocent family sharing a phone, account holder and beneficiary does not flag', () => {
  const out = analyseLeakage(demoCsv());
  const familyFindings = out.findings.filter((f) =>
    f.evidence_rows.some((r) => r.household === 'SYN-HH-FAMILY'),
  );
  assert.equal(familyFindings.length, 0, familyFindings.map((f) => f.rule).join('; '));
});

test('summary dedupes flagged amounts by claim reference', () => {
  const out = analyseLeakage(demoCsv());
  const dup = out.findings.find((f) => f.rule === 'Possible duplicate payment');
  assert(dup);
  assert.equal(new Set(dup.claim_refs).size, 1);
  assert.equal(dup.amount_flagged_zar, 480000);
});

test('a small clean file produces no findings', () => {
  const csv = [
    LEAKAGE_COLUMNS.join(','),
    'A-1,P-1,I-1,Name One,H-1,C-1,B-1,ACC-1,PH-1,DOC-1,Parlour A,Dr A,Agent A,1000,2026-01-05,2020-01-01,paid,HH-1',
    'A-2,P-2,I-2,Name Two,H-2,C-2,B-2,ACC-2,PH-2,DOC-2,Parlour B,Dr B,Agent B,2000,2026-02-05,2019-01-01,paid,HH-2',
  ].join('\n');
  const out = analyseLeakage(csv);
  assert.equal(out.findings.length, 0);
  assert.equal(out.summary.claims_analysed, 2);
});

test('missing claim_ref column is rejected', () => {
  assert.throws(() => rowsFromCsv('a,b\n1,2\n'), /claim_ref/);
});
