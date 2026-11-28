// Generates the synthetic messy 6-month claims files used to prove the ingest:
// /tmp/messy-6month-claims.csv and /tmp/messy-6month-claims.xlsx
// Fully fictional data; mirrors the engine test fixtures.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';

const HEADER =
  'Claim No,Policy #,Insured ID,Deceased Name,Holder ID,Claimant Full Name,Beneficiary,Acc No,Cell,Death Certificate No,Funeral Home,Certifying Doctor,Broker,Amount Paid (R),Date of Loss,Policy Start,Claim Status,Family';
const ROWS = [
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
  'SYN-M-011,POL-M-011,ID-M-011,Fictional life 011,HDR-M-011,Fictional claimant 011,Fictional beneficiary 011,ACC-M-011,CELL-M-011,CERT-M-011,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R 240 000,05/10/2026,2024-01-20,Paid,FAM-M-011',
  'SYN-M-011,POL-M-011,ID-M-011,Fictional life 011,HDR-M-011,Fictional claimant 011,Fictional beneficiary 011,ACC-M-011,CELL-M-011,CERT-M-011,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R 240 000,06/10/2026,2024-01-20,Paid,FAM-M-011',
  'SYN-M-012,POL-M-012,ID-M-012,Fictional life 012,HDR-M-012,Fictional claimant 012,Fictional beneficiary 012,ACC-M-MULE,CELL-M-012,CERT-M-012,Fictional Parlour B,Fictional Dr B,Fictional Broker 2,195000.00,2026-08-14,2023-06-01,Paid,FAM-M-012',
  'SYN-M-013,POL-M-013,ID-M-013,Fictional life 013,HDR-M-013,Fictional claimant 013,Fictional beneficiary 013,ACC-M-MULE,CELL-M-013,CERT-M-013,Fictional Parlour C,Fictional Dr C,Fictional Broker 1,"210,000.00",30/10/2026,2022-11-19,Paid,FAM-M-013',
  'SYN-M-014,POL-M-014,ID-M-014,Fictional life 014,HDR-M-014,Fictional claimant 014,Fictional beneficiary 014,ACC-M-014,CELL-M-014,CERT-REUSED,Fictional Parlour A,Fictional Dr A,Fictional Broker 1,R150000,25/08/2026,2024-05-05,Paid,FAM-M-014',
  'SYN-M-015,POL-M-015,ID-M-015,Fictional life 015,HDR-M-015,Fictional claimant 015,Fictional beneficiary 015,ACC-M-015,CELL-M-015,CERT-REUSED,Fictional Parlour B,Fictional Dr B,Fictional Broker 2,175000,29/09/2026,2024-07-07,Paid,FAM-M-015',
  'SYN-M-016,POL-M-016,ID-M-016,Fictional life 016,HDR-M-016,Fictional claimant 016,Fictional beneficiary 016,ACC-M-016,CELL-M-016,CERT-REUSED,Fictional Parlour C,Fictional Dr C,Fictional Broker 1,160000,15/11/2026,2024-09-09,Paid,FAM-M-016',
  'SYN-M-017,POL-M-017,ID-M-017,Fictional life 017,HDR-M-017,Fictional claimant 017,Fictional beneficiary 017,ACC-M-017,CELL-M-017,CERT-M-017,Fictional Parlour A,Fictional Dr A,Fictional Broker X,R 400 000,20/10/2026,01/08/2026,Paid,FAM-M-017',
  ',POL-M-018,ID-M-018,Fictional life 018,HDR-M-018,Fictional claimant 018,Fictional beneficiary 018,ACC-M-018,CELL-M-018,CERT-M-018,Fictional Parlour A,Fictional Dr A,Fictional Broker 2,90000,2026-09-19,2024-01-01,Paid,FAM-M-018',
  'SYN-M-019,POL-M-019,ID-M-019,Fictional life 019,HDR-M-019,Fictional claimant 019,Fictional beneficiary 019,ACC-M-019,CELL-M-019,CERT-M-019,Fictional Parlour B,Fictional Dr B,Fictional Broker 1,,2026-07-21,2024-01-01,Paid,FAM-M-019',
  'SYN-M-020,POL-M-020,ID-M-020,Fictional life 020,HDR-M-020,Fictional claimant 020,Fictional beneficiary 020,ACC-M-020,CELL-M-020,CERT-M-020,Fictional Parlour C,Fictional Dr C,Fictional Broker 2,85000,,2024-01-01,Paid,FAM-M-020',
];
writeFileSync('/tmp/messy-6month-claims.csv', HEADER + '\n' + ROWS.join('\n') + '\n');

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Claims Export');
ws.addRow(['Fictional Insurer Ltd - claims export Jun-Nov 2026 - SYNTHETIC']);
ws.addRow([]);
ws.addRow([
  'Claim No', 'Policy #', 'Deceased Name', 'Claimant Full Name', 'Beneficiary',
  'Acc No', 'Cell', 'Death Certificate No', 'Broker', 'Amount Paid (R)',
  'Date of Loss', 'Policy Start', 'Claim Status', 'Family',
]);
const add = (vals) => ws.addRow(vals);
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
add(['SYN-X-009', 'POL-X-009', 'Fictional life 009', 'Fictional claimant 009', 'Fictional beneficiary 009', 'ACC-X-009', 'CELL-X-009', 'CERT-X-009', 'Fictional Broker 1', 'R 300 000', new Date(Date.UTC(2026, 9, 5)), new Date(Date.UTC(2024, 0, 20)), 'Paid', 'FAM-X-009']);
add(['SYN-X-009', 'POL-X-009', 'Fictional life 009', 'Fictional claimant 009', 'Fictional beneficiary 009', 'ACC-X-009', 'CELL-X-009', 'CERT-X-009', 'Fictional Broker 1', 'R 300 000', new Date(Date.UTC(2026, 9, 6)), new Date(Date.UTC(2024, 0, 20)), 'Paid', 'FAM-X-009']);
add(['SYN-X-010', 'POL-X-010', 'Fictional life 010', 'Fictional claimant 010', 'Fictional beneficiary 010', 'ACC-X-MULE', 'CELL-X-010', 'CERT-X-010', 'Fictional Broker 2', 180000, '14/08/2026', '2023-06-01', 'Paid', 'FAM-X-010']);
add(['SYN-X-011', 'POL-X-011', 'Fictional life 011', 'Fictional claimant 011', 'Fictional beneficiary 011', 'ACC-X-MULE', 'CELL-X-011', 'CERT-X-011', 'Fictional Broker 1', 205000, '2026-10-30', '2022-11-19', 'Paid', 'FAM-X-011']);
add(['', 'POL-X-012', 'Fictional life 012', 'Fictional claimant 012', 'Fictional beneficiary 012', 'ACC-X-012', 'CELL-X-012', 'CERT-X-012', 'Fictional Broker 2', 95000, new Date(Date.UTC(2026, 8, 19)), new Date(Date.UTC(2024, 0, 1)), 'Paid', 'FAM-X-012']);
add(['SYN-X-013', 'POL-X-013', 'Fictional life 013', 'Fictional claimant 013', 'Fictional beneficiary 013', 'ACC-X-013', 'CELL-X-013', 'CERT-X-013', 'Fictional Broker 1', '', new Date(Date.UTC(2026, 6, 21)), new Date(Date.UTC(2024, 0, 1)), 'Paid', 'FAM-X-013']);
add(['SYN-X-001', 'POL-X-001', 'Fictional life 001', 'Fictional claimant 001', 'Fictional beneficiary 001', 'ACC-X-001', 'CELL-X-001', 'CERT-X-001', 'Fictional Broker 1', 110000, new Date(Date.UTC(2026, 5, 10)), new Date(Date.UTC(2024, 1, 15)), 'Paid', 'FAM-X-001']);
const out = await wb.xlsx.writeBuffer();
writeFileSync('/tmp/messy-6month-claims.xlsx', Buffer.from(out));
console.log('wrote /tmp/messy-6month-claims.csv and /tmp/messy-6month-claims.xlsx');
