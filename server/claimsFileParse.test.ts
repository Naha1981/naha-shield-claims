import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { rowsFromXlsx } from './claimsFileParse';
import { ingestClaimRows } from '../src/lib/engine/claimsFileIngest';
import { analyseRows } from '../src/lib/engine/leakageEngine';

// Builds a messy insurer-style workbook in memory: a title banner above the
// table, the insurer's own column names, real Excel date cells, mixed amount
// formats, one exact duplicate export row and gaps. Fully fictional.
async function buildMessyWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Claims Export');
  ws.addRow(['Fictional Insurer Ltd - claims export Jun-Nov 2026 - SYNTHETIC']);
  ws.addRow([]);
  ws.addRow([
    'Claim No', 'Policy #', 'Deceased Name', 'Claimant Full Name', 'Beneficiary',
    'Acc No', 'Cell', 'Death Certificate No', 'Broker', 'Amount Paid (R)',
    'Date of Loss', 'Policy Start', 'Claim Status', 'Family',
  ]);
  const add = (vals: unknown[]) => ws.addRow(vals);
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(3, '0');
    add([
      `SYN-X-${n}`, `POL-X-${n}`, `Fictional life ${n}`, `Fictional claimant ${n}`,
      `Fictional beneficiary ${n}`, `ACC-X-${n}`, `CELL-X-${n}`, `CERT-X-${n}`,
      `Fictional Broker ${i % 3}`, 100000 + i * 10000,
      new Date(Date.UTC(2026, 5 + ((i - 1) % 6), 10)), new Date(Date.UTC(2024, i, 15)),
      'Paid', `FAM-X-${n}`,
    ]);
  }
  // Duplicate payment: one claim reference, two payment runs.
  add(['SYN-X-009', 'POL-X-009', 'Fictional life 009', 'Fictional claimant 009', 'Fictional beneficiary 009', 'ACC-X-009', 'CELL-X-009', 'CERT-X-009', 'Fictional Broker 1', 'R 300 000', new Date(Date.UTC(2026, 9, 5)), new Date(Date.UTC(2024, 0, 20)), 'Paid', 'FAM-X-009']);
  add(['SYN-X-009', 'POL-X-009', 'Fictional life 009', 'Fictional claimant 009', 'Fictional beneficiary 009', 'ACC-X-009', 'CELL-X-009', 'CERT-X-009', 'Fictional Broker 1', 'R 300 000', new Date(Date.UTC(2026, 9, 6)), new Date(Date.UTC(2024, 0, 20)), 'Paid', 'FAM-X-009']);
  // Shared account across unrelated claimants.
  add(['SYN-X-010', 'POL-X-010', 'Fictional life 010', 'Fictional claimant 010', 'Fictional beneficiary 010', 'ACC-X-MULE', 'CELL-X-010', 'CERT-X-010', 'Fictional Broker 2', 180000, '14/08/2026', '2023-06-01', 'Paid', 'FAM-X-010']);
  add(['SYN-X-011', 'POL-X-011', 'Fictional life 011', 'Fictional claimant 011', 'Fictional beneficiary 011', 'ACC-X-MULE', 'CELL-X-011', 'CERT-X-011', 'Fictional Broker 1', 205000, '2026-10-30', '2022-11-19', 'Paid', 'FAM-X-011']);
  // Gaps: a row with no claim number and a row with no amount.
  add(['', 'POL-X-012', 'Fictional life 012', 'Fictional claimant 012', 'Fictional beneficiary 012', 'ACC-X-012', 'CELL-X-012', 'CERT-X-012', 'Fictional Broker 2', 95000, new Date(Date.UTC(2026, 8, 19)), new Date(Date.UTC(2024, 0, 1)), 'Paid', 'FAM-X-012']);
  add(['SYN-X-013', 'POL-X-013', 'Fictional life 013', 'Fictional claimant 013', 'Fictional beneficiary 013', 'ACC-X-013', 'CELL-X-013', 'CERT-X-013', 'Fictional Broker 1', '', new Date(Date.UTC(2026, 6, 21)), new Date(Date.UTC(2024, 0, 1)), 'Paid', 'FAM-X-013']);
  // An exact duplicate export row of SYN-X-001's row.
  add(['SYN-X-001', 'POL-X-001', 'Fictional life 001', 'Fictional claimant 001', 'Fictional beneficiary 001', 'ACC-X-001', 'CELL-X-001', 'CERT-X-001', 'Fictional Broker 1', 110000, new Date(Date.UTC(2026, 5, 10)), new Date(Date.UTC(2024, 1, 15)), 'Paid', 'FAM-X-001']);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

test('Excel workbook with banner, messy headers, dates and gaps ingests cleanly', async () => {
  const buf = await buildMessyWorkbook();
  const sheet = await rowsFromXlsx(buf);
  assert.equal(sheet.sheet_name, 'Claims Export');
  assert(sheet.headers.includes('Claim No'));
  assert(sheet.headers.includes('Amount Paid (R)'));
  // Banner rows above the table are skipped; only claim rows arrive.
  assert.equal(sheet.rows.length, 15);
  // Real Excel date cells arrive as ISO dates.
  assert.match(sheet.rows[0]['Date of Loss'], /^2026-06-10$/);

  const { rows, report } = ingestClaimRows(sheet.headers, sheet.rows, 'messy.xlsx');
  assert.equal(report.duplicate_rows_removed, 1);
  assert.equal(report.rows_missing_ref, 1);
  assert.equal(report.rows_missing_amount, 1);
  assert(report.months_covered && report.months_covered >= 5);

  const out = analyseRows(rows);
  const rules = new Set(out.findings.map((f) => f.rule));
  assert(rules.has('Possible duplicate payment'), [...rules].join('; '));
  assert(rules.has('Shared bank account across unrelated claims'));
  const dup = out.findings.find((f) => f.rule === 'Possible duplicate payment');
  assert.equal(dup?.amount_flagged_zar, 600000);
  assert(out.recovery_candidates.length > 0);
  assert(out.recovery_candidates.every((c) => c.paid_zar > 0));
});
