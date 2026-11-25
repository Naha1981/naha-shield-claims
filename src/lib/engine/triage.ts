import { DEFAULT_ORG_RULES } from './rules';
import type { RecoveryCaseInput, RecoveryTriageOutput } from './types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function evaluateRecoveryCase(input: RecoveryCaseInput): RecoveryTriageOutput {
  const fsd = input.forced_sale_discount ?? DEFAULT_ORG_RULES.forced_sale_discount;
  const accessible: 0 | 1 =
    input.title_type === 'Communal / PTO' || input.title_type === 'None' ? 0 : 1;

  const forced_sale_proceeds = round2(
    accessible * input.est_sale_proceeds * (1 - fsd),
  );
  const conservative_equity = round2(
    accessible * (forced_sale_proceeds - input.senior_bonds - input.municipal_arrears),
  );
  const nrv_low = round2(
    accessible *
      (forced_sale_proceeds -
        input.senior_bonds -
        input.municipal_arrears -
        input.legal_costs),
  );
  const nrv_high = round2(
    accessible *
      (input.est_sale_proceeds -
        input.senior_bonds -
        input.municipal_arrears -
        input.legal_costs),
  );
  const practically_recoverable = round2(
    Math.min(input.original_payout, Math.max(nrv_low, 0)),
  );

  const rule_46a_flag =
    (input.title_type === 'Freehold' || input.title_type === 'Sectional') &&
    input.primary_residence;
  const ipilra_pto_flag = input.title_type === 'Communal / PTO';
  const early_write_off = input.legal_costs > conservative_equity;
  const futile_spend_avoided = early_write_off ? round2(input.legal_costs) : 0;

  let recommended_route: string;
  if (early_write_off) {
    recommended_route =
      input.employment === 'Salaried'
        ? 'CPA s297 / Emoluments Attachment'
        : 'Early Write-Off — halt litigation spend';
  } else if (nrv_low >= input.original_payout) {
    recommended_route = 'Civil Delict (Masindi check) + CPA s300 (asset-verified)';
  } else {
    recommended_route = 'Civil Delict (Masindi check) + Structured Settlement';
  }

  if (rule_46a_flag && !early_write_off) {
    recommended_route += ' | model Rule 46A reserve-price delay';
  }

  const includesS300 = recommended_route.includes('s300');
  let s300_forum: RecoveryTriageOutput['s300_forum'] = null;
  let s300_warning: string | null = null;

  if (includesS300) {
    if (input.original_payout <= DEFAULT_ORG_RULES.s300_district_max_zar) {
      s300_forum = 'District (≤R300k)';
    } else if (input.original_payout <= DEFAULT_ORG_RULES.s300_regional_max_zar) {
      s300_forum = 'Regional (≤R1m)';
    } else {
      s300_forum = 'High Court';
    }
    s300_warning =
      '60-day s300(5)(b) civil-bar warning — counsel to confirm before electing';
  }

  const state_referral_pack = input.ring_flag
    ? 'Package for MLRO (FIC s29/s34) + NDPP/AFU (POCA s38) — state powers only'
    : null;

  return {
    accessible,
    forced_sale_discount: fsd,
    forced_sale_proceeds,
    conservative_equity,
    nrv_low,
    nrv_high,
    practically_recoverable,
    rule_46a_flag,
    ipilra_pto_flag,
    early_write_off,
    futile_spend_avoided,
    recommended_route,
    s300_forum,
    s300_warning,
    state_referral_pack,
    eight_layers: {
      registered_owner: input.registered_owner ?? input.defendant_alias,
      legal_owner: input.legal_owner ?? input.defendant_alias,
      beneficial_owner: input.beneficial_owner ?? input.defendant_alias,
      market_value: round2(input.est_sale_proceeds),
      forced_sale_value: forced_sale_proceeds,
      nrv_low,
      nrv_high,
      legally_accessible: accessible === 1,
      practically_recoverable,
    },
  };
}

export function summarizeRecoveryPortfolio(cases: RecoveryCaseInput[]) {
  let total_lost = 0;
  let total_collectable = 0;
  let total_futile_spend_avoided = 0;
  let total_projected_legal_spend = 0;
  let write_off_count = 0;
  let rule_46a_count = 0;
  let pto_count = 0;
  let ring_referral_count = 0;

  for (const c of cases) {
    const out = evaluateRecoveryCase(c);
    total_lost += c.original_payout;
    total_collectable += out.practically_recoverable;
    total_futile_spend_avoided += out.futile_spend_avoided;
    total_projected_legal_spend += c.legal_costs;
    if (out.early_write_off) write_off_count += 1;
    if (out.rule_46a_flag) rule_46a_count += 1;
    if (out.ipilra_pto_flag) pto_count += 1;
    if (c.ring_flag) ring_referral_count += 1;
  }

  return {
    case_count: cases.length,
    total_lost: round2(total_lost),
    total_collectable: round2(total_collectable),
    total_futile_spend_avoided: round2(total_futile_spend_avoided),
    total_projected_legal_spend: round2(total_projected_legal_spend),
    write_off_count,
    rule_46a_count,
    pto_count,
    ring_referral_count,
  };
}
