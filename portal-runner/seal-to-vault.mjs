// Seals portal-runner screenshots into the NahaShield Evidence Vault.
// Reviewer approval is REQUIRED before sealing (accepted contract amendment):
// a consumed, single-use approval token bound to this exact run report digest
// and claim ref must exist in the reviewer's security state. Without it this
// script refuses to seal. Original image bytes are uploaded unchanged and the
// Vault records their binary SHA-256, linking bytes to the sealed metadata.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.WORKER_ROOT || process.cwd();
const EVIDENCE = process.env.EVIDENCE_DIR || path.join(ROOT, 'evidence');
const REVIEWER_DATA = process.env.REVIEWER_DATA_DIR || path.join(ROOT, 'data');
const NAHASHIELD = process.env.NAHASHIELD_ORIGIN || 'http://127.0.0.1:4311';
const ROLE = process.env.NAHASHIELD_ROLE || 'head_of_forensics';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const token = arg('--approval-token');
const caseRef = arg('--case') || process.env.PORTAL_RUNNER_CASE_REF || 'SYN-RC-004';
const reportFile = arg('--report') || path.join(EVIDENCE, 'portal-run-report.json');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (!/^SYN-[A-Z0-9-]+$/.test(caseRef)) {
  console.error('NON_SYNTHETIC_CASE_DENIED');
  process.exit(1);
}
if (!token) {
  console.error('REVIEWER_APPROVAL_REQUIRED: pass --approval-token from the reviewer UI');
  process.exit(1);
}
if (!fs.existsSync(reportFile)) {
  console.error(`RUN_REPORT_MISSING: ${reportFile}`);
  process.exit(1);
}

// Verify the human review: token consumed (review recorded), bound to this
// exact report digest and claim ref, not expired.
const securityFile = path.join(REVIEWER_DATA, 'reviewer-security.json');
if (!fs.existsSync(securityFile)) {
  console.error('REVIEWER_APPROVAL_REQUIRED: no reviewer session store found');
  process.exit(1);
}
const reviewerState = JSON.parse(fs.readFileSync(securityFile));
const reportDigest = sha256(fs.readFileSync(reportFile));
const tokenRecord = reviewerState.tokens[sha256(token)];
if (
  !tokenRecord ||
  tokenRecord.used !== true ||
  tokenRecord.claim_ref !== caseRef ||
  tokenRecord.digest !== reportDigest
) {
  console.error(
    'REVIEWER_APPROVAL_REQUIRED: no consumed approval token bound to this run report and case',
  );
  process.exit(1);
}

const shots = fs
  .readdirSync(EVIDENCE)
  .filter((f) => f.endsWith('.png'))
  .sort();
if (shots.length === 0) {
  console.error('NO_SCREENSHOTS: nothing to seal');
  process.exit(1);
}

const sealed = [];
for (const filename of shots) {
  const bytes = fs.readFileSync(path.join(EVIDENCE, filename));
  const res = await fetch(`${NAHASHIELD}/api/vault/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nahashield-role': ROLE },
    body: JSON.stringify({
      case_ref: caseRef,
      title: `Portal runner capture — ${caseRef} — ${filename}`,
      evidence_tag: 'Verified Fact',
      capture_mode: 'agent_capture',
      filename,
      mime_type: 'image/png',
      content_base64: bytes.toString('base64'),
      investigator_note: `Synthetic portal runner capture. Dated visual record only. Run report digest ${reportDigest.slice(0, 16)}…`,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error(`SEAL_FAILED for ${filename}:`, body.error || res.status);
    process.exit(1);
  }
  sealed.push({
    filename,
    binary_sha256: sha256(bytes),
    evidence_id: body.item.evidence_id,
    chain_hash: body.item.chain_hash,
    vault_binary_sha256: body.item.attachment_meta?.binary_sha256,
    chain_valid: body.verification.valid,
  });
}

console.log(
  JSON.stringify(
    {
      sealed_count: sealed.length,
      case_ref: caseRef,
      report_digest: reportDigest,
      reviewer_principal: tokenRecord.principal,
      all_bytes_match: sealed.every((s) => s.binary_sha256 === s.vault_binary_sha256),
      chain_valid: sealed.every((s) => s.chain_valid),
      sealed,
    },
    null,
    2,
  ),
);
