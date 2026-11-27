import { createHash } from 'node:crypto';

/**
 * Shared Capture Executor contract.
 *
 * One hosted isolated browser worker (one Chromium, serialized jobs, sized for
 * a 512 MB service) serves every browser-capture flow in NahaShield:
 * synthetic portal runs, open-map captures and address captures. The executor
 * enforces the safety invariants itself; callers never enforce them.
 *
 * This module is the pure, dependency-free half of the contract: job/result
 * envelopes, network-policy validation and deterministic digests. The runnable
 * executor lives in portal-runner/ (computer-mcp.mjs, ported from the
 * isolated morning build).
 */

export type CaptureJobKind = 'portal_run' | 'map_capture' | 'address_capture';

export type CaptureActionType =
  | 'open_case'
  | 'read_page'
  | 'fill_draft_field'
  | 'click_safe_button'
  | 'save_checkpoint'
  | 'screenshot'
  | 'capture_url'
  | 'request_final_submission';

export type CaptureMethod = 'GET' | 'HEAD';

export interface CaptureNetworkPolicy {
  allowed_origins: string[];
  allowed_methods: CaptureMethod[];
}

export interface CaptureAction {
  type: CaptureActionType;
  case_ref?: string;
  field?: string;
  value?: string;
  button_name?: string;
  /** Optional CSS selector for `screenshot` actions (image captures). */
  selector?: string;
  /** Server-selected URL for `capture_url` actions; origin must be inside the job network_policy. */
  url?: string;
  wait_ms?: number;
}

export interface CaptureJob {
  job_id: string;
  kind: CaptureJobKind;
  target_url: string;
  network_policy: CaptureNetworkPolicy;
  case_ref?: string;
  viewport?: { width: number; height: number };
  actions?: CaptureAction[];
  requested_by: string;
}

export interface CaptureScreenshotArtifact {
  filename: string;
  sha256: string;
  byte_size: number;
  captured_at: string;
}

export type CaptureJobStatus =
  | 'completed'
  | 'awaiting_human_approval'
  | 'denied'
  | 'failed';

export interface CaptureResult {
  job_id: string;
  status: CaptureJobStatus;
  screenshots: CaptureScreenshotArtifact[];
  filled_fields_digest: string | null;
  /** Always false. The executor physically cannot submit. */
  submitted: false;
  denial_reason: string | null;
  /** Head hash of the executor's append-only sha256-chained audit log. */
  audit_head_hash: string;
}

export const CAPTURE_EXECUTOR_INVARIANTS: readonly string[] = [
  'Exactly one Chromium instance; capture jobs are strictly serialized (FIFO), one page at a time.',
  'Every network request outside the job network_policy is aborted and logged (network-denied).',
  'Only GET/HEAD ever leave the executor; every other method is aborted and logged (write-denied).',
  'Draft-field fills and button clicks are restricted to explicit per-kind allowlists.',
  'request_final_submission never clicks anything and always returns HUMAN_APPROVAL_REQUIRED.',
  'Every artifact is SHA-256 hashed and every tool call is appended to the hash-chained audit log.',
] as const;

export const SYNTHETIC_CASE_REF_PATTERN = /^SYN-[A-Z0-9-]+$/;

export const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
]);

export const CAPTURE_ACTION_TYPE_SET: ReadonlySet<CaptureActionType> = new Set([
  'open_case',
  'read_page',
  'fill_draft_field',
  'click_safe_button',
  'save_checkpoint',
  'screenshot',
  'capture_url',
  'request_final_submission',
]);

/**
 * Per-kind action policy. Image captures (map/address) can read, screenshot
 * and checkpoint only — never fill or click. Portal runs may fill whitelisted
 * draft fields and click whitelisted safe buttons, but still cannot submit.
 */
export const KIND_ACTION_POLICY: Record<CaptureJobKind, ReadonlySet<CaptureActionType>> = {
  portal_run: new Set([
    'open_case',
    'read_page',
    'fill_draft_field',
    'click_safe_button',
    'save_checkpoint',
    'screenshot',
    'capture_url',
    'request_final_submission',
  ]),
  map_capture: new Set(['open_case', 'read_page', 'save_checkpoint', 'screenshot', 'capture_url']),
  address_capture: new Set(['open_case', 'read_page', 'save_checkpoint', 'screenshot', 'capture_url']),
};

