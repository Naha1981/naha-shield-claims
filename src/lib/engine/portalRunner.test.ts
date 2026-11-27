import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLoopbackHttpUrl,
  buildHumanApprovalHold,
  canonicalJson,
  computeFilledFieldsDigest,
  isUrlWithinNetworkPolicy,
  validateCaptureJob,
  type CaptureJob,
} from './captureExecutor';
import {
  buildPortalSubmissionHold,
  buildScreenshotContentSummary,
  PORTAL_RUNNER_EVIDENCE_TAG,
  PORTAL_RUNNER_SOURCE_ADAPTER,
  sealPortalRunEvidence,
} from './portalRunner';
import { verifyEvidenceChain } from './vault';
import { DATED_VISUAL_RECORD_DISCLAIMER } from './claimsAgents';
import type { CaptureScreenshotArtifact } from './captureExecutor';

const SHOTS: CaptureScreenshotArtifact[] = [
  {
    filename: '01-case-opened.png',
    sha256: 'a'.repeat(64),
    byte_size: 1024,
    captured_at: '2026-11-27T09:00:00.000Z',
  },
  {
    filename: '02-draft-filled.png',
    sha256: 'b'.repeat(64),
    byte_size: 2048,
    captured_at: '2026-11-27T09:00:05.000Z',
  },
];

function baseJob(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    job_id: 'job-1',
    kind: 'portal_run',
    target_url: 'http://127.0.0.1:4311/recovery',
    network_policy: {
      allowed_origins: ['http://127.0.0.1:4311'],
      allowed_methods: ['GET', 'HEAD'],
    },
    case_ref: 'SYN-RC-004',
    requested_by: 'unit-test',
    ...overrides,
  };
}

test('loopback guard accepts http loopback portal targets', () => {
  assert.equal(assertLoopbackHttpUrl('http://127.0.0.1:4311/recovery').hostname, '127.0.0.1');
  assert.equal(assertLoopbackHttpUrl('http://localhost:4311/').hostname, 'localhost');
});

test('loopback guard denies every non-loopback or non-http target', () => {
  for (const url of [
    'https://claims.real-insurer.co.za/submit',
    'http://192.168.1.10:4311/',
    'http://169.254.169.254/latest',
    'ftp://127.0.0.1:4311/',
    'https://127.0.0.1:4311/',
    'not a url',
  ]) {
    assert.throws(() => assertLoopbackHttpUrl(url), /PORTAL_URL_DENIED/);
  }
});

