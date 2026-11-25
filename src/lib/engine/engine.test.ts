import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecoveryCase, summarizeRecoveryPortfolio } from './triage';
import { evaluateLedgerEntry, summarizeLedger } from './ledger';
import { evaluateConsentPolicy, summarizeConsentAudit } from './consent';
import { addSaBusinessDays, evaluateClaimTimers, isSaBusinessDay } from './timers';
import { lintOutboundMessage } from './lint';
import { computeChainHash, verifyEvidenceChain } from './vault';
import {
  buildAnomalyDensityMatrix,
  evaluateAnomalyThresholdAlerts,
} from './anomaly';
import {
  buildRegulatoryFeedPrompt,
  extractGroundingMetadata,
  formatRegulatoryFeedError,
  parseRegulatoryFeedResponse,
  parseRssFeedXml,
  sanitizeExternalHttpUrl,
} from './regulatoryFeed';
import {
  filterIncludedAuditNotesForPdf,
  normalizeKpiAuditNoteContent,
} from './popia';
import {
  appendLatencySample,
  buildSparklineGeometry,
  computeAverageLatency,
  summarizeInfrastructureHealth,
  type IntegrationHealthRecord,
} from './infrastructureHealth';
import {
  normalizeAllowedMime,
  processEvidencePayload,
  sanitizeIngestionFilename,
  verifyMagicBytes,
} from './evidenceIngestion';
import {
  buildPopiaReportMetrics,
  sanitizePopiaText,
} from '../../utils/pdfReport';
import {
  buildSeedEvidenceVault,
  SYNTHETIC_CONSENT_POLICIES,
  SYNTHETIC_LEDGER_ENTRIES,
  SYNTHETIC_RECOVERY_CASES,
} from '../../../db/seeds/syntheticData';
import type { LedgerEntryInput } from './types';

test('triage: Communal/PTO and None estates yield 0 accessible and 0 practically recoverable', () => {
  const pto = evaluateRecoveryCase(SYNTHETIC_RECOVERY_CASES[1]); // SYN-RC-002 PTO
  assert.equal(pto.accessible, 0);
  assert.equal(pto.ipilra_pto_flag, true);
  assert.equal(pto.practically_recoverable, 0);
  assert.equal(pto.early_write_off, true);
  assert.equal(pto.futile_spend_avoided, 52000);
  assert.equal(pto.recommended_route, 'Early Write-Off — halt litigation spend');

  const salariedNoAsset = evaluateRecoveryCase(SYNTHETIC_RECOVERY_CASES[4]); // SYN-RC-005 Salaried
  assert.equal(salariedNoAsset.accessible, 0);
  assert.equal(salariedNoAsset.early_write_off, true);
  assert.equal(
    salariedNoAsset.recommended_route,
    'CPA s297 / Emoluments Attachment',
  );
});

test('triage: s300 forums and 60-day warning + Rule 46A + ring referral across all 24 cases', () => {
  const district = evaluateRecoveryCase(SYNTHETIC_RECOVERY_CASES[6]); // R240k
  assert.equal(district.s300_forum, 'District (≤R300k)');
  assert.ok(district.s300_warning?.includes('60-day s300(5)(b)'));

  const regional = evaluateRecoveryCase(SYNTHETIC_RECOVERY_CASES[3]); // R850k ring
  assert.equal(regional.s300_forum, 'Regional (≤R1m)');
  assert.ok(regional.state_referral_pack?.includes('POCA s38'));

  const highCourt = evaluateRecoveryCase(SYNTHETIC_RECOVERY_CASES[5]); // R1.45m primary res
  assert.equal(highCourt.s300_forum, 'High Court');
  assert.equal(highCourt.rule_46a_flag, true);
  assert.ok(highCourt.recommended_route.includes('model Rule 46A reserve-price delay'));

  const summary = summarizeRecoveryPortfolio(SYNTHETIC_RECOVERY_CASES);
  assert.equal(summary.case_count, 24);
  assert.ok(summary.total_lost > 0);
  assert.ok(summary.total_futile_spend_avoided > 0);
});