/** Required provenance metadata on every map/address screenshot record. */
export const IMAGE_CAPTURE_REQUIRED_METADATA: readonly string[] = [
  'source_url',
  'captured_at',
  'author',
  'licence',
  'distance_m_from_requested',
] as const;

export const IMAGE_CAPTURE_WATERMARK = 'ADVISORY — UNVERIFIED VISUAL RECORD';

/** Draft fields the executor may fill for a portal_run (never submitted). */
export const DEFAULT_ALLOWED_DRAFT_FIELDS: readonly string[] = [
  'decision-action',
  'decision-reasons',
  'decision-note',
];

/** Safe buttons the executor may click for a portal_run (previews only). */
export const DEFAULT_ALLOWED_SAFE_BUTTONS: readonly string[] = [
  'Generate Attorney / AFU Handover Pack',
];

export const MAX_DRAFT_FIELD_VALUE_LENGTH = 2500;

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.trim().toLowerCase());
}

/**
 * Parses a URL and fails closed unless it is plain HTTP on a loopback host.
 * This is the "no real portals" guard for portal_run jobs.
 */
export function assertLoopbackHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`PORTAL_URL_DENIED: unparseable target URL`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(
      `PORTAL_URL_DENIED: only plain http loopback targets are permitted (got ${url.protocol})`,
    );
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(
      `PORTAL_URL_DENIED: portal_run targets must be loopback (got host ${url.hostname})`,
    );
  }
  return url;
}

export function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

/** True only when the URL's origin is explicitly listed in the policy. */
export function isUrlWithinNetworkPolicy(
  rawUrl: string,
  policy: CaptureNetworkPolicy,
): boolean {
  const origin = originOf(rawUrl);
  if (!origin) return false;
  return policy.allowed_origins.includes(origin);
}

export interface CaptureJobValidation {
  ok: boolean;
  violations: string[];
}

