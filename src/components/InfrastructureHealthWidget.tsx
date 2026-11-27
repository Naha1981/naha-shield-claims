import React from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  buildSparklineGeometry,
  type InfrastructureHealthSnapshot,
  type IntegrationHealthRecord,
  type IntegrationStatus,
  type SyncHealth,
} from '../lib/engine/infrastructureHealth';
import type { RoleId } from '../lib/engine/types';
import { apiFetch } from '../utils/format';

interface InfrastructureHealthWidgetProps {
  activeRole: RoleId;
  onProbed?: () => Promise<void>;
}

const SPARKLINE_WIDTH = 200;
const SPARKLINE_HEIGHT = 44;
const SPARKLINE_PADDING = 5;

function getStatusVisuals(status: IntegrationStatus): {
  label: string;
  textClass: string;
  dotClass: string;
  strokeColor: string;
} {
  if (status === 'connected') {
    return {
      label: 'Connected',
      textClass: 'text-emerald-400',
      dotClass: 'bg-emerald-400',
      strokeColor: '#10B981',
    };
  }
  if (status === 'degraded') {
    return {
      label: 'Degraded',
      textClass: 'text-amber-300',
      dotClass: 'bg-amber-400',
      strokeColor: '#F59E0B',
    };
  }
  return {
    label: 'Offline',
    textClass: 'text-red-400',
    dotClass: 'bg-red-400',
    strokeColor: '#EF4444',
  };
}

function getSyncVisuals(syncHealth: SyncHealth): {
  label: string;
  textClass: string;
} {
  if (syncHealth === 'synced') {
    return { label: 'Synced', textClass: 'text-emerald-400' };
  }
  if (syncHealth === 'lagging') {
    return { label: 'Lagging', textClass: 'text-amber-300' };
  }
  return { label: 'Stale', textClass: 'text-red-400' };
}

function formatUtcTime(iso: string): string {
  if (!iso || iso.length < 19) return '—';
  return `${iso.slice(11, 19)}Z`;
}