test('ledger: enforces dual sign-off, 10% booking factor, bank reconciliation, and anti-puffery rules', () => {
  const evals = SYNTHETIC_LEDGER_ENTRIES.map((e) => ({
    id: e.entry_id,
    out: evaluateLedgerEntry(e),
  }));

  // SYN-001: live dual-signed claim repudiation -> full amount
  assert.equal(evals[0].out.live_protected, 450000);
  assert.equal(evals[0].out.language_label, 'protected / recovered');

  // SYN-002: bank-reconciled cash recovery net of legal costs (240k - 38.5k)
  assert.equal(evals[1].out.net_cash_recovered, 201500);
  assert.equal(evals[1].out.language_label, 'protected / recovered');

  // SYN-003: unauthorised policy cancelled -> 10% booking factor (300k * 0.10 = 30k)
  assert.equal(evals[2].out.live_protected, 30000);
  assert.equal(evals[2].out.booking_factor, 0.1);

  // SYN-004: backtest never counts in live_protected
  assert.equal(evals[3].out.live_protected, 0);
  assert.equal(evals[3].out.would_have_protected, 620000);
  assert.equal(evals[3].out.language_label, 'would have protected');

  // SYN-005: existing controls -> 0
  assert.equal(evals[4].out.live_protected, 0);
  assert.equal(evals[4].out.language_label, 'no credit — existing controls');

  // SYN-006, 007, 008: judgment, arrest, promise -> n/a — not money
  for (const idx of [5, 6, 7]) {
    assert.equal(evals[idx].out.live_protected, 0);
    assert.equal(evals[idx].out.net_cash_recovered, 0);
    assert.equal(evals[idx].out.language_label, 'n/a — not money');
  }

  // SYN-009: missing Finance sign-off -> awaiting dual sign-off, 0 counted
  assert.equal(evals[8].out.live_protected, 0);
  assert.equal(evals[8].out.language_label, 'awaiting dual sign-off');

  // SYN-013: cleared FP review cost = 4.5 * 250 = 1125
  assert.equal(evals[12].out.fp_review_cost, 1125);
  assert.equal(evals[12].out.language_label, 'friction logged');

  const summary = summarizeLedger(SYNTHETIC_LEDGER_ENTRIES, 1000000);
  assert.equal(summary.bank_reconciled_cash_received, 201500);
  assert.equal(summary.incremental_protected_live, 450000 + 30000 + 92000);
  assert.equal(summary.futile_spend_avoided, 52000 + 65000);
});

test('ledger property test: unsigned, unconfirmed, non-reconciled, or non-money entries NEVER count', () => {
  const base: LedgerEntryInput = {
    entry_id: 'PROP-1',
    case_ref: 'C-1',
    basis: 'Live',
    event_type: 'Claim repudiated',
    description: 'Property check',
    amount_at_stake: 500000,
    legal_costs: 25000,
    flagged_before_payout: true,
    existing_controls_flagged: false,
    human_confirmed: true,
    bank_reconciled: true,
    forensics_signoff: true,
    finance_signoff: true,
    cleared_fp: false,
    review_hours: 0,
    event_date: '2026-11-01',
  };

  const invalidCases: Partial<LedgerEntryInput>[] = [
    { forensics_signoff: false },
    { finance_signoff: false },
    { human_confirmed: false },
    { existing_controls_flagged: true },
    { flagged_before_payout: false },
    { event_type: 'Judgment / order obtained' },
    { event_type: 'Criminal arrest / conviction' },
    { event_type: 'Repayment promise' },
    { event_type: 'Cash recovered', bank_reconciled: false },
  ];

  for (const patch of invalidCases) {
    const out = evaluateLedgerEntry({ ...base, ...patch });
    assert.equal(out.live_protected, 0);
    assert.equal(out.net_cash_recovered, 0);
    assert.equal(out.futile_spend_avoided, 0);
    assert.notEqual(out.language_label, 'protected / recovered');
  }
});

