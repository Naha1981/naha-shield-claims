import { createHash } from 'node:crypto';
import { canonicalJson } from './captureExecutor';

/**
 * Record-and-replay skills for the synthetic portal runner.
 *
 * An insurer demonstrates a flow once on the synthetic loopback portal ("watch
 * me capture FNOL once"); the exact steps are saved as data with a SHA-256
 * digest. Every successful runner workflow is also auto-saved as a skill.
 * Replay is approval-bound (a consumed human token tied to this digest),
 * executes the exact saved steps, stays on allowlisted origins, and performs
 * no external writes. Skills are data, never arbitrary scripts.
 */

export type SkillStepAction =
  | 'goto'
  | 'click_text'
  | 'click_button'
  | 'fill'
  | 'screenshot';

export interface SkillStep {
  action: SkillStepAction;
  /** `goto`: portal-relative path only (must start with '/', never '//'). */
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

/** Anything resembling a final/submit control is never a replayable step. */
export const SUBMIT_STEP_PATTERN =
  /record signed human decision|submit|send|final/i;

/** sha256 over the canonical step JSON — the replay binding. */
export function computeSkillDigest(steps: SkillStep[]): string {
  return createHash('sha256').update(canonicalJson(steps), 'utf8').digest('hex');
}

export interface SkillValidation {
  ok: boolean;
  violations: string[];
}

/**
 * Structural validation of a skill's steps. Replay executes only steps that
 * pass this and whose digest matches the saved one.
 */
export function validateSkillSteps(steps: SkillStep[]): SkillValidation {
  const violations: string[] = [];
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
        if (
          typeof step.path !== 'string' ||
          !step.path.startsWith('/') ||
          step.path.startsWith('//')
        ) {
          violations.push(
            `${at}: goto path must be portal-relative (start with '/', never '//').`,
          );
        }
        break;
      case 'click_text':
        if (!step.text || typeof step.text !== 'string') {
          violations.push(`${at}: click_text requires text.`);
        } else if (SUBMIT_STEP_PATTERN.test(step.text)) {
          violations.push(`${at}: click_text targets a submit/final control — denied.`);
        }
        break;
      case 'click_button':
        if (!step.name || typeof step.name !== 'string') {
          violations.push(`${at}: click_button requires a button name.`);
        } else if (SUBMIT_STEP_PATTERN.test(step.name)) {
          violations.push(
            `${at}: click_button targets a submit/final control — denied.`,
          );
        }
        break;
      case 'fill':
        if (typeof step.selector !== 'string' || step.selector.length === 0) {
          violations.push(`${at}: fill requires a selector.`);
        }
        if (typeof step.value !== 'string' || step.value.length > 2500) {
          violations.push(`${at}: fill value must be a string of at most 2500 chars.`);
        }
        break;
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
}): PortalSkill {
  if (!SKILL_ID_PATTERN.test(params.name)) {
    throw new Error(`SKILL_NAME_DENIED: ${params.name}`);
  }
  const validation = validateSkillSteps(params.steps);
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
