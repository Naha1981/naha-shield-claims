import express from 'express';
import { analyseLeakage, demoCsv } from '../src/lib/engine/leakageEngine';

// Retrospective claims-file leakage review routes.
// Read-only and in-memory: an uploaded CSV is analysed and discarded. Nothing is
// stored, shared or actioned. Every finding is a lead for a human investigator.

export * from '../src/lib/engine/leakageEngine';

export function leakageRoutes() {
  const r = express.Router();
  r.get('/demo', (_req, res) => {
    res.json({ file_name: 'synthetic-6-month-claims-demo.csv', synthetic: true, ...analyseLeakage(demoCsv()) });
  });
  r.post('/analyse', (req, res) => {
    const csv = String(req.body?.csv ?? '');
    if (!csv.trim()) return res.status(400).json({ error: 'CSV text is required' });
    if (csv.length > 4_000_000) return res.status(413).json({ error: 'File too large for this preview (4 MB)' });
    try {
      res.json({ file_name: String(req.body?.file_name ?? 'uploaded.csv'), synthetic: false, ...analyseLeakage(csv) });
    } catch (e) {
      res.status(400).json({ error: 'Could not parse CSV: ' + (e as Error).message });
    }
  });
  return r;
}