test('consent: PEPUDA age-fairness test & burner SIM detection across all 30 rows', () => {
  const summary = summarizeConsentAudit(SYNTHETIC_CONSENT_POLICIES);
  assert.equal(summary.total_policies, 30);
  assert.ok(summary.consent_gap_count > 0);
  assert.ok(summary.unverified_channel_count > 0);
  assert.equal(summary.duress_count, 1);

  // PEPUDA Fairness: identical structural facts across different age bands MUST produce identical tiers
  const young = evaluateConsentPolicy({
    ...SYNTHETIC_CONSENT_POLICIES[4],
    assured_age_band: '18-24',
  });
  const senior = evaluateConsentPolicy({
    ...SYNTHETIC_CONSENT_POLICIES[4],
    assured_age_band: '75+',
  });
  assert.deepEqual(young, senior);
});

test('timers: SA public holidays (Reconciliation Day 16 Dec, Christmas, observed Monday)', () => {
  // 2026-12-16 is Wednesday (Day of Reconciliation)
  assert.equal(isSaBusinessDay(new Date('2026-12-16T00:00:00Z')), false);
  // 2026-12-15 + 2 SA business days skips 16 Dec -> lands on 2026-12-18
  const deadline = addSaBusinessDays('2026-12-15T09:00:00Z', 2);
  assert.equal(deadline.toISOString().slice(0, 10), '2026-12-18');

  // 2027-03-21 is Sunday (Human Rights Day) -> Monday 2027-03-22 is observed holiday
  assert.equal(isSaBusinessDay(new Date('2027-03-22T00:00:00Z')), false);

  const timer = evaluateClaimTimers(
    {
      submitted_at: '2026-11-23T09:00:00Z',
      has_dispute_notice: true,
      dispute_opened_at: '2026-11-24T10:00:00Z',
    },
    '2026-11-25T10:00:00Z',
  );
  assert.equal(timer.dispute_breached, false);
  assert.equal(timer.dispute_business_days_remaining, 13);
});

test('lint: FIC Act s29(4)/s53 tipping-off linter blocks banned words and passes neutral notices', () => {
  const bad = lintOutboundMessage(
    'Claim held due to suspicious transaction report filed with FIC regarding money laundering.',
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.includes('suspicious transaction report'));
  assert.ok(bad.violations.includes('FIC'));
  assert.ok(bad.violations.includes('money laundering'));

  const good = lintOutboundMessage(
    'Your claim is under standard documentary review for verification of registration particulars. Expected completion date: 14 December 2026.',
  );
  assert.equal(good.ok, true);
  assert.equal(good.violations.length, 0);
});

test('vault: SHA-256 hash chain verifies valid items and fails closed on tampering', () => {
  const validItems = buildSeedEvidenceVault();
  const ok = verifyEvidenceChain(validItems);
  assert.equal(ok.valid, true);
  assert.equal(ok.checked_count, validItems.length);

  // Tamper attack: mutate 1 character in item index 1 without re-chaining (or even with content change)
  const tampered = validItems.map((item, idx) =>
    idx === 1
      ? { ...item, content_summary: item.content_summary + ' [ALTERED]' }
      : item,
  );
  const fail = verifyEvidenceChain(tampered);
  assert.equal(fail.valid, false);
  assert.equal(fail.failed_index, 1);
  assert.equal(fail.failed_evidence_id, 'EVD-0002');

  // Also test deleting an earlier item breaks prev_chain_hash link
  const deleted = [validItems[0], validItems[2]];
  const failLink = verifyEvidenceChain(deleted);
  assert.equal(failLink.valid, false);
  assert.equal(failLink.failed_evidence_id, 'EVD-0003');

  // Verify computeChainHash determinism
  assert.equal(
    computeChainHash({
      prev_chain_hash: validItems[0].prev_chain_hash,
      sha256_content: validItems[0].sha256_content,
      evidence_id: validItems[0].evidence_id,
      org_id: validItems[0].org_id,
      case_ref: validItems[0].case_ref,
      evidence_tag: validItems[0].evidence_tag,
      uploader_id: validItems[0].uploader_id,
      created_at: validItems[0].created_at,
    }),
    validItems[0].chain_hash,
  );
});