test('portal_run job with loopback policy and allowlisted actions validates', () => {
  const job = baseJob({
    actions: [
      { type: 'open_case', case_ref: 'SYN-RC-004' },
      { type: 'read_page' },
      { type: 'fill_draft_field', field: 'decision-note', value: 'Draft only.' },
      { type: 'click_safe_button', button_name: 'Generate Attorney / AFU Handover Pack' },
      { type: 'save_checkpoint' },
      { type: 'request_final_submission' },
    ],
  });
  const result = validateCaptureJob(job);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test('portal_run job is denied for external origins, write methods and real case refs', () => {
  const external = validateCaptureJob(
    baseJob({
      target_url: 'https://claims.real-insurer.co.za/submit',
      network_policy: {
        allowed_origins: ['https://claims.real-insurer.co.za'],
        allowed_methods: ['GET', 'HEAD'],
      },
    }),
  );
  assert.equal(external.ok, false);
  assert.ok(external.violations.some((v) => v.includes('loopback')));

  const writeMethod = validateCaptureJob(
    baseJob({
      network_policy: {
        allowed_origins: ['http://127.0.0.1:4311'],
        // Intentionally hostile policy; type widened to prove runtime guard.
        allowed_methods: ['GET', 'POST'] as unknown as CaptureJob['network_policy']['allowed_methods'],
      },
    }),
  );
  assert.equal(writeMethod.ok, false);
  assert.ok(writeMethod.violations.some((v) => v.includes('POST')));

  const realCase = validateCaptureJob(baseJob({ case_ref: 'REAL-CLAIM-991' }));
  assert.equal(realCase.ok, false);
  assert.ok(realCase.violations.some((v) => v.includes('REAL-CLAIM-991')));

  const targetOutside = validateCaptureJob(
    baseJob({ target_url: 'http://127.0.0.1:9999/other' }),
  );
  assert.equal(targetOutside.ok, false);
  assert.ok(targetOutside.violations.some((v) => v.includes('allowed_origins')));
});

test('off-allowlist draft fields and buttons are denied', () => {
  const result = validateCaptureJob(
    baseJob({
      actions: [
        { type: 'fill_draft_field', field: 'reviewer', value: 'Forged signer' },
        { type: 'click_safe_button', button_name: 'Record Signed Human Decision' },
      ],
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
});

test('map_capture allows capture_url inside the policy and denies fills, clicks and outside origins', () => {
  const mapJob = baseJob({
    kind: 'map_capture',
    target_url: 'https://cdn.kartaview.org/img/1',
    network_policy: {
      allowed_origins: ['https://cdn.kartaview.org', 'https://tiles.openfreemap.org'],
      allowed_methods: ['GET'],
    },
    case_ref: undefined,
  });
  const ok = validateCaptureJob({
    ...mapJob,
    actions: [
      { type: 'capture_url', url: 'https://cdn.kartaview.org/img/1' },
      { type: 'read_page' },
      { type: 'save_checkpoint' },
    ],
  });
  assert.deepEqual(ok.violations, []);

  const denied = validateCaptureJob({
    ...mapJob,
    actions: [
      { type: 'capture_url', url: 'https://evil.example.org/x.png' },
      { type: 'fill_draft_field', field: 'decision-note', value: 'x' },
      { type: 'click_safe_button', button_name: 'Generate Attorney / AFU Handover Pack' },
      { type: 'request_final_submission' },
    ],
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.violations.length, 4);
  assert.ok(denied.violations[0].includes('evil.example.org'));
});

test('map_capture kind validates against its own origin allowlist', () => {
  const result = validateCaptureJob(
    baseJob({
      kind: 'map_capture',
      target_url: 'https://tiles.example.invalid/map.png',
      network_policy: {
        allowed_origins: ['https://tiles.example.invalid'],
        allowed_methods: ['GET'],
      },
      case_ref: undefined,
    }),
  );
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test('network policy membership check is origin-exact', () => {
  const policy = {
    allowed_origins: ['http://127.0.0.1:4311'],
    allowed_methods: ['GET'] as Array<'GET'>,
  };
  assert.equal(isUrlWithinNetworkPolicy('http://127.0.0.1:4311/recovery', policy), true);
  assert.equal(isUrlWithinNetworkPolicy('http://127.0.0.1:4312/recovery', policy), false);
  assert.equal(isUrlWithinNetworkPolicy('https://127.0.0.1:4311/recovery', policy), false);
});

test('filled-fields digest is canonical and stable across key order', () => {
  const a = computeFilledFieldsDigest({ x: '1', y: '2' });
  const b = computeFilledFieldsDigest({ y: '2', x: '1' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: [2, { a: 1 }], a: null }), '{"a":null,"b":[2,{"a":1}]}');
});

test('final submission always resolves to a human-approval hold', () => {
  const hold = buildHumanApprovalHold({ job_id: 'job-1', case_ref: 'SYN-RC-004' });
  assert.equal(hold.status, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(hold.submitted, false);

  const runHold = buildPortalSubmissionHold({
    run_id: 'run-1',
    case_ref: 'SYN-RC-004',
    checkpoint: {
      job_id: 'job-1',
      case_ref: 'SYN-RC-004',
      url: 'http://127.0.0.1:4311/recovery',
      status: 'WAITING_HUMAN_APPROVAL',
      fields: { 'decision-note': 'Draft only.' },
      digest: computeFilledFieldsDigest({ 'decision-note': 'Draft only.' }),
      at: '2026-11-27T09:00:06.000Z',
    },
  });
  assert.equal(runHold.status, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(runHold.submitted, false);
  assert.match(runHold.checkpoint_digest ?? '', /^[0-9a-f]{64}$/);
});

test('sealed screenshots form a valid Evidence Vault chain and carry the visual-record disclaimer', () => {
  const items = sealPortalRunEvidence({
    run_id: 'run-1',
    case_ref: 'SYN-RC-004',
    org_id: 'org_sa_partner_01',
    uploader_id: 'usr_forensics_01',
    screenshots: SHOTS,
    step_labels: ['case-opened', 'draft-filled'],
    created_at: '2026-11-27T09:00:10.000Z',
  });

  assert.equal(items.length, 2);
  const verification = verifyEvidenceChain(items);
  assert.equal(verification.valid, true);
  assert.equal(verification.checked_count, 2);

  for (const item of items) {
    assert.equal(item.evidence_tag, PORTAL_RUNNER_EVIDENCE_TAG);
    assert.equal(item.source_adapter, PORTAL_RUNNER_SOURCE_ADAPTER);
    assert.ok(item.content_summary.includes(DATED_VISUAL_RECORD_DISCLAIMER));
    assert.ok(item.content_summary.includes('Synthetic-only'));
    assert.equal(item.attachment_meta?.capture_mode, 'agent_capture');
    assert.equal(item.attachment_meta?.mime_type, 'image/png');
    assert.equal(item.custody_log[0].action, 'SEALED_INGESTED_AGENT_CAPTURE');
  }
  assert.equal(items[1].prev_chain_hash, items[0].chain_hash);
});

test('vault chain detects tampering with a sealed screenshot record', () => {
  const items = sealPortalRunEvidence({
    run_id: 'run-1',
    case_ref: 'SYN-RC-004',
    org_id: 'org_sa_partner_01',
    uploader_id: 'usr_forensics_01',
    screenshots: SHOTS,
    created_at: '2026-11-27T09:00:10.000Z',
  });
  const tampered = items.map((item, idx) =>
    idx === 0 ? { ...item, content_summary: `${item.content_summary} altered` } : item,
  );
  const verification = verifyEvidenceChain(tampered);
  assert.equal(verification.valid, false);
  assert.equal(verification.failed_evidence_id, items[0].evidence_id);
});

test('content summary is deterministic for identical inputs', () => {
  const first = buildScreenshotContentSummary({
    run_id: 'run-1',
    case_ref: 'SYN-RC-004',
    step_label: 'case-opened',
    shot: SHOTS[0],
  });
  const second = buildScreenshotContentSummary({
    run_id: 'run-1',
    case_ref: 'SYN-RC-004',
    step_label: 'case-opened',
    shot: SHOTS[0],
  });
  assert.equal(first, second);
});
