import { DATED_VISUAL_RECORD_DISCLAIMER } from './claimsAgents';
import {
  computeChainHash,
  computeContentHash,
  GENESIS_CHAIN_HASH,
} from './vault';
import type { IngestedAttachmentMeta } from './evidenceIngestion';
import type { EvidenceItemRecord, EvidenceTag } from './types';
import type { CaptureScreenshotArtifact } from './captureExecutor';

/**
 * Synthetic Portal Runner — Evidence Vault bridge.
 *
 * Pure functions that seal the isolated portal runner's screenshots and
 * checkpoints into the append-only Evidence Vault hash chain, offline (no
 * server required). The live path posts the same artifacts to
 * POST /api/vault/ingest with capture_mode 'agent_capture'; both paths produce
 * identical provenance semantics. See docs/portal-runner-integration-contract.md.
 */

export const PORTAL_RUNNER_AGENT_ID = 'synthetic_portal_runner';

export const PORTAL_RUNNER_SOURCE_ADAPTER =
  'SIMULATED ADAPTER (Synthetic Portal Runner)';

/**
 * Screenshots record what the runner saw and did at a time — a verifiable
 * operational fact of the run. They remain dated visual records only, never
 * proof of ownership, occupancy or fraud, and the disclaimer is embedded in
 * every sealed summary.
 */
export const PORTAL_RUNNER_EVIDENCE_TAG: EvidenceTag = 'Verified Fact';

export const PORTAL_RUNNER_ACCESS_AUTHORITY =
  'Owner-authorised fictional SYN case test only; no real SIU mandate asserted';

export interface PortalRunCheckpoint {
  job_id: string;
  case_ref: string;
  url: string;
  status: 'WAITING_HUMAN_APPROVAL';
  fields: Record<string, string>;
  digest: string;
  at: string;
}

export interface PortalRunStep {
  step: string;
  at: string;
  detail: string;
}

export interface PortalRunManifest {
  run_id: string;
  job_id: string;
  case_ref: string;
  portal_origin: string;
  synthetic_only: true;
  /** Always false — the runner stops at final submit for human approval. */
  submitted: false;
  steps: PortalRunStep[];
  screenshots: CaptureScreenshotArtifact[];
  checkpoint: PortalRunCheckpoint | null;
  created_at: string;
}

export function buildScreenshotContentSummary(params: {
  run_id: string;
  case_ref: string;
  step_label: string;
  shot: CaptureScreenshotArtifact;
}): string {
  const { shot } = params;
  return (
    `[Agent Portal Capture · Synthetic Portal Runner] Run ${params.run_id}, ` +
    `step "${params.step_label}", synthetic case ${params.case_ref}. ` +
    `File "${shot.filename}" (${shot.byte_size} B, binary SHA-256 ${shot.sha256.slice(0, 16)}…). ` +
    `Captured ${shot.captured_at}. ${DATED_VISUAL_RECORD_DISCLAIMER} ` +
    `Synthetic-only training capture against an isolated loopback portal — no live portal, no submission.`
  );
}

function buildScreenshotAttachmentMeta(params: {
  shot: CaptureScreenshotArtifact;
  case_ref: string;
}): IngestedAttachmentMeta {
  return {
    filename: params.shot.filename,
    mime_type: 'image/png',
    byte_size: params.shot.byte_size,
    binary_sha256: params.shot.sha256,
    capture_mode: 'agent_capture',
    document_class: 'Insurance Document / Statement',
    pii_redactions_count: 0,
    extracted_refs: [params.case_ref],
    record_count: null,
  };
}

/**
 * Seals every screenshot of a portal run into Evidence Vault items, chained in
 * capture order. Deterministic given identical inputs (pass a fixed created_at
 * in tests). Items are ready to append to store.state.evidence_items or to
 * compare against POST /api/vault/ingest output.
 */
export function sealPortalRunEvidence(params: {
  run_id: string;
  case_ref: string;
  org_id: string;
  uploader_id: string;
  screenshots: CaptureScreenshotArtifact[];
  step_labels?: string[];
  prev_chain_hash?: string;
  created_at?: string;
  evidence_id_prefix?: string;
}): EvidenceItemRecord[] {
  const items: EvidenceItemRecord[] = [];
  let prevChainHash = params.prev_chain_hash ?? GENESIS_CHAIN_HASH;
  const createdAt = params.created_at ?? new Date().toISOString();
  const idPrefix = params.evidence_id_prefix ?? `EVD-RUN-${params.run_id}`;

  params.screenshots.forEach((shot, index) => {
    const stepLabel =
      params.step_labels?.[index] ?? `capture-${String(index + 1).padStart(2, '0')}`;
    const evidenceId = `${idPrefix}-${String(index + 1).padStart(2, '0')}`;
    const contentSummary = buildScreenshotContentSummary({
      run_id: params.run_id,
      case_ref: params.case_ref,
      step_label: stepLabel,
      shot,
    });
    const sha256Content = computeContentHash(contentSummary);
    const chainHash = computeChainHash({
      prev_chain_hash: prevChainHash,
      sha256_content: sha256Content,
      evidence_id: evidenceId,
      org_id: params.org_id,
      case_ref: params.case_ref,
      evidence_tag: PORTAL_RUNNER_EVIDENCE_TAG,
      uploader_id: params.uploader_id,
      created_at: createdAt,
    });

    items.push({
      evidence_id: evidenceId,
      org_id: params.org_id,
      case_ref: params.case_ref,
      title: `Portal runner capture — ${params.case_ref} — ${stepLabel}`.slice(0, 120),
      content_summary: contentSummary,
      evidence_tag: PORTAL_RUNNER_EVIDENCE_TAG,
      source_adapter: PORTAL_RUNNER_SOURCE_ADAPTER,
      sha256_content: sha256Content,
      prev_chain_hash: prevChainHash,
      chain_hash: chainHash,
      uploader_id: params.uploader_id,
      access_authority: PORTAL_RUNNER_ACCESS_AUTHORITY,
      custody_log: [
        {
          actor: params.uploader_id,
          action: 'SEALED_INGESTED_AGENT_CAPTURE',
          ts: createdAt,
        },
      ],
      created_at: createdAt,
      attachment_meta: buildScreenshotAttachmentMeta({
        shot,
        case_ref: params.case_ref,
      }),
    });

    prevChainHash = chainHash;
  });

  return items;
}

export interface PortalSubmissionHold {
  status: 'HUMAN_APPROVAL_REQUIRED';
  submitted: false;
  run_id: string;
  case_ref: string;
  checkpoint_digest: string | null;
  message: string;
}

/**
 * The runner's terminal state for every run: a human-review hold. No code
 * path in the runner performs a final submit.
 */
export function buildPortalSubmissionHold(params: {
  run_id: string;
  case_ref: string;
  checkpoint?: PortalRunCheckpoint | null;
}): PortalSubmissionHold {
  return {
    status: 'HUMAN_APPROVAL_REQUIRED',
    submitted: false,
    run_id: params.run_id,
    case_ref: params.case_ref,
    checkpoint_digest: params.checkpoint?.digest ?? null,
    message:
      'Final submission was not performed. The exact case, filled draft and screenshots must be approved by a human reviewer; the runner has no submit capability.',
  };
}