test('popia pdf: masks SA IDs, emails, and phones and builds separated KPI & ledger metrics', () => {
  const masked = sanitizePopiaText(
    'Claimant ID 8001015009087 email claimant@example.co.za phone +27821234567 and 0834567890',
  );
  assert.equal(masked.includes('8001015009087'), false);
  assert.equal(masked.includes('claimant@example.co.za'), false);
  assert.equal(masked.includes('+27821234567'), false);
  assert.equal(masked.includes('0834567890'), false);
  assert.ok(masked.includes('[SA-ID-REDACTED]'));
  assert.ok(masked.includes('[EMAIL-REDACTED]'));
  assert.ok(masked.includes('[PHONE-REDACTED]'));

  const evidence = buildSeedEvidenceVault();
  const verification = verifyEvidenceChain(evidence);
  const metrics = buildPopiaReportMetrics({
    reportId: 'RPT-TEST-001',
    generatedAt: '2026-11-25T12:00:00Z',
    orgName: 'UbuntuShield Synthetic',
    actorDisplayName: 'K. Ndlovu',
    actorRole: 'head_of_forensics',
    activeFilterLabel: 'All Rows',
    entries: SYNTHETIC_LEDGER_ENTRIES,
    filteredEntries: SYNTHETIC_LEDGER_ENTRIES,
    recoveryCases: SYNTHETIC_RECOVERY_CASES,
    consentPolicies: SYNTHETIC_CONSENT_POLICIES,
    evidenceItems: evidence,
    vaultVerification: verification,
  });

  assert.equal(metrics.vault.vaultScorePct, 100);
  assert.equal(metrics.recovery.case_count, 24);
  assert.equal(metrics.consent.totalPolicies, 30);
  assert.equal(metrics.ledger.bank_reconciled_cash_received, 201500);
});

test('anomaly heatmap: computes segment density percentages and sorts highest-risk segments first', () => {
  const matrix = buildAnomalyDensityMatrix(SYNTHETIC_CONSENT_POLICIES);
  assert.equal(matrix.totalPolicies, 30);
  assert.equal(matrix.segments.length, 4);
  assert.ok(matrix.totalFlaggedSignals > 0);
  assert.equal(matrix.highestRiskSegment, 'Extended Funeral Cover');

  const extended = matrix.segments.find(
    (s) => s.productType === 'Extended Funeral Cover',
  );
  assert.ok(extended);
  assert.equal(extended.totalPolicies, 6);
  assert.equal(extended.cells.non_immediate_or_duress.count, 6);
  assert.equal(extended.cells.non_immediate_or_duress.densityPct, 100);
  assert.equal(extended.cells.unverified_channel_sim.count, 5);

  const indLife = matrix.segments.find(
    (s) => s.productType === 'Individual Life + Funeral',
  );
  assert.ok(indLife);
  assert.equal(indLife.cells.missing_consent.count, 5);
  assert.equal(indLife.cells.missing_consent.densityPct, 100);
});

