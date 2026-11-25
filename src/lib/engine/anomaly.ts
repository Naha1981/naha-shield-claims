import { DEFAULT_ORG_RULES } from './rules';
import { evaluateConsentPolicy } from './consent';
import type { ConsentPolicyInput } from './types';

export type AnomalyPatternId =
  | 'missing_consent'
  | 'unverified_channel_sim'
  | 'cover_spike_12m'
  | 'multi_life_payer'
  | 'non_immediate_or_duress';

export interface AnomalyPatternDefinition {
  id: AnomalyPatternId;
  label: string;
  shortLabel: string;
  governanceNote: string;
}

export const ANOMALY_PATTERNS: AnomalyPatternDefinition[] = [
  {
    id: 'missing_consent',
    label: 'Missing Third-Party Consent',
    shortLabel: 'Missing Consent',
    governanceNote:
      'POPIA s11(1)(a) & PPR 2A: out-of-band consent capture required before cover reliance.',
  },
  {
    id: 'unverified_channel_sim',
    label: 'Burner SIM / Unverified Channel',
    shortLabel: 'Burner SIM / Channel',
    governanceNote:
      'Independent KYC / CRM contact provenance missing; block agent-supplied SIM routing.',
  },
  {
    id: 'cover_spike_12m',
    label: '12-Month Cover Spike',
    shortLabel: '12m Cover Spike',
    governanceNote:
      'Escalated structural tiering triggered by recent sum-assured increase within 12 months.',
  },
  {
    id: 'multi_life_payer',
    label: 'Multi-Life Single Payer (≥3)',
    shortLabel: 'Multi-Life Payer',
    governanceNote:
      'Single payer funding 3+ unrelated lives; screen for syndicate policy aggregation.',
  },
  {
    id: 'non_immediate_or_duress',
    label: 'Non-Immediate / Silent Duress',
    shortLabel: 'Non-Immed. / Duress',
    governanceNote:
      'Non-immediate beneficiary or silent duress ("Not Me") flag; route to Underwriter Hold Queue.',
  },
];

export interface AnomalyHeatmapCell {
  patternId: AnomalyPatternId;
  count: number;
  totalInSegment: number;
  densityPct: number;
  exposureZar: number;
  policyIds: string[];
}

export interface AnomalySegmentRow {
  productType: string;
  totalPolicies: number;
  totalExposureZar: number;
  compositeDensityPct: number;
  cells: Record<AnomalyPatternId, AnomalyHeatmapCell>;
}

export interface AnomalyDensityMatrix {
  segments: AnomalySegmentRow[];
  totalPolicies: number;
  totalFlaggedSignals: number;
  highestRiskSegment: string | null;
}

