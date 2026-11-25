import { DEFAULT_ORG_RULES } from './rules';
import type {
  LedgerEntryEvaluation,
  LedgerEntryInput,
  LedgerEventType,
  LedgerSummary,
} from './types';

const PROTECTED_EVENTS = new Set<LedgerEventType>([
  'Policy cancelled (unauthorised)',
  'Claim repudiated',
  'Claim withdrawn',
  'Commission held/clawed back',
]);

const NON_MONEY_EVENTS = new Set<LedgerEventType>([
  'Judgment / order obtained',
  'Criminal arrest / conviction',
  'Repayment promise',
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function evaluateLedgerEntry(
  entry: LedgerEntryInput,
): LedgerEntryEvaluation {
  const booking_factor =
    entry.event_type === 'Policy cancelled (unauthorised)'
      ? DEFAULT_ORG_RULES.booking_factor_unauthorised
      : 1.0;

  const fp_review_cost = entry.cleared_fp
    ? round2(entry.review_hours * DEFAULT_ORG_RULES.fp_hourly_cost_zar)
    : 0;

  // Anti-puffery gate: judgments, arrests, convictions, and promises never count as cash or savings
  if (NON_MONEY_EVENTS.has(entry.event_type)) {
    return {
      live_protected: 0,
      would_have_protected: 0,
      net_cash_recovered: 0,
      futile_spend_avoided: 0,
      fp_review_cost,
      booking_factor,
      language_label: 'n/a — not money',
      why_not_counted: 'n/a — not money (judgments, arrests, and promises excluded)',
      is_counted_rand_value: false,
    };
  }

  // False-positive review friction log
  if (entry.event_type === 'False positive review') {
    return {
      live_protected: 0,
      would_have_protected: 0,
      net_cash_recovered: 0,
      futile_spend_avoided: 0,
      fp_review_cost,
      booking_factor,
      language_label: 'friction logged',
      why_not_counted: 'Cleared false positive — operational review friction logged',
      is_counted_rand_value: false,
    };
  }

  // Existing controls caught it first -> zero incremental credit
  if (entry.existing_controls_flagged) {
    return {
      live_protected: 0,
      would_have_protected: 0,
      net_cash_recovered: 0,
      futile_spend_avoided: 0,
      fp_review_cost,
      booking_factor,
      language_label: 'no credit — existing controls',
      why_not_counted: 'Flagged by existing XTND / Astute / SIU controls',
      is_counted_rand_value: false,
    };
  }

  // Protected events (Live vs Backtest)
  if (PROTECTED_EVENTS.has(entry.event_type)) {
    if (!entry.flagged_before_payout) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'exposure',
        why_not_counted: 'Not flagged prior to payout or issuance',
        is_counted_rand_value: false,
      };
    }

    if (!entry.human_confirmed) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'exposure',
        why_not_counted: 'Pending human confirmation of outcome',
        is_counted_rand_value: false,
      };
    }

    const countedAmount = round2(entry.amount_at_stake * booking_factor);

    if (entry.basis === 'Backtest') {
      return {
        live_protected: 0,
        would_have_protected: countedAmount,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'would have protected',
        why_not_counted: 'Backtest cohort only — excluded from Live Protected',
        is_counted_rand_value: false,
      };
    }

    if (!entry.forensics_signoff || !entry.finance_signoff) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'awaiting dual sign-off',
        why_not_counted: !entry.forensics_signoff && !entry.finance_signoff
          ? 'Awaiting Head of Forensics & Finance sign-offs'
          : !entry.forensics_signoff
            ? 'Awaiting Head of Forensics sign-off'
            : 'Awaiting Finance sign-off',
        is_counted_rand_value: false,
      };
    }

    return {
      live_protected: countedAmount,
      would_have_protected: 0,
      net_cash_recovered: 0,
      futile_spend_avoided: 0,
      fp_review_cost,
      booking_factor,
      language_label: 'protected / recovered',
      why_not_counted: null,
      is_counted_rand_value: true,
    };
  }

  // Cash recovered
  if (entry.event_type === 'Cash recovered') {
    if (entry.basis !== 'Live') {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'would have protected',
        why_not_counted: 'Backtest cash cannot be counted as live recovery',
        is_counted_rand_value: false,
      };
    }

    if (!entry.bank_reconciled) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'exposure',
        why_not_counted: 'Cash receipt not bank-reconciled',
        is_counted_rand_value: false,
      };
    }

    if (!entry.forensics_signoff || !entry.finance_signoff) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'awaiting dual sign-off',
        why_not_counted: !entry.forensics_signoff
          ? 'Awaiting Head of Forensics sign-off'
          : 'Awaiting Finance sign-off',
        is_counted_rand_value: false,
      };
    }

    const netCash = round2(Math.max(0, entry.amount_at_stake - entry.legal_costs));
    return {
      live_protected: 0,
      would_have_protected: 0,
      net_cash_recovered: netCash,
      futile_spend_avoided: 0,
      fp_review_cost,
      booking_factor,
      language_label: 'protected / recovered',
      why_not_counted: null,
      is_counted_rand_value: true,
    };
  }

  // Futile spend avoided
  if (entry.event_type === 'Futile spend avoided') {
    if (entry.basis !== 'Live') {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'would have protected',
        why_not_counted: 'Backtest triage only',
        is_counted_rand_value: false,
      };
    }

    if (!entry.human_confirmed) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'exposure',
        why_not_counted: 'Pending litigation halt confirmation',
        is_counted_rand_value: false,
      };
    }

    if (!entry.forensics_signoff || !entry.finance_signoff) {
      return {
        live_protected: 0,
        would_have_protected: 0,
        net_cash_recovered: 0,
        futile_spend_avoided: 0,
        fp_review_cost,
        booking_factor,
        language_label: 'awaiting dual sign-off',
        why_not_counted: !entry.forensics_signoff
          ? 'Awaiting Head of Forensics sign-off'
          : 'Awaiting Finance sign-off',
        is_counted_rand_value: false,
      };
    }

    return {
      live_protected: 0,
      would_have_protected: 0,
      net_cash_recovered: 0,
      futile_spend_avoided: round2(entry.amount_at_stake),
      fp_review_cost,
      booking_factor,
      language_label: 'protected / recovered',
      why_not_counted: null,
      is_counted_rand_value: true,
    };
  }

  return {
    live_protected: 0,
    would_have_protected: 0,
    net_cash_recovered: 0,
    futile_spend_avoided: 0,
    fp_review_cost,
    booking_factor,
    language_label: 'exposure',
    why_not_counted: 'Unclassified event',
    is_counted_rand_value: false,
  };
}

