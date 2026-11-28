// Connector framework tests (SIM swap, RICA, bank AVS adapters).
// Proves: consent gate, the one OFF switch, synthetic labelling, audit log,
// human-decides on every indicator, and worked-case wiring.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIVE_CONNECTORS_ENABLED,
  bankAccountClusterIndicator,
  bankAvsConnector,
  getConnectorAudit,
  requireConsent,
  ricaConnector,
  runConnectorsForClaim,
  simSwapConnector,
  simSwapIndicator,
} from '../../src/lib/connectors/index';
import { CASE_2_INDICATORS } from '../../src/lib/demo/workedExample';

const CONSENT = 'SYN-CONSENT-0008';

describe('connector consent gate', () => {
  it('rejects calls without a synthetic consent reference', () => {
    assert.throws(() => requireConsent(''), /SYNTHETIC_CONSENT_REQUIRED/);
    assert.throws(() => requireConsent('real-consent-123'), /SYNTHETIC_CONSENT_REQUIRED/);
    assert.throws(() => simSwapConnector('CLM-X', '0008', 'nope'), /SYNTHETIC_CONSENT_REQUIRED/);
    assert.throws(() => ricaConnector('CLM-X', 'nope'), /SYNTHETIC_CONSENT_REQUIRED/);
    assert.throws(() => bankAvsConnector('CLM-X', 'nope'), /SYNTHETIC_CONSENT_REQUIRED/);
  });
});

describe('the one live switch', () => {
  it('is OFF, so every call is simulated', () => {
    assert.equal(LIVE_CONNECTORS_ENABLED, false);
    const run = runConnectorsForClaim('CLM-2026-00887', '0008', CONSENT);
    assert.equal(run.live_switch, 'OFF');
    assert.equal(run.all_simulated, true);
    assert.match(run.sim_swap.banner, /SIMULATED/);
    assert.match(run.bank_avs.banner, /SIMULATED/);
  });
});

describe('SIM swap connector', () => {
  it('scores the post-swap bank change and never auto-rejects', () => {
    const r = simSwapConnector('CLM-2026-00887', '0008', CONSENT);
    assert.equal(r.swap_detected, true);
    assert.equal(r.hours_since_swap, 54);
    assert.equal(r.kyc_match, 'no');
    assert.ok(r.risk_score >= 45);
    assert.equal(r.auto_reject, false);
    assert.equal(r.indicator.simulated, true);
    assert.equal(r.indicator.human_decides, true);
  });

  it('degrades to Unavailable for the no-signal synthetic claim', () => {
    const r = simSwapConnector('CLM-2026-00421', '0000', CONSENT);
    assert.equal(r.swap_detected, false);
    assert.equal(r.hours_since_swap, null);
    assert.equal(r.kyc_match, 'unknown');
  });
});

describe('RICA connector', () => {
  it('flags a SIM registered to a different person, with the innocent case', () => {
    const r = ricaConnector('CLM-2026-00887', CONSENT, { match: 'no', ageDays: 12 });
    assert.ok(r.indicator);
    assert.match(r.indicator.label, /different person/);
    assert.match(r.indicator.innocent, /borrow phones|share numbers/);
    assert.equal(r.indicator.source, 'rica');
  });

  it('returns no indicator when registration matches and is old', () => {
    const r = ricaConnector('CLM-2026-00421', CONSENT, { match: 'yes', ageDays: 800 });
    assert.equal(r.indicator, null);
  });

  it('flags a very new registration even when the name matches', () => {
    const r = ricaConnector('CLM-X', CONSENT, { match: 'yes', ageDays: 3 });
    assert.ok(r.indicator);
    assert.match(r.indicator.label, /only 3 days ago/);
  });
});

describe('bank AVS connector', () => {
  it('flags an ID mismatch on the payout account', () => {
    const r = bankAvsConnector('CLM-X', CONSENT, { open: true, idMatch: false, ageDays: 400 });
    assert.match(r.indicator.label, /ID does not match/);
    assert.equal(r.indicator.human_decides, true);
  });

  it('flags a brand-new payout account', () => {
    const r = bankAvsConnector('CLM-X', CONSENT, { open: true, idMatch: true, ageDays: 9 });
    assert.match(r.indicator.label, /only 9 days/);
  });
});

describe('audit log', () => {
  it('records every connector call with consent ref and simulated mode', () => {
    const before = getConnectorAudit().length;
    runConnectorsForClaim('CLM-AUDIT-1', '0008', CONSENT);
    const entries = getConnectorAudit().slice(before);
    assert.equal(entries.length, 3);
    for (const e of entries) {
      assert.equal(e.consent_ref, CONSENT);
      assert.equal(e.mode, 'simulated');
      assert.equal(e.claim_ref, 'CLM-AUDIT-1');
      assert.ok(e.at.length > 0);
    }
    assert.deepEqual(
      entries.map((e) => e.connector).sort(),
      ['bank_avs', 'rica', 'sim_swap'],
    );
  });
});

describe('worked-case wiring', () => {
  it('case 2 shows the exact connector indicator text', () => {
    const sim = simSwapIndicator();
    const bank = bankAccountClusterIndicator();
    assert.ok(
      CASE_2_INDICATORS.some((i) => i.label === sim.label && i.innocent === sim.innocent),
      'SIM swap indicator text must come from the connectors module',
    );
    assert.ok(
      CASE_2_INDICATORS.some((i) => i.label === bank.label),
      'bank account indicator label must come from the connectors module',
    );
  });
});