test('anomaly threshold alerts: triggers on breach, preserves ack, and re-triggers on escalation', () => {
  const initial = evaluateAnomalyThresholdAlerts({
    policies: SYNTHETIC_CONSENT_POLICIES,
    thresholdPct: 75,
    existingAlerts: [],
    nowIso: '2026-11-25T10:00:00Z',
  });
  assert.equal(initial.alerts.length, 7);
  assert.equal(initial.newlyTriggered.length, 7);
  assert.ok(initial.alerts.every((a) => !a.acknowledged));

  // Lowering threshold to 15% detects Extended Funeral Cover x 12m Cover Spike (17%)
  const lowered = evaluateAnomalyThresholdAlerts({
    policies: SYNTHETIC_CONSENT_POLICIES,
    thresholdPct: 15,
    existingAlerts: initial.alerts,
    nowIso: '2026-11-25T10:05:00Z',
  });
  assert.equal(lowered.alerts.length, 8);
  assert.equal(lowered.newlyTriggered.length, 1);
  assert.equal(lowered.newlyTriggered[0].pattern_id, 'cover_spike_12m');
  assert.equal(lowered.newlyTriggered[0].density_pct, 17);

  // Acknowledge that 17% alert, then re-evaluate with unchanged policies -> stays acknowledged
  const ackedAlerts = lowered.alerts.map((a) =>
    a.fingerprint === 'Extended Funeral Cover::cover_spike_12m'
      ? {
          ...a,
          acknowledged: true,
          acknowledged_by: 'K. Ndlovu',
          acknowledged_at: '2026-11-25T10:06:00Z',
        }
      : a,
  );
  const unchanged = evaluateAnomalyThresholdAlerts({
    policies: SYNTHETIC_CONSENT_POLICIES,
    thresholdPct: 15,
    existingAlerts: ackedAlerts,
    nowIso: '2026-11-25T10:07:00Z',
  });
  assert.equal(unchanged.newlyTriggered.length, 0);
  const kept = unchanged.alerts.find(
    (a) => a.fingerprint === 'Extended Funeral Cover::cover_spike_12m',
  );
  assert.equal(kept?.acknowledged, true);

  // Escalate another Extended Funeral Cover policy to have cover_increase_12m = true -> re-opens alert!
  const escalatedPolicies = structuredClone(SYNTHETIC_CONSENT_POLICIES);
  const targetIdx = escalatedPolicies.findIndex(
    (p) => p.product_type === 'Extended Funeral Cover' && !p.cover_increase_12m,
  );
  assert.ok(targetIdx >= 0);
  escalatedPolicies[targetIdx].cover_increase_12m = true;

  const escalated = evaluateAnomalyThresholdAlerts({
    policies: escalatedPolicies,
    thresholdPct: 15,
    existingAlerts: unchanged.alerts,
    nowIso: '2026-11-25T10:08:00Z',
  });
  assert.equal(escalated.newlyTriggered.length, 1);
  assert.equal(
    escalated.newlyTriggered[0].fingerprint,
    'Extended Funeral Cover::cover_spike_12m',
  );
  assert.equal(escalated.newlyTriggered[0].acknowledged, false);
  assert.equal(escalated.newlyTriggered[0].density_pct, 33);
});

test('regulatory feed: extracts grounding metadata and parses fenced JSON or markdown safely', () => {
  const promptPopia = buildRegulatoryFeedPrompt('popia', '2026-11-25');
  assert.ok(promptPopia.includes('Information Regulator'));
  assert.ok(promptPopia.includes('2026-11-25'));

  const grounding = extractGroundingMetadata({
    webSearchQueries: ['FSCA PPR 2026', 'POPIA direct marketing guidance'],
    groundingChunks: [
      { web: { uri: 'https://www.fsca.co.za/notices', title: 'FSCA Notices' } },
      { web: { uri: 'https://www.fsca.co.za/notices', title: 'Duplicate' } },
      { web: { uri: 'https://inforegulator.org.za/popia', title: 'InfoReg SA' } },
    ],
  });
  assert.equal(grounding.sources.length, 2);
  assert.equal(grounding.searchQueries.length, 2);

  const fencedJson = [
    '```json',
    JSON.stringify([
      {
        authority: 'FSCA',
        title: 'Conduct Standard on Claims Processing',
        published_period: 'Oct 2026',
        summary: 'Sets turnaround rules for funeral and life claim assessments.',
        insurance_impact: 'Align 2+14 day claims tracking and Basdeo notices.',
        source_index: 0,
      },
      {
        authority: 'Information Regulator',
        title: 'POPIA Direct Marketing & Consent Guidance',
        published_period: 'Sep 2026',
        summary: 'Clarifies opt-in consent proof and s71 automated decision disclosure.',
        insurance_impact: 'Enforce out-of-band independent contact verification.',
        source_index: 1,
      },
    ]),
    '```',
  ].join('\n');

  const parsed = parseRegulatoryFeedResponse(fencedJson, grounding.sources, 'all');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].authority, 'FSCA');
  assert.equal(parsed[0].source_url, 'https://www.fsca.co.za/notices');
  assert.equal(parsed[1].authority, 'POPIA');
  assert.equal(parsed[1].source_url, 'https://inforegulator.org.za/popia');

  const quotaErr = formatRegulatoryFeedError(
    new Error(
      '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}',
    ),
  );
  assert.equal(quotaErr.statusCode, 429);
  assert.ok(!quotaErr.message.includes('{'));
  assert.ok(quotaErr.message.includes('RESOURCE_EXHAUSTED'));
});

