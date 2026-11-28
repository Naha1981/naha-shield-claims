import express from 'express';
import { analyseLeakage, analyseRows, demoCsv, parseCsv } from '../src/lib/engine/leakageEngine';
import { ingestCsvText, ingestClaimRows } from '../src/lib/engine/claimsFileIngest';
import { rowsFromXlsx } from './claimsFileParse';

// Retrospective claims-file leakage review routes.
// Read-only and in-memory: an uploaded file is analysed and discarded. Nothing
// is stored, shared or actioned. Every finding is a lead for a human
// investigator. CSV and Excel (.xlsx) insurer exports are accepted; messy
// column names, gaps and duplicate rows are handled by claimsFileIngest.

export * from '../src/lib/engine/leakageEngine';

const MAX_CSV_CHARS = 6_000_000;
const MAX_FILE_BASE64_CHARS = 14_000_000; // about 10 MB decoded

export function leakageRoutes() {
  const r = express.Router();

  r.get('/demo', (_req, res) => {
    res.json({ file_name: 'sample-6-month-claims.csv', synthetic: true, ...analyseLeakage(demoCsv()) });
  });

  r.post('/analyse', (req, res) => {
    const csv = String(req.body?.csv ?? '');
    if (!csv.trim()) return res.status(400).json({ error: 'CSV text is required' });
    if (csv.length > MAX_CSV_CHARS) return res.status(413).json({ error: 'File too large for this preview (6 MB of text)' });
    const fileName = String(req.body?.file_name ?? 'uploaded.csv');
    try {
      const { rows, report } = ingestCsvText(csv, fileName, parseCsv);
      res.json({ file_name: fileName, synthetic: false, format: 'csv', ingest_report: report, ...analyseRows(rows) });
    } catch (e) {
      res.status(400).json({ error: 'Could not read this file: ' + (e as Error).message });
    }
  });

  r.post('/analyse-file', async (req, res) => {
    const fileName = String(req.body?.file_name ?? 'uploaded.xlsx');
    const b64 = String(req.body?.content_base64 ?? '');
    if (!b64) return res.status(400).json({ error: 'File content is required' });
    if (b64.length > MAX_FILE_BASE64_CHARS) return res.status(413).json({ error: 'File too large for this preview (10 MB)' });
    if (!/\.(xlsx|xlsm)$/i.test(fileName)) {
      return res.status(400).json({ error: 'Only Excel .xlsx workbooks are accepted on this route; save other formats as CSV and use the CSV upload.' });
    }
    try {
      const buffer = Buffer.from(b64, 'base64');
      const sheet = await rowsFromXlsx(buffer, req.body?.sheet ? String(req.body.sheet) : undefined);
      const { rows, report } = ingestClaimRows(sheet.headers, sheet.rows, fileName);
      res.json({
        file_name: fileName,
        synthetic: false,
        format: 'xlsx',
        sheet_name: sheet.sheet_name,
        ingest_report: report,
        ...analyseRows(rows),
      });
    } catch (e) {
      res.status(400).json({ error: 'Could not read this workbook: ' + (e as Error).message });
    }
  });

  return r;
}
