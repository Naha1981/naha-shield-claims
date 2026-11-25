export type IntegrationStatus = 'connected' | 'degraded' | 'offline';
export type SyncHealth = 'synced' | 'lagging' | 'stale';

export interface IntegrationHealthRecord {
  id: string;
  name: string;
  category: string;
  endpoint_label: string;
  status: IntegrationStatus;
  sync_health: SyncHealth;
  latency_ms: number;
  avg_latency_ms: number;
  uptime_pct: number;
  synced_records: number;
  last_sync_iso: string;
  detail: string;
  latency_history_ms: number[];
}

export interface InfrastructureHealthSnapshot {
  probed_at: string;
  overall_status: IntegrationStatus;
  connected_count: number;
  degraded_count: number;
  offline_count: number;
  mean_latency_ms: number;
  integrations: IntegrationHealthRecord[];
}

export interface SparklineGeometry {
  linePath: string;
  areaPath: string;
  lastPoint: { x: number; y: number } | null;
  min: number;
  max: number;
}

export function roundLatencyMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms * 10) / 10;
}

export function appendLatencySample(
  history: number[],
  sampleMs: number,
  maxSamples = 16,
): number[] {
  const clean = roundLatencyMs(sampleMs);
  const next = [...history, clean];
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}

export function computeAverageLatency(history: number[]): number {
  if (history.length === 0) return 0;
  const total = history.reduce((sum, v) => sum + v, 0);
  return roundLatencyMs(total / history.length);
}

export function summarizeInfrastructureHealth(
  integrations: IntegrationHealthRecord[],
  probedAtIso: string,
): InfrastructureHealthSnapshot {
  let connectedCount = 0;
  let degradedCount = 0;
  let offlineCount = 0;
  let latencySum = 0;

  for (const item of integrations) {
    if (item.status === 'connected') connectedCount += 1;
    else if (item.status === 'degraded') degradedCount += 1;
    else offlineCount += 1;
    latencySum += item.latency_ms;
  }

  const overallStatus: IntegrationStatus =
    offlineCount > 0 && connectedCount === 0
      ? 'offline'
      : offlineCount > 0 || degradedCount > 0
        ? 'degraded'
        : 'connected';

  const meanLatencyMs =
    integrations.length > 0
      ? roundLatencyMs(latencySum / integrations.length)
      : 0;

  return {
    probed_at: probedAtIso,
    overall_status: overallStatus,
    connected_count: connectedCount,
    degraded_count: degradedCount,
    offline_count: offlineCount,
    mean_latency_ms: meanLatencyMs,
    integrations,
  };
}

export function buildSparklineGeometry(
  values: number[],
  width: number,
  height: number,
  padding = 4,
): SparklineGeometry {
  if (values.length === 0 || width <= padding * 2 || height <= padding * 2) {
    return {
      linePath: '',
      areaPath: '',
      lastPoint: null,
      min: 0,
      max: 0,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const coords = values.map((val, idx) => {
    const x =
      values.length === 1
        ? padding + innerW / 2
        : padding + (idx / (values.length - 1)) * innerW;
    const normalized = span > 0 ? (val - min) / span : 0.5;
    const y = padding + innerH * (1 - normalized);
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
    };
  });

  const linePath =
    coords.length === 1
      ? `M ${padding} ${coords[0].y} L ${width - padding} ${coords[0].y}`
      : coords
          .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
          .join(' ');

  const baselineY = height - padding;
  const areaPath =
    coords.length === 1
      ? `M ${padding} ${baselineY} L ${padding} ${coords[0].y} L ${width - padding} ${coords[0].y} L ${width - padding} ${baselineY} Z`
      : `${linePath} L ${coords[coords.length - 1].x} ${baselineY} L ${coords[0].x} ${baselineY} Z`;

  return {
    linePath,
    areaPath,
    lastPoint: coords[coords.length - 1],
    min: roundLatencyMs(min),
    max: roundLatencyMs(max),
  };
}
