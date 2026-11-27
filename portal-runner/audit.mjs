// Ported from the isolated morning build (claims-worker-step1/audit.mjs).
// Change from original: agent/actor/claim_ref defaults come from env and may be
// overridden per event; paths are env-driven. Hash-chain semantics unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.WORKER_ROOT || process.cwd();
const EVIDENCE = process.env.EVIDENCE_DIR || path.join(ROOT, 'evidence');
const FILE = path.join(EVIDENCE, 'worker-audit.jsonl');
const GENESIS = '0'.repeat(64);

export function appendAudit(event) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const rows = fs.existsSync(FILE)
    ? fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const prev = rows.length ? JSON.parse(rows.at(-1)).hash : GENESIS;
  const record = {
    seq: rows.length + 1,
    recorded_at: new Date().toISOString(),
    agent: 'Synthetic Portal Runner (isolated)',
    claim_ref: process.env.PORTAL_RUNNER_CASE_REF || 'SYN-RC-004',
    actor: 'portal-runner',
    ...event,
    previous_hash: prev,
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
  fs.appendFileSync(FILE, JSON.stringify({ ...record, hash }) + '\n');
  return hash;
}

export function auditHeadHash() {
  if (!fs.existsSync(FILE)) return GENESIS;
  const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
  return rows.length ? JSON.parse(rows.at(-1)).hash : GENESIS;
}

export function verifyAudit(rows) {
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const { hash, ...record } = rows[i];
    if (
      record.seq !== i + 1 ||
      record.previous_hash !== prev ||
      crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex') !== hash
    ) {
      return { valid: false, failed: i + 1 };
    }
    prev = hash;
  }
  return { valid: true, count: rows.length, head: prev };
}
