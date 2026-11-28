import test from 'node:test';
import assert from 'node:assert/strict';
import { tableTextToRows, pdfToText, documentToRows, tsvToColumnText } from './documentClaimsParse';

// Text shapes a PDF text layer or OCR would produce. All values fictional.

test('tableTextToRows reads a pipe-separated table', () => {
  const text = [
    'Fictional Insurer claims export - SYNTHETIC',
    'Claim No | Claimant | Amount Paid (R) | Date of Loss',
    'PDF-T-1 | Fictional claimant 1 | R 200 000 | 2026-10-05',
    'PDF-T-2 | Fictional claimant 2 | R 95 000 | 05/11/2026',
  ].join('\n');
  const { headers, rows } = tableTextToRows(text);
  assert.ok(headers.includes('Claim No'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Claim No'], 'PDF-T-1');
  assert.equal(rows[1]['Amount Paid (R)'], 'R 95 000');
});

test('tableTextToRows reads whitespace-aligned columns (OCR output shape)', () => {
  const text = [
    'Claim No     Claimant              Amount Paid (R)   Date of Loss',
    'PDF-T-3      Fictional claimant 3  R 150 000         2026-08-14',
  ].join('\n');
  const { rows } = tableTextToRows(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Claim No'], 'PDF-T-3');
});

test('tableTextToRows skips preamble lines before the header', () => {
  const text = ['CONFIDENTIAL - FICTIONAL', 'Page 1 of 1', 'Claim No,Amount Paid (R),Date of Loss', 'PDF-T-4,R 1,2026-06-01'].join('\n');
  const { rows } = tableTextToRows(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Claim No'], 'PDF-T-4');
});

test('tableTextToRows refuses a document with no claims table, in plain language', () => {
  assert.throws(() => tableTextToRows('Dear sir,\nThis letter is about something else entirely.'), /No claims table found/);
});

// A real PDF built in memory with jspdf (open source): the same layout an
// insurer export PDF has. This proves the text-layer path end to end without
// storing any fixture file.
async function buildClaimsPdf(): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.setFontSize(10);
  doc.text('Fictional Insurer - claims export - SYNTHETIC', 10, 12);
  const cols = [10, 60, 110, 160];
  const header = ['Claim No', 'Claimant', 'Amount Paid (R)', 'Date of Loss'];
  header.forEach((h, i) => doc.text(h, cols[i], 24));
  const data = [
    ['PDF-T-5', 'Fictional claimant 5', 'R 200 000', '2026-10-05'],
    ['PDF-T-6', 'Fictional claimant 6', 'R 175 000', '2026-11-02'],
  ];
  data.forEach((row, r) => row.forEach((cell, i) => doc.text(cell, cols[i], 36 + r * 12)));
  return Buffer.from(doc.output('arraybuffer'));
}

test('pdfToText + tableTextToRows read a generated claims PDF', async () => {
  const buffer = await buildClaimsPdf();
  const text = await pdfToText(buffer);
  assert.ok(text.includes('Claim No'));
  const { rows } = tableTextToRows(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Claim No'], 'PDF-T-5');
  assert.equal(rows[1]['Amount Paid (R)'], 'R 175 000');
});

test('documentToRows routes PDFs through the text layer', async () => {
  const buffer = await buildClaimsPdf();
  const result = await documentToRows(buffer, 'claims.pdf');
  assert.equal(result.kind, 'pdf-text');
  assert.equal(result.rows.length, 2);
});

test('documentToRows gives a plain instruction for scanned PDFs without a text layer', async () => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.text('', 10, 10); // no table text: like a scan wrapper
  const buffer = Buffer.from(doc.output('arraybuffer'));
  await assert.rejects(() => documentToRows(buffer, 'scan.pdf'), /no readable text layer/i);
});

test('tsvToColumnText rebuilds columns from word coordinates', () => {
  // TSV shape tesseract returns: word rows with block-par-line and x/y.
  // Word gaps ~20px, column gaps 90px+. Fictional values.
  const head = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const word = (line: number, left: number, text: string, width = 60) => `5\t1\t1\t2\t${line}\t1\t${left}\t${line * 40}\t${width}\t20\t96\t${text}`;
  const tsv = [head,
    word(1, 30, 'Claim'), word(1, 110, 'No', 30), word(1, 230, 'Claimant', 90), word(1, 420, 'Amount'), word(1, 500, 'Paid'), word(1, 570, '(R)', 40), word(1, 720, 'Date', 40), word(1, 775, 'of', 20), word(1, 810, 'Loss', 40),
    word(2, 30, 'SYN-IMG-1', 110), word(2, 230, 'Fictional'), word(2, 310, 'claimant'), word(2, 470, 'R', 20), word(2, 500, '200'), word(2, 550, '000'), word(2, 720, '2026-10-05', 100),
    word(3, 30, 'SYN-IMG-2', 110), word(3, 230, 'Fictional'), word(3, 310, 'claimant'), word(3, 470, 'R', 20), word(3, 500, '175'), word(3, 550, '000'), word(3, 720, '2026-11-02', 100),
  ].join('\n');
  const text = tsvToColumnText(tsv);
  const { rows } = tableTextToRows(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Claim No'], 'SYN-IMG-1');
  assert.equal(rows[0]['Amount Paid (R)'], 'R 200 000');
  assert.equal(rows[1]['Date of Loss'], '2026-11-02');
});

test('documentToRows rejects unsupported types', async () => {
  await assert.rejects(() => documentToRows(Buffer.from('x'), 'notes.docx'), /Supported documents/);
});
