// ClaimTrace connector framework (Thabiso's 09:22 order: SIM swap, RICA, bank
// adapters; consent gate; audit log; humans decide; synthetic labelled data;
// live calls behind one switch that stays OFF).
//
// Every connector here is a SIMULATED ADAPTER. No connector makes a network
// call, sends a message, or changes a payment, and no connector output is
// proof of fraud: each result is an indicator with its innocent explanation,
// and a human always decides. Live insurer/telco/bank calls require insurer
// credentials and a fresh explicit go-ahead; the single switch is below.

import {
  simulatedTelcoAdapter,
  telecomScore,
  type TelecomInput,
} from '../engine/telecomRisk';

/**
 * THE one switch. While false, every connector returns synthetic labelled
 * fixtures and any request for a live call throws LIVE_CONNECTORS_OFF.
 * Flipping this to true also requires real adapter implementations, insurer
 * credentials, and Thabiso's fresh Go+Sure - none of which exist yet.
 */
export const LIVE_CONNECTORS_ENABLED = false;

export type ConnectorId = 'sim_swap' | 'rica' | 'bank_avs';

export interface ConnectorIndicator {
  label: string;
  innocent: string;
  source: ConnectorId;
  simulated: true;
  human_decides: true;
}

export interface ConnectorAuditEntry {
  connector: ConnectorId;
  claim_ref: string;
  consent_ref: string;
  mode: 'simulated' | 'live';
  outcome: string;
  at: string;
}

// Append-only audit trail for every connector call, simulated or not.
const AUDIT: ConnectorAuditEntry[] = [];

export function getConnectorAudit(): readonly ConnectorAuditEntry[] {
  return AUDIT;
}

export function requireConsent(consentRef: string): void {
  if (!/^SYN-CONSENT-[A-Z0-9-]+$/.test(consentRef)) {
    throw new Error('SYNTHETIC_CONSENT_REQUIRED');
  }
}

function assertSimulatedOnly(): void {
  if (!LIVE_CONNECTORS_ENABLED) return;
  // Unreachable while the switch is OFF; when someone wires live adapters this
  // is where per-connector credential checks must happen first.
  throw new Error('LIVE_ADAPTERS_NOT_IMPLEMENTED');
}

function audit(
  connector: ConnectorId,
  claimRef: string,
  consentRef: string,
  outcome: string,
): void {
  AUDIT.push({
    connector,
    claim_ref: claimRef,
    consent_ref: consentRef,
    mode: LIVE_CONNECTORS_ENABLED ? 'live' : 'simulated',
    outcome,
    at: new Date().toISOString(),
  });
}

const BANNERS: Record<ConnectorId, string> = {
  sim_swap: 'SIMULATED - NOT A LIVE TELCO CHECK',
  rica: 'SIMULATED - NOT A LIVE RICA CHECK',
  bank_avs: 'SIMULATED - NOT A LIVE BANK CHECK',
};

// --- SIM swap connector (telco adapter) -----------------------------------

export interface SimSwapResult {
  banner: string;
  consent_ref: string;
  swap_detected: boolean;
  hours_since_swap: number | null;
  kyc_match: 'yes' | 'partial' | 'no' | 'unknown';
  risk_score: number;
  risk_band: string;
  proposed_state: string;
  auto_reject: false;
  indicator: ConnectorIndicator;
}

export function simSwapConnector(
  claimRef: string,
  syntheticSuffix: string,
  consentRef: string,
): SimSwapResult {
  requireConsent(consentRef);
  assertSimulatedOnly();
  const feed = simulatedTelcoAdapter(syntheticSuffix);
  const input: TelecomInput = {
    consent_ref: consentRef,
    swap: feed.swap,
    post_swap_bank_hours: 36,
    post_swap_claim_hours: 54,
    kyc: feed.kyc,
    personal_ids_90d: 3,
    office_line: feed.office_line,
    number_changes_30d: 1,
    key_reset: true,
    foreign_or_vpn: false,
    device: { mode: 'Unavailable', hours: null },
  };
  const scored = telecomScore(input);
  audit('sim_swap', claimRef, consentRef, `score=${scored.score} band=${scored.band}`);
  return {
    banner: BANNERS.sim_swap,
    consent_ref: consentRef,
    swap_detected: feed.swap.hours !== null,
    hours_since_swap: feed.swap.hours,
    kyc_match: feed.kyc.match,
    risk_score: scored.score,
    risk_band: scored.band,
    proposed_state: scored.state,
    auto_reject: false,
    indicator: {
      label: 'SIM swap 36 hours before the bank detail change',
      innocent: 'People lose phones; swaps are usually innocent.',
      source: 'sim_swap',
      simulated: true,
      human_decides: true,
    },
  };
}

