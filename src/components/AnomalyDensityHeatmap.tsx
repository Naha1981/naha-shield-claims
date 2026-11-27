import React from 'react';
import { ArrowUpRight, BellRing, Flame } from 'lucide-react';
import {
  ANOMALY_PATTERNS,
  buildAnomalyDensityMatrix,
  type AnomalyAlertRecord,
  type AnomalyPatternId,
} from '../lib/engine/anomaly';
import type { ConsentPolicyInput } from '../lib/engine/types';
import { formatZar, formatZarCompact } from '../utils/format';
import type { NavRoute } from './LayoutShell';

interface AnomalyDensityHeatmapProps {
  consentPolicies: ConsentPolicyInput[];
  anomalyThresholdPct: number;
  anomalyAlerts: AnomalyAlertRecord[];
  onUpdateThreshold: (thresholdPct: number) => Promise<void>;
  onNavigate?: (route: NavRoute) => void;
}

const THRESHOLD_PRESETS = [
  { pct: 75, label: '75% Critical' },
  { pct: 50, label: '50% High' },
  { pct: 15, label: '15% Sensitive' },
];

function getCellHeatClasses(
  densityPct: number,
  selected: boolean,
  breached: boolean,
): string {
  const ring = selected
    ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#0F172A]'
    : breached
      ? 'ring-1 ring-red-400/70'
      : '';
  if (densityPct === 0) {
    return `bg-slate-900/60 border-slate-800/90 text-slate-500 hover:border-slate-700 ${ring}`;
  }
  if (densityPct < 40) {
    return `bg-amber-950/45 border-amber-700/50 text-amber-200 hover:border-amber-500 ${ring}`;
  }
  if (densityPct < 75) {
    return `bg-orange-950/60 border-orange-600/60 text-orange-200 hover:border-orange-400 ${ring}`;
  }
  return `bg-red-950/75 border-red-500/70 text-red-100 hover:border-red-400 ${ring}`;
}