const IntegrationSparklineCard: React.FC<{ item: IntegrationHealthRecord }> = ({
  item,
}) => {
  const statusVis = getStatusVisuals(item.status);
  const syncVis = getSyncVisuals(item.sync_health);
  const geom = React.useMemo(
    () =>
      buildSparklineGeometry(
        item.latency_history_ms,
        SPARKLINE_WIDTH,
        SPARKLINE_HEIGHT,
        SPARKLINE_PADDING,
      ),
    [item.latency_history_ms],
  );
  const gradientId = `infra-spark-${item.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <article
      aria-label={`${item.name} health`}
      className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex flex-col justify-between gap-3"
    >
      {/* Top Status & Current Latency Row */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusVis.dotClass}`}
              aria-hidden="true"
            />
            <span className={`font-semibold ${statusVis.textClass}`}>
              {statusVis.label}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className={`font-medium ${syncVis.textClass}`}>
              {syncVis.label}
            </span>
          </div>

          <span className="font-mono font-semibold text-white tabular-nums whitespace-nowrap shrink-0">
            {item.latency_ms.toFixed(1)} ms
          </span>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white leading-snug">
            {item.name}
          </h3>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
            <span>{item.category}</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-slate-400 truncate max-w-full">
              {item.endpoint_label}
            </span>
          </div>
        </div>
      </div>

      {/* Sparkline Chart + Telemetry Strip */}
      <div className="space-y-1.5">
        <div className="rounded bg-slate-950/70 border border-slate-800/80 px-2 py-1.5">
          <svg
            viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
            className="w-full h-11 overflow-visible block"
            role="img"
            aria-label={`${item.name} API latency sparkline: current ${item.latency_ms.toFixed(1)} ms, average ${item.avg_latency_ms.toFixed(1)} ms across ${item.latency_history_ms.length} probe samples`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={statusVis.strokeColor}
                  stopOpacity="0.28"
                />
                <stop
                  offset="100%"
                  stopColor={statusVis.strokeColor}
                  stopOpacity="0.02"
                />
              </linearGradient>
            </defs>

            {geom.areaPath && (
              <path d={geom.areaPath} fill={`url(#${gradientId})`} />
            )}
            {geom.linePath && (
              <path
                d={geom.linePath}
                fill="none"
                stroke={statusVis.strokeColor}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {geom.lastPoint && (
              <circle
                cx={geom.lastPoint.x}
                cy={geom.lastPoint.y}
                r="2.75"
                fill={statusVis.strokeColor}
                stroke="#0F172A"
                strokeWidth="1.25"
              />
            )}
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-mono text-slate-400 tabular-nums">
          <span>
            {geom.min.toFixed(1)}–{geom.max.toFixed(1)} ms · Avg{' '}
            <span className="text-slate-200">
              {item.avg_latency_ms.toFixed(1)} ms
            </span>
          </span>
          <span>
            <span className="text-slate-200">{item.uptime_pct.toFixed(1)}%</span>{' '}
            uptime · {item.latency_history_ms.length}{' '}
            {item.latency_history_ms.length === 1 ? 'probe' : 'probes'}
          </span>
        </div>
      </div>

      {/* Sync Details Footer */}
      <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-1 text-[11px] text-slate-400">
        <div className="text-slate-300 leading-snug">{item.detail}</div>
        <div className="flex items-center justify-between gap-2 font-mono text-slate-400 tabular-nums">
          <span>{item.synced_records} synced records</span>
          <span>Sync {formatUtcTime(item.last_sync_iso)}</span>
        </div>
      </div>
    </article>
  );
};

export const InfrastructureHealthWidget: React.FC<
  InfrastructureHealthWidgetProps
> = ({ activeRole, onProbed }) => {
  const [snapshot, setSnapshot] =
    React.useState<InfrastructureHealthSnapshot | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [probing, setProbing] = React.useState<boolean>(false);
  const [autoPoll, setAutoPoll] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const runHealthFetch = React.useCallback(
    async (forceProbe: boolean) => {
      if (forceProbe) {
        setProbing(true);
      } else {
        setLoading((prev) => (snapshot ? prev : true));
      }
      setError(null);
      try {
        const path = forceProbe
          ? '/api/infrastructure/health?force=1'
          : '/api/infrastructure/health';
        const data = await apiFetch<
          InfrastructureHealthSnapshot & { ok?: boolean }
        >(path, activeRole);
        setSnapshot(data);
        if (forceProbe && onProbed) {
          await onProbed();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to reach infrastructure health probe endpoint.',
        );
      } finally {
        setLoading(false);
        setProbing(false);
      }
    },
    [activeRole, onProbed, snapshot],
  );

  React.useEffect(() => {
    void runHealthFetch(false);
    // Run once on mount or role switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole]);

  React.useEffect(() => {
    if (!autoPoll) return;
    const timer = window.setInterval(() => {
      void runHealthFetch(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoPoll, runHealthFetch]);

  const totalIntegrations = snapshot?.integrations.length ?? 0;

  return (
    <section
      aria-label="Infrastructure Health"
      className="rounded-md bg-[#131C31] border border-slate-800 p-4 sm:p-5 space-y-4"
    >
      {/* Header + Summary Metadata + Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Infrastructure Health
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 tabular-nums">
            <span>
              Real-time connectivity, API latency &amp; sync health across live product integrations
            </span>
            {snapshot && !loading && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    snapshot.overall_status === 'connected'
                      ? 'text-emerald-400 font-medium'
                      : snapshot.overall_status === 'degraded'
                        ? 'text-amber-300 font-medium'
                        : 'text-red-400 font-medium'
                  }
                >
                  {snapshot.connected_count}/{totalIntegrations} Connected
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-200">
                  Mean Latency {snapshot.mean_latency_ms.toFixed(1)} ms
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-400">
                  Last probed {formatUtcTime(snapshot.probed_at)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            aria-pressed={autoPoll}
            onClick={() => setAutoPoll((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              autoPoll
                ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
                : 'border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300'
            }`}
          >
            {autoPoll ? 'Auto-Poll 30s: On' : 'Auto-Poll 30s'}
          </button>

          <button
            type="button"
            disabled={loading || probing}
            onClick={() => void runHealthFetch(true)}
            aria-label="Probe infrastructure integrations now"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${loading || probing ? 'animate-spin' : ''}`}
            />
            {probing ? 'Probing...' : 'Probe Now'}
          </button>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {loading && !snapshot && (
        <div
          aria-busy="true"
          aria-label="Loading infrastructure health probes"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
        >
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 space-y-2.5 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-3 w-28 bg-slate-800 rounded" />
                <div className="h-3 w-14 bg-slate-800 rounded" />
              </div>
              <div className="h-4 w-3/4 bg-slate-800 rounded" />
              <div className="h-11 w-full bg-slate-800/80 rounded" />
              <div className="h-3 w-full bg-slate-800/70 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Explicit Error State */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-md bg-amber-950/40 border border-amber-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-100">
                Infrastructure Health Probe Failed
              </div>
              <p className="text-amber-200/90 mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runHealthFetch(true)}
            className="px-3 py-1.5 rounded border border-amber-500/50 bg-amber-900/50 hover:bg-amber-900 text-amber-100 font-medium whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Retry Probe
          </button>
        </div>
      )}

      {/* Integration Sparkline Cards */}
      {snapshot && snapshot.integrations.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {snapshot.integrations.map((item) => (
            <IntegrationSparklineCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
};
