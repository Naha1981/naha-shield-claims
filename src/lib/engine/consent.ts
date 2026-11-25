import { DEFAULT_ORG_RULES } from './rules';
import type { ConsentPolicyEvaluation, ConsentPolicyInput } from './types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Evaluates M2 Consent & Cover Integrity rules.
 * PEPUDA guardrail: this function MUST NEVER inspect age or age_band.
 */
export function evaluateConsentPolicy(
  input: ConsentPolicyInput,
): ConsentPolicyEvaluation {
  const third_party = input.proposer_ne_assured || input.payer_ne_assured;

  const contact_independence_status: ConsentPolicyEvaluation['contact_independence_status'] =
    !third_party
      ? 'n/a'
      : input.independent_contact_on_file
        ? 'Independent contact on file'
        : 'Contact Independence Unverified — Escalate';

  const escalation_reasons: string[] = [];
  if (input.proposer_ne_assured && input.payer_ne_assured) {
    escalation_reasons.push('Proposer ≠ Assured ≠ Payer');
  }
  if (input.cover_increase_12m) {
    escalation_reasons.push('Cover spike within 12 months');
  }
  if (
    input.unrelated_lives_same_payer >=
    DEFAULT_ORG_RULES.unrelated_lives_escalation_threshold
  ) {
    escalation_reasons.push(
      `Same payer funding ≥${DEFAULT_ORG_RULES.unrelated_lives_escalation_threshold} unrelated lives`,
    );
  }
  if (input.beneficiary_relationship === 'Non-immediate') {
    escalation_reasons.push('Non-immediate beneficiary');
  }

  const consent_tier: ConsentPolicyEvaluation['consent_tier'] = !third_party
    ? 'n/a'
    : escalation_reasons.length > 0
      ? 'Escalated'
      : 'Standard';

  let consent_gap_status: ConsentPolicyEvaluation['consent_gap_status'] = 'OK';
  if (third_party) {
    if (!input.consent_record_exists) {
      consent_gap_status = 'CONSENT GAP';
    } else if (!input.consent_via_independent_channel) {
      consent_gap_status = 'CHANNEL NOT INDEPENDENT';
    }
  }

  const exposure_at_gap =
    consent_gap_status !== 'OK'
      ? round2(input.cover_amount * Math.max(input.accidental_multiplier, 1))
      : 0;

  return {
    third_party,
    contact_independence_status,
    consent_tier,
    consent_gap_status,
    exposure_at_gap,
    escalation_reasons,
  };
}

export function summarizeConsentAudit(policies: ConsentPolicyInput[]) {
  let third_party_count = 0;
  let consent_gap_count = 0;
  let unverified_channel_count = 0;
  let unverified_contact_count = 0;
  let escalated_count = 0;
  let duress_count = 0;
  let total_exposure_at_gap = 0;

  for (const p of policies) {
    const out = evaluateConsentPolicy(p);
    if (out.third_party) third_party_count += 1;
    if (out.consent_gap_status === 'CONSENT GAP') consent_gap_count += 1;
    if (out.consent_gap_status === 'CHANNEL NOT INDEPENDENT') {
      unverified_channel_count += 1;
    }
    if (
      out.contact_independence_status ===
      'Contact Independence Unverified — Escalate'
    ) {
      unverified_contact_count += 1;
    }
    if (out.consent_tier === 'Escalated') escalated_count += 1;
    if (p.duress_alert) duress_count += 1;
    total_exposure_at_gap += out.exposure_at_gap;
  }

  return {
    total_policies: policies.length,
    third_party_count,
    consent_gap_count,
    unverified_channel_count,
    unverified_contact_count,
    escalated_count,
    duress_count,
    total_exposure_at_gap: round2(total_exposure_at_gap),
  };
}