export const AnomalyDensityHeatmap: React.FC<AnomalyDensityHeatmapProps> = ({
  consentPolicies,
  anomalyThresholdPct,
  anomalyAlerts,
  onUpdateThreshold,
  onNavigate,
}) => {
  const [thresholdBusy, setThresholdBusy] = React.useState(false);

  const matrix = React.useMemo(
    () => buildAnomalyDensityMatrix(consentPolicies),
    [consentPolicies],
  );

  const alertByFingerprint = React.useMemo(() => {
    const map = new Map<string, AnomalyAlertRecord>();
    for (const a of anomalyAlerts) {
      map.set(a.fingerprint, a);
    }
    return map;
  }, [anomalyAlerts]);

  const unacknowledgedCount = React.useMemo(
    () => anomalyAlerts.filter((a) => !a.acknowledged).length,
    [anomalyAlerts],
  );

  const defaultSelection = React.useMemo(() => {
    for (const seg of matrix.segments) {
      for (const pat of ANOMALY_PATTERNS) {
        if (seg.cells[pat.id].count > 0) {
          return { productType: seg.productType, patternId: pat.id };
        }
      }
    }
    return {
      productType: matrix.segments[0]?.productType ?? '',
      patternId: ANOMALY_PATTERNS[0].id,
    };
  }, [matrix]);

  const [selectedCell, setSelectedCell] = React.useState<{
    productType: string;
    patternId: AnomalyPatternId;
  }>(defaultSelection);

  const activeSegment =
    matrix.segments.find((s) => s.productType === selectedCell.productType) ??
    matrix.segments[0];
  const activePattern =
    ANOMALY_PATTERNS.find((p) => p.id === selectedCell.patternId) ??
    ANOMALY_PATTERNS[0];
  const activeCell = activeSegment?.cells[activePattern.id];

  async function handlePresetClick(pct: number) {
    if (pct === anomalyThresholdPct || thresholdBusy) return;
    setThresholdBusy(true);
    try {
      await onUpdateThreshold(pct);
    } finally {
      setThresholdBusy(false);
    }
  }

  return (
    <section
      aria-label="Anomaly Density Heatmap"
      className="rounded-md bg-[#131C31] border border-slate-800 p-4 sm:p-5 space-y-4"
    >
      {/* Header + Threshold Controls + Heat Scale Legend */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Anomaly Density Heatmap
            </h2>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 tabular-nums inline-flex items-center gap-1">
              <BellRing className="w-3 h-3 text-amber-400" />
              Alert ≥{anomalyThresholdPct}% ({unacknowledgedCount} active)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            High-risk transactional pattern concentration across insurance product segments ({matrix.totalFlaggedSignals} active risk signals across {matrix.totalPolicies} policies · age-free PEPUDA rules).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
          {/* Threshold Selector */}
          <div
            role="group"
            aria-label="Anomaly Alert Threshold"
            className="inline-flex items-center gap-1 p-1 rounded-md bg-slate-900 border border-slate-800 self-start"
          >
            <span className="text-[11px] text-slate-400 px-1.5 whitespace-nowrap">
              Threshold:
            </span>
            {THRESHOLD_PRESETS.map((preset) => (
              <button
                key={preset.pct}
                type="button"
                disabled={thresholdBusy}
                onClick={() => handlePresetClick(preset.pct)}
                aria-label={`${preset.label}, set anomaly alert threshold`}
                className={`px-2 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                  anomalyThresholdPct === preset.pct
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Calibrated Heat Scale */}
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-900 border border-slate-700" />
              0%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-950/70 border border-amber-600/70" />
              1–39%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-orange-950/80 border border-orange-500/80" />
              40–74%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-red-950/90 border border-red-500" />
              75–100%
            </span>
          </div>
        </div>
      </div>

      {/* Heatmap Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-1.5 text-xs min-w-[740px]">
          <thead>
            <tr className="text-[11px] text-slate-400">
              <th className="py-1.5 px-2 font-medium w-48">
                Product Segment
              </th>
              {ANOMALY_PATTERNS.map((pattern) => (
                <th
                  key={pattern.id}
                  className="py-1.5 px-2 font-medium text-center"
                >
                  {pattern.shortLabel}
                </th>
              ))}
              <th className="py-1.5 px-2 font-medium text-right w-32">
                Composite Index
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.segments.map((seg) => (
              <tr key={seg.productType}>
                <td className="py-2 px-2.5 rounded bg-[#0F172A] border border-slate-800 align-middle">
                  <div className="font-semibold text-slate-100">
                    {seg.productType}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                    {seg.totalPolicies} policies · {formatZarCompact(seg.totalExposureZar)} gap
                  </div>
                </td>

                {ANOMALY_PATTERNS.map((pattern) => {
                  const cell = seg.cells[pattern.id];
                  const isSelected =
                    activeSegment?.productType === seg.productType &&
                    activePattern.id === pattern.id;
                  const fp = `${seg.productType}::${pattern.id}`;
                  const alert = alertByFingerprint.get(fp);
                  const breached = cell.densityPct >= anomalyThresholdPct && cell.count > 0;

                  return (
                    <td key={pattern.id} className="p-0 align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedCell({
                            productType: seg.productType,
                            patternId: pattern.id,
                          })
                        }
                        title={`${breached?(alert?.acknowledged?'ACK ':'ALERT '):''}${cell.densityPct}% ${cell.count}/${cell.totalInSegment}, ${seg.productType} ${pattern.label}`}
                        className={`relative w-full py-2.5 px-2 rounded border text-center transition-all cursor-pointer ${getCellHeatClasses(
                          cell.densityPct,
                          isSelected,
                          breached && !alert?.acknowledged,
                        )}`}
                      >
                        {breached && (
                          <span
                            className={`absolute top-1 right-1 font-mono text-[9px] font-bold px-1 rounded-xs leading-tight ${
                              alert?.acknowledged
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-red-600 text-white'
                            }`}
                          >
                            {alert?.acknowledged ? 'ACK' : 'ALERT'}
                          </span>
                        )}
                        <span className="sr-only">{seg.productType}, {pattern.label}. </span><div className="font-mono text-sm font-bold tabular-nums leading-tight">
                          {cell.densityPct}%
                        </div>
                        <div className="font-mono text-[10px] tabular-nums mt-0.5">
                          {cell.count}/{cell.totalInSegment}
                        </div>
                      </button>
                    </td>
                  );
                })}

                <td className="py-2 px-2.5 rounded bg-[#0F172A] border border-slate-800 text-right align-middle">
                  <div
                    className={`font-mono text-sm font-bold tabular-nums ${
                      seg.compositeDensityPct >= 50
                        ? 'text-red-400'
                        : seg.compositeDensityPct >= 25
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                    }`}
                  >
                    {seg.compositeDensityPct}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    segment density
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Selected Cell Diagnostic Inspector */}
      {activeSegment && activeCell && (
        <div className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white">
                {activeSegment.productType}
              </span>
              <span className="text-slate-500" aria-hidden="true">
                ×
              </span>
              <span className="font-semibold text-emerald-300">
                {activePattern.label}
              </span>
              <span className="font-mono text-slate-300 tabular-nums">
                ({activeCell.count}/{activeCell.totalInSegment} policies ·{' '}
                {activeCell.densityPct}% density ·{' '}
                {formatZar(activeCell.exposureZar)} cover scope)
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              {activePattern.governanceNote}
              {activeCell.policyIds.length > 0 && (
                <span className="font-mono text-slate-300 ml-1.5">
                  Affected: {activeCell.policyIds.join(', ')}
                </span>
              )}
            </p>
          </div>

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('/consent')}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 text-slate-200 hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start lg:self-auto"
            >
              Inspect in Consent Integrity
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