test('kpi audit notes: normalizes, masks PII under POPIA s19, and filters included PDF notes', () => {
  assert.throws(() => normalizeKpiAuditNoteContent('   '));

  const sanitized = normalizeKpiAuditNoteContent(
    'Verified EFT for ID 8203145800083; contact compliance@insurer.co.za or 082 555 0199.',
  );
  assert.ok(sanitized.includes('[SA-ID-REDACTED]'));
  assert.ok(sanitized.includes('[EMAIL-REDACTED]'));
  assert.ok(sanitized.includes('[PHONE-REDACTED]'));

  const included = filterIncludedAuditNotesForPdf([
    {
      note_id: 'NOTE-1',
      org_id: 'org-1',
      content: 'CFO signed off SYN-001 to SYN-003.',
      created_at: '2026-11-25T12:00:00Z',
      author_id: 'usr_1',
      author_name: 'K. Ndlovu',
      author_role: 'head_of_forensics',
      include_in_pdf: true,
    },
    {
      note_id: 'NOTE-2',
      org_id: 'org-1',
      content: 'Internal scratchpad — exclude from PDF.',
      created_at: '2026-11-25T12:01:00Z',
      author_id: 'usr_1',
      author_name: 'K. Ndlovu',
      author_role: 'head_of_forensics',
      include_in_pdf: false,
    },
  ]);
  assert.equal(included.length, 1);
  assert.equal(included[0].note_id, 'NOTE-1');

  const metrics = buildPopiaReportMetrics({
    reportId: 'RPT-TEST',
    generatedAt: '2026-11-25T12:05:00Z',
    orgName: 'UbuntuShield',
    actorDisplayName: 'K. Ndlovu',
    actorRole: 'head_of_forensics',
    activeFilterLabel: 'All Rows',
    entries: SYNTHETIC_LEDGER_ENTRIES,
    filteredEntries: SYNTHETIC_LEDGER_ENTRIES,
    recoveryCases: SYNTHETIC_RECOVERY_CASES,
    consentPolicies: SYNTHETIC_CONSENT_POLICIES,
    evidenceItems: buildSeedEvidenceVault(),
    vaultVerification: {
      valid: true,
      checked_count: 6,
      failed_index: null,
      failed_evidence_id: null,
      reason: null,
    },
    auditNotes: included,
  });
  assert.equal(metrics.auditNoteCount, 1);
});