export function validateCaptureJob(
  job: CaptureJob,
  opts?: {
    allowedDraftFields?: readonly string[];
    allowedSafeButtons?: readonly string[];
  },
): CaptureJobValidation {
  const violations: string[] = [];
  const allowedDraftFields =
    opts?.allowedDraftFields ?? DEFAULT_ALLOWED_DRAFT_FIELDS;
  const allowedSafeButtons =
    opts?.allowedSafeButtons ?? DEFAULT_ALLOWED_SAFE_BUTTONS;

  if (!job || typeof job !== 'object') {
    return { ok: false, violations: ['Job envelope missing.'] };
  }
  if (!job.job_id || typeof job.job_id !== 'string') {
    violations.push('job_id is required.');
  }
  if (
    job.kind !== 'portal_run' &&
    job.kind !== 'map_capture' &&
    job.kind !== 'address_capture'
  ) {
    violations.push(`Unknown capture kind: ${String(job.kind)}`);
  }
  if (!job.requested_by || typeof job.requested_by !== 'string') {
    violations.push('requested_by actor id is required.');
  }

  const policy = job.network_policy;
  if (!policy || !Array.isArray(policy.allowed_origins)) {
    violations.push('network_policy.allowed_origins is required.');
  } else {
    for (const method of policy.allowed_methods ?? []) {
      if (method !== 'GET' && method !== 'HEAD') {
        violations.push(
          `Write method "${method}" is never permitted in a capture network policy.`,
        );
      }
    }
    if (policy.allowed_origins.length === 0) {
      violations.push('network_policy.allowed_origins must not be empty.');
    }
    if (job.kind === 'portal_run') {
      for (const origin of policy.allowed_origins) {
        try {
          assertLoopbackHttpUrl(origin);
        } catch (err) {
          violations.push(
            `portal_run origin "${origin}" rejected: ${err instanceof Error ? err.message : 'not loopback http'}`,
          );
        }
      }
    } else {
      for (const origin of policy.allowed_origins) {
        const parsed = originOf(origin);
        if (!parsed) {
          violations.push(`Unparseable allowed origin "${origin}".`);
        }
      }
    }
  }

  const targetOrigin = originOf(String(job.target_url ?? ''));
  if (!targetOrigin) {
    violations.push('target_url is not a parseable absolute URL.');
  } else if (
    policy &&
    Array.isArray(policy.allowed_origins) &&
    !policy.allowed_origins.includes(targetOrigin)
  ) {
    violations.push(
      `target_url origin ${targetOrigin} is not inside network_policy.allowed_origins.`,
    );
  }
  if (job.kind === 'portal_run' && targetOrigin) {
    try {
      assertLoopbackHttpUrl(String(job.target_url));
    } catch (err) {
      violations.push(
        err instanceof Error ? err.message : 'portal_run target rejected.',
      );
    }
  }

  if (job.case_ref !== undefined && !SYNTHETIC_CASE_REF_PATTERN.test(job.case_ref)) {
    violations.push(
      `case_ref "${job.case_ref}" is not a synthetic reference (${SYNTHETIC_CASE_REF_PATTERN}).`,
    );
  }

  const kindPolicy =
    job.kind === 'portal_run' ||
    job.kind === 'map_capture' ||
    job.kind === 'address_capture'
      ? KIND_ACTION_POLICY[job.kind]
      : null;

  for (const action of job.actions ?? []) {
    if (!CAPTURE_ACTION_TYPE_SET.has(action.type)) {
      violations.push(`Unknown capture action type: ${String(action.type)}`);
      continue;
    }
    if (kindPolicy && !kindPolicy.has(action.type)) {
      violations.push(
        `Action ${action.type} is not permitted for kind ${job.kind}.`,
      );
      continue;
    }
    if (
      action.type === 'open_case' &&
      (!action.case_ref || !SYNTHETIC_CASE_REF_PATTERN.test(action.case_ref))
    ) {
      violations.push('open_case requires a synthetic SYN-* case_ref.');
    }
    if (action.type === 'fill_draft_field') {
      if (!action.field || !allowedDraftFields.includes(action.field)) {
        violations.push(
          `fill_draft_field field "${String(action.field)}" is not on the draft-field allowlist.`,
        );
      }
      if (
        typeof action.value !== 'string' ||
        action.value.length > MAX_DRAFT_FIELD_VALUE_LENGTH
      ) {
        violations.push(
          `fill_draft_field value must be a string of at most ${MAX_DRAFT_FIELD_VALUE_LENGTH} characters.`,
        );
      }
    }
    if (action.type === 'click_safe_button') {
      if (
        !action.button_name ||
        !allowedSafeButtons.includes(action.button_name)
      ) {
        violations.push(
          `click_safe_button "${String(action.button_name)}" is not on the safe-button allowlist.`,
        );
      }
    }
    if (action.type === 'capture_url') {
      const actionOrigin = action.url ? originOf(action.url) : null;
      if (!actionOrigin) {
        violations.push('capture_url requires a parseable absolute url.');
      } else if (
        !policy ||
        !Array.isArray(policy.allowed_origins) ||
        !policy.allowed_origins.includes(actionOrigin)
      ) {
        violations.push(
          `capture_url origin ${actionOrigin} is not inside network_policy.allowed_origins (requester-supplied origins are never honored).`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Deterministic JSON (sorted object keys) for digest stability. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$/;

/**
 * Artifacts are retrievable by job_id + filename only. Rejects traversal,
 * separators and anything outside png/json/jsonl outputs.
 */
export function assertSafeArtifactName(filename: string): string {
  if (
    !SAFE_ARTIFACT_NAME.test(filename) ||
    filename.includes('..') ||
    !/\.(png|json|jsonl)$/.test(filename)
  ) {
    throw new Error(`ARTIFACT_NAME_DENIED: ${filename}`);
  }
  return filename;
}

/** sha256 over the canonical filled-draft-field JSON (checkpoint digest). */
export function computeFilledFieldsDigest(
  fields: Record<string, string>,
): string {
  return createHash('sha256').update(canonicalJson(fields), 'utf8').digest('hex');
}

export interface HumanApprovalHold {
  status: 'HUMAN_APPROVAL_REQUIRED';
  submitted: false;
  job_id: string;
  case_ref: string | null;
  message: string;
}

/**
 * The only possible outcome of a final-submission request. The executor never
 * clicks, posts or submits; it stops here and waits for a human.
 */
export function buildHumanApprovalHold(params: {
  job_id: string;
  case_ref?: string | null;
}): HumanApprovalHold {
  return {
    status: 'HUMAN_APPROVAL_REQUIRED',
    submitted: false,
    job_id: params.job_id,
    case_ref: params.case_ref ?? null,
    message:
      'Final submission was not performed. The exact case and draft preview must be approved by a human reviewer before anything leaves the isolated runner.',
  };
}