export function summarizeLedger(
  entries: LedgerEntryInput[],
  confirmedFraudulentLossTotal: number,
): LedgerSummary {
  let judgment_order_value = 0;
  let agreed_repayment_plans = 0;
  let legal_costs_spent = 0;
  let futile_spend_avoided = 0;
  let bank_reconciled_cash_received = 0;
  let incremental_protected_live = 0;
  let would_have_protected_backtest = 0;
  let fp_review_cost_total = 0;
  let cleared_fp_count = 0;
  let awaiting_signoff_count = 0;

  for (const e of entries) {
    const evalOut = evaluateLedgerEntry(e);
    legal_costs_spent += e.legal_costs;
    if (e.event_type === 'Judgment / order obtained') {
      judgment_order_value += e.amount_at_stake;
    }
    if (e.event_type === 'Repayment promise') {
      agreed_repayment_plans += e.amount_at_stake;
    }
    futile_spend_avoided += evalOut.futile_spend_avoided;
    bank_reconciled_cash_received += evalOut.net_cash_recovered;
    incremental_protected_live += evalOut.live_protected;
    would_have_protected_backtest += evalOut.would_have_protected;
    fp_review_cost_total += evalOut.fp_review_cost;
    if (e.cleared_fp) cleared_fp_count += 1;
    if (evalOut.language_label === 'awaiting dual sign-off') {
      awaiting_signoff_count += 1;
    }
  }

  return {
    confirmed_fraudulent_loss: round2(confirmedFraudulentLossTotal),
    judgment_order_value: round2(judgment_order_value),
    agreed_repayment_plans: round2(agreed_repayment_plans),
    legal_costs_spent: round2(legal_costs_spent),
    futile_spend_avoided: round2(futile_spend_avoided),
    bank_reconciled_cash_received: round2(bank_reconciled_cash_received),
    incremental_protected_live: round2(incremental_protected_live),
    would_have_protected_backtest: round2(would_have_protected_backtest),
    fp_review_cost_total: round2(fp_review_cost_total),
    cleared_fp_count,
    awaiting_signoff_count,
  };
}