test('open-source RSS fallback: parses XML items safely and rejects non-HTTP URLs', () => {
  assert.equal(sanitizeExternalHttpUrl('javascript:alert(1)'), undefined);
  assert.equal(
    sanitizeExternalHttpUrl('https://inforegulator.org.za/feed/?utm=1&#038;v=2'),
    'https://inforegulator.org.za/feed/?utm=1&v=2',
  );

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title><![CDATA[FSCA sharpens focus on funeral claims &amp; PPR compliance - Moonstone]]></title>
      <link>https://www.moonstone.co.za/fsca-ppr-update</link>
      <pubDate>Tue, 18 Nov 2026 08:30:00 +0000</pubDate>
      <source>Moonstone</source>
      <description><![CDATA[<p>FSCA issued a Conduct Standard reminder on funeral claims&#8217; SLA.</p>]]></description>
    </item>
    <item>
      <title>FACT SHEET: HANDLING OF SECURITY COMPROMISES</title>
      <link>https://inforegulator.org.za/2025/08/19/fact-sheet/</link>
      <pubDate>Tue, 19 Aug 2025 09:48:16 +0000</pubDate>
      <description>POPIA s22 security compromise reporting rules for responsible parties.</description>
    </item>
  </channel></rss>`;

  const items = parseRssFeedXml(sampleXml, 'Joint / ASISA', 'Test RSS');
  assert.equal(items.length, 2);
  assert.equal(items[0].authority, 'FSCA');
  assert.equal(
    items[0].title,
    'FSCA sharpens focus on funeral claims & PPR compliance',
  );
  assert.equal(items[0].published_period, '2026-11-18');
  assert.ok(!items[0].summary.includes('<p>'));
  assert.equal(items[1].authority, 'POPIA');
  assert.equal(items[1].source_url, 'https://inforegulator.org.za/2025/08/19/fact-sheet/');
});

test('infrastructure health: tracks rolling 16-sample latency buffer, status summary, and sparkline geometry', () => {
  // Rolling ring buffer keeps maxSamples=16 and rounds to 0.1 ms
  let history: number[] = [];
  for (let i = 1; i <= 20; i += 1) {
    history = appendLatencySample(history, i * 1.254, 16);
  }
  assert.equal(history.length, 16);
  assert.equal(history[0], 6.3); // sample 5 (5 * 1.254 = 6.27 -> 6.3)
  assert.equal(history[15], 25.1); // sample 20 (20 * 1.254 = 25.08 -> 25.1)
  assert.ok(computeAverageLatency(history) > 15);
  assert.equal(computeAverageLatency([]), 0);

  // Sparkline geometry handles empty, single-point, flat, and multi-point arrays
  const emptyGeom = buildSparklineGeometry([], 200, 44, 4);
  assert.equal(emptyGeom.linePath, '');
  assert.equal(emptyGeom.lastPoint, null);

  const singleGeom = buildSparklineGeometry([12.4], 200, 44, 4);
  assert.ok(singleGeom.linePath.startsWith('M 4 '));
  assert.ok(singleGeom.areaPath.endsWith('Z'));
  assert.ok(singleGeom.lastPoint !== null);

  const flatGeom = buildSparklineGeometry([8, 8, 8], 200, 44, 4);
  assert.equal(flatGeom.min, 8);
  assert.equal(flatGeom.max, 8);
  assert.equal(flatGeom.lastPoint?.y, 22);

  const multiGeom = buildSparklineGeometry([10, 40, 25], 200, 44, 4);
  assert.equal(multiGeom.min, 10);
  assert.equal(multiGeom.max, 40);
  assert.ok(multiGeom.linePath.includes('L '));

  // Status summarization transitions: all connected -> degraded -> offline
  const baseRecord: IntegrationHealthRecord = {
    id: 'test-1',
    name: 'Test Service',
    category: 'Core',
    endpoint_label: 'local',
    status: 'connected',
    sync_health: 'synced',
    latency_ms: 10,
    avg_latency_ms: 10,
    uptime_pct: 100,
    synced_records: 5,
    last_sync_iso: '2026-11-25T10:00:00Z',
    detail: 'OK',
    latency_history_ms: [10],
  };

  const allOk = summarizeInfrastructureHealth(
    [baseRecord, { ...baseRecord, id: 'test-2', latency_ms: 20 }],
    '2026-11-25T10:00:00Z',
  );
  assert.equal(allOk.overall_status, 'connected');
  assert.equal(allOk.connected_count, 2);
  assert.equal(allOk.mean_latency_ms, 15);

  const mixedDegraded = summarizeInfrastructureHealth(
    [
      baseRecord,
      { ...baseRecord, id: 'test-2', status: 'degraded', latency_ms: 30 },
    ],
    '2026-11-25T10:00:00Z',
  );
  assert.equal(mixedDegraded.overall_status, 'degraded');
  assert.equal(mixedDegraded.degraded_count, 1);

  const allOffline = summarizeInfrastructureHealth(
    [
      { ...baseRecord, status: 'offline', latency_ms: 0 },
      { ...baseRecord, id: 'test-2', status: 'offline', latency_ms: 0 },
    ],
    '2026-11-25T10:00:00Z',
  );
  assert.equal(allOffline.overall_status, 'offline');
  assert.equal(allOffline.offline_count, 2);
});

test('evidence ingestion: validates MIME/magic bytes, sanitizes filenames, extracts claim refs, and masks POPIA PII', () => {
  // Path traversal & dangerous chars stripped
  assert.equal(
    sanitizeIngestionFilename('../../etc/passwd<script>.csv'),
    'passwd_script_.csv',
  );

  // Blocks SVG/HTML XSS-capable MIME types
  assert.equal(normalizeAllowedMime('image/svg+xml', 'diagram.svg'), null);
  assert.equal(normalizeAllowedMime('text/html', 'claim.html'), null);

  // Magic-byte verification rejects spoofed PDF / PNG payloads
  const spoofedPdf = new TextEncoder().encode('<script>alert(1)</script>');
  assert.equal(verifyMagicBytes(spoofedPdf, 'application/pdf').ok, false);
  const validPdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n/Type /Page\n');
  assert.equal(verifyMagicBytes(validPdf, 'application/pdf').ok, true);

  const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(verifyMagicBytes(validPng, 'image/png').ok, true);
  assert.equal(verifyMagicBytes(new Uint8Array([0xff, 0xd8, 0x00]), 'image/png').ok, false);

  // Processes CSV claim bordereaux with PII masking & claim ref extraction
  const csvBytes = new TextEncoder().encode(
    'claim_id,policy_ref,sa_id,phone,amount\nCLM-SYN-9044,SYN-POL-006,8001015009087,0825550199,340000\n',
  );
  const csvResult = processEvidencePayload({
    bytes: csvBytes,
    filename: 'parlour_claims_bordereaux.csv',
    mimeType: 'text/csv',
    binarySha256: 'a'.repeat(64),
    captureMode: 'drag_drop',
    investigatorNote: 'Contact assessor@insurer.co.za for original BI-1663.',
  });
  assert.equal(csvResult.meta.document_class, 'Claims Bordereaux (CSV)');
  assert.equal(csvResult.meta.record_count, 1);
  assert.deepEqual(csvResult.meta.extracted_refs, ['CLM-SYN-9044', 'SYN-POL-006']);
  assert.equal(csvResult.suggested_case_ref, 'CLM-SYN-9044');
  assert.ok(csvResult.meta.pii_redactions_count >= 3);
  assert.equal(csvResult.extracted_summary.includes('8001015009087'), false);
  assert.equal(csvResult.extracted_summary.includes('0825550199'), false);
  assert.equal(csvResult.extracted_summary.includes('assessor@insurer.co.za'), false);
  assert.ok(csvResult.extracted_summary.includes('[SA-ID-REDACTED]'));

  // Camera capture image classification & dimensions metadata
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const camResult = processEvidencePayload({
    bytes: jpegBytes,
    filename: 'death-notice-photo.jpg',
    mimeType: 'image/jpeg',
    binarySha256: 'b'.repeat(64),
    captureMode: 'camera',
    imageDimensions: { width: 1280, height: 720 },
  });
  assert.equal(camResult.meta.capture_mode, 'camera');
  assert.equal(camResult.meta.document_class, 'Death Notice / BI-1663');
  assert.ok(camResult.extracted_summary.includes('1280x720px'));
});