// --- RICA connector (SIM registration identity) -----------------------------
// RICA registers every SA SIM to a verified ID. A claim phone whose RICA
// registration does not match the claimant (or was registered days before the
// claim) is an indicator - never proof: people borrow phones and families
// share numbers.

export interface RicaResult {
  banner: string;
  consent_ref: string;
  registration_match: 'yes' | 'partial' | 'no';
  registration_age_days: number;
  registered_name_matches_claimant: boolean;
  indicator: ConnectorIndicator | null;
}

export function ricaConnector(
  claimRef: string,
  consentRef: string,
  fixture: { match: 'yes' | 'partial' | 'no'; ageDays: number } = {
    match: 'no',
    ageDays: 12,
  },
): RicaResult {
  requireConsent(consentRef);
  assertSimulatedOnly();
  audit('rica', claimRef, consentRef, `match=${fixture.match} age=${fixture.ageDays}d`);
  const suspicious = fixture.match === 'no' || fixture.ageDays < 30;
  return {
    banner: BANNERS.rica,
    consent_ref: consentRef,
    registration_match: fixture.match,
    registration_age_days: fixture.ageDays,
    registered_name_matches_claimant: fixture.match === 'yes',
    indicator: suspicious
      ? {
          label:
            fixture.match === 'no'
              ? 'Claim phone RICA-registered to a different person'
              : `Claim phone RICA-registered only ${fixture.ageDays} days ago`,
          innocent:
            'People borrow phones and families share numbers; a mismatch is a question, not fraud.',
          source: 'rica',
          simulated: true,
          human_decides: true,
        }
      : null,
  };
}

// --- Bank AVS connector (account verification) ------------------------------
// AVS-R style account verification: does the account exist, is it open, does
// the ID match, how old is it. A brand-new account or an ID mismatch after a
// SIM swap is an indicator - never proof: people change banks.

export interface BankAvsResult {
  banner: string;
  consent_ref: string;
  account_open: boolean;
  id_match: boolean;
  account_age_days: number;
  indicator: ConnectorIndicator;
}

export function bankAvsConnector(
  claimRef: string,
  consentRef: string,
  fixture: { open: boolean; idMatch: boolean; ageDays: number } = {
    open: true,
    idMatch: false,
    ageDays: 9,
  },
): BankAvsResult {
  requireConsent(consentRef);
  assertSimulatedOnly();
  audit(
    'bank_avs',
    claimRef,
    consentRef,
    `open=${fixture.open} idMatch=${fixture.idMatch} age=${fixture.ageDays}d`,
  );
  return {
    banner: BANNERS.bank_avs,
    consent_ref: consentRef,
    account_open: fixture.open,
    id_match: fixture.idMatch,
    account_age_days: fixture.ageDays,
    indicator: {
      label: !fixture.idMatch
        ? 'Payout bank account ID does not match the claimant'
        : fixture.ageDays < 30
          ? `Payout bank account opened only ${fixture.ageDays} days before the claim`
          : 'Bank account appears on 3 unrelated claims',
      innocent: !fixture.idMatch
        ? 'Families often receive money into one shared account.'
        : 'People change banks for ordinary reasons.',
      source: 'bank_avs',
      simulated: true,
      human_decides: true,
    },
  };
}

// --- Pure indicator text (no consent/audit; for static sample boards) -------
// The worked-case example uses these so the screen always shows exactly what
// the connectors would surface for the same scenario.

export function simSwapIndicator(): ConnectorIndicator {
  return {
    label: 'SIM swap 36 hours before the bank detail change',
    innocent: 'People lose phones; swaps are usually innocent.',
    source: 'sim_swap',
    simulated: true,
    human_decides: true,
  };
}

export function bankAccountClusterIndicator(): ConnectorIndicator {
  return {
    label: 'Bank account appears on 3 unrelated claims',
    innocent: 'Families often receive money into one shared account.',
    source: 'bank_avs',
    simulated: true,
    human_decides: true,
  };
}

// --- Combined run -----------------------------------------------------------

export interface ConnectorRun {
  claim_ref: string;
  all_simulated: true;
  live_switch: 'OFF';
  sim_swap: SimSwapResult;
  rica: RicaResult;
  bank_avs: BankAvsResult;
  indicators: ConnectorIndicator[];
}

export function runConnectorsForClaim(
  claimRef: string,
  syntheticSuffix: string,
  consentRef: string,
): ConnectorRun {
  const sim = simSwapConnector(claimRef, syntheticSuffix, consentRef);
  const rica = ricaConnector(claimRef, consentRef);
  const bank = bankAvsConnector(claimRef, consentRef);
  const indicators = [sim.indicator, rica.indicator, bank.indicator].filter(
    (i): i is ConnectorIndicator => i !== null,
  );
  return {
    claim_ref: claimRef,
    all_simulated: true,
    live_switch: 'OFF',
    sim_swap: sim,
    rica,
    bank_avs: bank,
    indicators,
  };
}
