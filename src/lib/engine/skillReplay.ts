import { createHash } from 'node:crypto';
import { canonicalJson } from './captureExecutor';

/**
 * Record-and-replay skills for the synthetic portal runner.
 *
 * An insurer demonstrates a flow once on the synthetic loopback portal ("watch
 * me capture FNOL once"); the exact steps are saved as data with a SHA-256
 * digest. Every successful runner workflow is also auto-saved as a skill.
 * Replay is approval-bound (an atomic one-execution claim of a consumed human
 * token tied to this digest), executes the exact saved steps, restricts every
 * step to the portal's registered allowlists (draft fields, safe preview
 * buttons, assigned synthetic cases, the synthetic recovery page for
 * navigation), and performs no external writes. Skills are data, never
 * arbitrary scripts.
 */

export type SkillStepAction =
  | 'goto'
  | 'click_text'
  | 'click_button'
  | 'fill'
  | 'screenshot';

export interface SkillStep {
  action: SkillStepAction;
  /** `goto`: the synthetic recovery page only. */
  path?: string;
  text?: string;
  name?: string;
  selector?: string;
  value?: string;
}

export interface PortalSkill {
  skill_id: string;
  name: string;
  version: 1;
  created_at: string;
  created_by: 'recorded' | 'auto';
  portal_origin: string;
  case_ref: string;
  synthetic_only: true;
  steps: SkillStep[];
  steps_digest: string;
}

export const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/;

export const SYNTHETIC_CASE_PATTERN = /^SYN-[A-Z0-9-]+$/;

/**
 * The portal's registered allowlists a replay may touch. These mirror the
 * worker's env-driven config (PORTAL_RUNNER_DRAFT_FIELDS,
 * PORTAL_RUNNER_SAFE_BUTTONS, PORTAL_RUNNER_ASSIGNED_CASES) and are the ONLY
 * things a replayed step may act on — allowlists, not a submit-word blacklist.
 */
export interface SkillAllowlists {
  /** Fillable draft field ids (without the leading '#'). */
  draftFields: readonly string[];
  /** Safe (preview) button names, exact match. */
  safeButtons: readonly string[];
  /** Assigned synthetic case refs. */
  assignedCases: readonly string[];
  /** The only page a replay may navigate to. Default '/recovery'. */
  recoveryPath?: string;
}

export const DEFAULT_SKILL_ALLOWLISTS: SkillAllowlists = {
  draftFields: ['decision-action', 'decision-reasons', 'decision-note'],
  safeButtons: ['Generate Attorney / AFU Handover Pack'],
  assignedCases: ['SYN-RC-004'],
  recoveryPath: '/recovery',
};

/** sha256 over the canonical step JSON — the replay binding. */
export function computeSkillDigest(steps: SkillStep[]): string {
  return createHash('sha256').update(canonicalJson(steps), 'utf8').digest('hex');
}

export interface SkillValidation {
  ok: boolean;
  violations: string[];
}

/**
 * Static validation of a skill's steps against the portal's registered
 * allowlists. Replay executes only steps that pass this and whose digest
 * matches the saved one; the worker runs this pass before claiming the
 * approval token so a denied skill never spends it.
 */
export function validateSkillSteps(
  steps: SkillStep[],
  allowlists: SkillAllowlists = DEFAULT_SKILL_ALLOWLISTS,
): SkillValidation {
  const violations: string[] = [];
  const recoveryPath = allowlists.recoveryPath ?? '/recovery';
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, violations: ['Skill must contain at least one step.'] };
  }
  steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== 'object') {
      violations.push(`${at}: not an object.`);
      return;
    }
    switch (step.action) {
      case 'goto':
        if (step.path !== recoveryPath) {
          violations.push(
            `${at}: navigation outside the synthetic recovery page (${recoveryPath}) — denied.`,
          );
        }
        break;
      case 'click_text': {
        const text = typeof step.text === 'string' ? step.text : '';
        if (
          !SYNTHETIC_CASE_PATTERN.test(text) ||
          !allowlists.assignedCases.includes(text)
        ) {
          violations.push(
            `${at}: click_text may only select an assigned synthetic case — denied.`,
          );
        }
        break;
      }
      case 'click_button':
        if (
          typeof step.name !== 'string' ||
          !allowlists.safeButtons.includes(step.name)
        ) {
          violations.push(
            `${at}: click_button is not a registered safe preview button — denied.`,
          );
        }
        break;
      case 'fill': {
        const selector = typeof step.selector === 'string' ? step.selector : '';
        const field = selector.startsWith('#') ? selector.slice(1) : '';
        if (!allowlists.draftFields.includes(field)) {
          violations.push(
            `${at}: fill target is not a registered draft field — denied.`,
          );
        }
        if (typeof step.value !== 'string' || step.value.length > 2500) {
          violations.push(`${at}: fill value must be a string of at most 2500 chars.`);
        }
        break;
      }
      case 'screenshot':
        if (
          step.name !== undefined &&
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$/.test(step.name)
        ) {
          violations.push(`${at}: screenshot name is not artifact-safe.`);
        }
        break;
      default:
        violations.push(`${at}: unknown action "${String(step.action)}" — skills are data, not scripts.`);
    }
  });
  return { ok: violations.length === 0, violations };
}

/** Builds a digest-sealed skill record from validated steps. */
export function buildSkillRecord(params: {
  name: string;
  steps: SkillStep[];
  created_by: 'recorded' | 'auto';
  portal_origin: string;
  case_ref: string;
  created_at?: string;
  allowlists?: SkillAllowlists;
}): PortalSkill {
  if (!SKILL_ID_PATTERN.test(params.name)) {
    throw new Error(`SKILL_NAME_DENIED: ${params.name}`);
  }
  const validation = validateSkillSteps(params.steps, params.allowlists);
  if (!validation.ok) {
    throw new Error(`SKILL_INVALID: ${validation.violations.join(' | ')}`);
  }
  return {
    skill_id: params.name,
    name: params.name,
    version: 1,
    created_at: params.created_at ?? new Date().toISOString(),
    created_by: params.created_by,
    portal_origin: params.portal_origin,
    case_ref: params.case_ref,
    synthetic_only: true,
    steps: params.steps,
    steps_digest: computeSkillDigest(params.steps),
  };
}

/** Digest check used before any replay: saved digest must match the steps. */
export function verifySkillDigest(skill: PortalSkill): boolean {
  return computeSkillDigest(skill.steps) === skill.steps_digest;
}

/** Shape of a SKILL_REPLAY record in the reviewer token store. */
export interface SkillReplayTokenRecord {
  type?: string;
  claim_ref?: string;
  digest?: string;
  expires?: number;
  used?: boolean;
}

/**
 * Predicate mirrored by the worker's atomic one-execution claim: the token
 * must already be consumed by the human reviewer, be of type SKILL_REPLAY,
 * and bind to this skill's case ref and recomputed steps digest. The
 * one-execution guarantee itself is stateful (a claimed-token store the
 * reviewer surface never rewrites, under an atomic cross-process lock) and is
 * proven in the e2e, not by this pure function.
 */
export function isSkillReplayTokenExecutable(
  record: SkillReplayTokenRecord | undefined,
  skill: PortalSkill,
  now = Date.now(),
): boolean {
  return Boolean(
    record &&
      record.used === true &&
      record.type === 'SKILL_REPLAY' &&
      record.claim_ref === skill.case_ref &&
      record.digest === skill.steps_digest &&
      typeof record.expires === 'number' &&
      record.expires > now,
  );
}