export interface AnomalyAlertRecord {
  alert_id: string;
  fingerprint: string;
  product_type: string;
  pattern_id: AnomalyPatternId | 'composite';
  pattern_label: string;
  density_pct: number;
  threshold_pct: number;
  affected_count: number;
  total_in_segment: number;
  exposure_zar: number;
  severity: 'critical' | 'high';
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  triggered_at: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildAnomalyDensityMatrix(
  policies: ConsentPolicyInput[],
): AnomalyDensityMatrix {
  const byProduct = new Map<string, ConsentPolicyInput[]>();
  for (const p of policies) {
    const list = byProduct.get(p.product_type) ?? [];
    list.push(p);
    byProduct.set(p.product_type, list);
  }

  let totalFlaggedSignals = 0;
  const segments: AnomalySegmentRow[] = [];

  for (const [productType, group] of byProduct.entries()) {
    const totalInSegment = group.length;
    const buckets: Record<
      AnomalyPatternId,
      { count: number; exposureZar: number; policyIds: string[] }
    > = {
      missing_consent: { count: 0, exposureZar: 0, policyIds: [] },
      unverified_channel_sim: { count: 0, exposureZar: 0, policyIds: [] },
      cover_spike_12m: { count: 0, exposureZar: 0, policyIds: [] },
      multi_life_payer: { count: 0, exposureZar: 0, policyIds: [] },
      non_immediate_or_duress: { count: 0, exposureZar: 0, policyIds: [] },
    };

    let segmentExposure = 0;
    let segmentSignalHits = 0;

    for (const p of group) {
      const ev = evaluateConsentPolicy(p);
      const effectiveCover = round2(
        p.cover_amount * Math.max(p.accidental_multiplier, 1),
      );
      segmentExposure += ev.exposure_at_gap;

      const hits: Record<AnomalyPatternId, boolean> = {
        missing_consent: ev.consent_gap_status === 'CONSENT GAP',
        unverified_channel_sim:
          ev.third_party &&
          (!p.independent_contact_on_file ||
            ev.consent_gap_status === 'CHANNEL NOT INDEPENDENT'),
        cover_spike_12m: p.cover_increase_12m,
        multi_life_payer:
          p.unrelated_lives_same_payer >=
          DEFAULT_ORG_RULES.unrelated_lives_escalation_threshold,
        non_immediate_or_duress:
          p.beneficiary_relationship === 'Non-immediate' || p.duress_alert,
      };

      for (const pattern of ANOMALY_PATTERNS) {
        if (hits[pattern.id]) {
          buckets[pattern.id].count += 1;
          buckets[pattern.id].exposureZar = round2(
            buckets[pattern.id].exposureZar + effectiveCover,
          );
          buckets[pattern.id].policyIds.push(p.policy_id);
          segmentSignalHits += 1;
          totalFlaggedSignals += 1;
        }
      }
    }

    const cells = {} as Record<AnomalyPatternId, AnomalyHeatmapCell>;
    for (const pattern of ANOMALY_PATTERNS) {
      const b = buckets[pattern.id];
      cells[pattern.id] = {
        patternId: pattern.id,
        count: b.count,
        totalInSegment,
        densityPct:
          totalInSegment > 0 ? Math.round((b.count / totalInSegment) * 100) : 0,
        exposureZar: b.exposureZar,
        policyIds: b.policyIds,
      };
    }

    const maxPossibleHits = Math.max(
      totalInSegment * ANOMALY_PATTERNS.length,
      1,
    );
    const compositeDensityPct = Math.round(
      (segmentSignalHits / maxPossibleHits) * 100,
    );

    segments.push({
      productType,
      totalPolicies: totalInSegment,
      totalExposureZar: round2(segmentExposure),
      compositeDensityPct,
      cells,
    });
  }

  segments.sort(
    (a, b) =>
      b.compositeDensityPct - a.compositeDensityPct ||
      b.totalExposureZar - a.totalExposureZar,
  );

  return {
    segments,
    totalPolicies: policies.length,
    totalFlaggedSignals,
    highestRiskSegment: segments[0]?.productType ?? null,
  };
}

export function evaluateAnomalyThresholdAlerts(params: {
  policies: ConsentPolicyInput[];
  thresholdPct: number;
  existingAlerts: AnomalyAlertRecord[];
  nowIso?: string;
}): {
  alerts: AnomalyAlertRecord[];
  newlyTriggered: AnomalyAlertRecord[];
} {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const matrix = buildAnomalyDensityMatrix(params.policies);
  const existingByFp = new Map<string, AnomalyAlertRecord>();
  for (const a of params.existingAlerts) {
    existingByFp.set(a.fingerprint, a);
  }

  const nextAlerts: AnomalyAlertRecord[] = [];
  const newlyTriggered: AnomalyAlertRecord[] = [];
  const seenFingerprints = new Set<string>();

  for (const seg of matrix.segments) {
    for (const pattern of ANOMALY_PATTERNS) {
      const cell = seg.cells[pattern.id];
      if (cell.count === 0 || cell.densityPct < params.thresholdPct) {
        continue;
      }

      const fingerprint = `${seg.productType}::${pattern.id}`;
      seenFingerprints.add(fingerprint);
      const prev = existingByFp.get(fingerprint);

      const severity: AnomalyAlertRecord['severity'] =
        cell.densityPct >= 75 ? 'critical' : 'high';

      if (prev) {
        // If density increased above what was acknowledged, re-open alert as newly detected escalation
        const densityEscalated =
          prev.acknowledged && cell.densityPct > prev.density_pct;

        const updated: AnomalyAlertRecord = {
          ...prev,
          density_pct: cell.densityPct,
          threshold_pct: params.thresholdPct,
          affected_count: cell.count,
          total_in_segment: cell.totalInSegment,
          exposure_zar: cell.exposureZar,
          severity,
          acknowledged: densityEscalated ? false : prev.acknowledged,
          acknowledged_by: densityEscalated ? null : prev.acknowledged_by,
          acknowledged_at: densityEscalated ? null : prev.acknowledged_at,
          triggered_at: densityEscalated ? nowIso : prev.triggered_at,
        };
        nextAlerts.push(updated);
        if (densityEscalated) {
          newlyTriggered.push(updated);
        }
      } else {
        const slug = `${seg.productType}-${pattern.id}`
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .slice(0, 36);
        const created: AnomalyAlertRecord = {
          alert_id: `ALT-${slug}`,
          fingerprint,
          product_type: seg.productType,
          pattern_id: pattern.id,
          pattern_label: pattern.label,
          density_pct: cell.densityPct,
          threshold_pct: params.thresholdPct,
          affected_count: cell.count,
          total_in_segment: cell.totalInSegment,
          exposure_zar: cell.exposureZar,
          severity,
          acknowledged: false,
          acknowledged_by: null,
          acknowledged_at: null,
          triggered_at: nowIso,
        };
        nextAlerts.push(created);
        newlyTriggered.push(created);
      }
    }
  }

  // Sort unacknowledged + highest density first
  nextAlerts.sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    return b.density_pct - a.density_pct || b.exposure_zar - a.exposure_zar;
  });

  return {
    alerts: nextAlerts,
    newlyTriggered,
  };
}
