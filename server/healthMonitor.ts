import type { NahaShieldStore } from './store';
import { buildAnomalyDensityMatrix } from '../src/lib/engine/anomaly';
import {
  appendLatencySample,
  computeAverageLatency,
  roundLatencyMs,
  summarizeInfrastructureHealth,
  type InfrastructureHealthSnapshot,
  type IntegrationHealthRecord,
  type IntegrationStatus,
  type SyncHealth,
} from '../src/lib/engine/infrastructureHealth';
import { verifyEvidenceChain } from '../src/lib/engine/vault';

interface IntegrationTracker {
  history: number[];
  successes: number;
  totalChecks: number;
  lastSyncIso: string;
}

export interface GeminiHealthObservation {
  status: IntegrationStatus;
  latencyMs: number;
  detail: string;
  observedAtIso: string;
}

const MAX_SAMPLES = 16;

export class InfrastructureHealthMonitor {
  private trackers = new Map<string, IntegrationTracker>();
  private lastExternalResult: {
    inforeg?: {
      status: IntegrationStatus;
      syncHealth: SyncHealth;
      latencyMs: number;
      itemCount: number;
      detail: string;
      fetchedAtMs: number;
    };
    fsca?: {
      status: IntegrationStatus;
      syncHealth: SyncHealth;
      latencyMs: number;
      itemCount: number;
      detail: string;
      fetchedAtMs: number;
    };
    gemini?: GeminiHealthObservation & { fetchedAtMs: number };
  } = {};

  private geminiObservation: GeminiHealthObservation | null = null;
  private lastSnapshot: InfrastructureHealthSnapshot | null = null;
  private probingPromise: Promise<InfrastructureHealthSnapshot> | null = null;

  public recordGeminiObservation(obs: GeminiHealthObservation): void {
    this.geminiObservation = obs;
  }

  private recordSample(
    id: string,
    status: IntegrationStatus,
    latencyMs: number,
    nowIso: string,
  ): { history: number[]; avgMs: number; uptimePct: number; lastSyncIso: string } {
    const existing = this.trackers.get(id) ?? {
      history: [],
      successes: 0,
      totalChecks: 0,
      lastSyncIso: nowIso,
    };

    const history = appendLatencySample(existing.history, latencyMs, MAX_SAMPLES);
    const totalChecks = existing.totalChecks + 1;
    const successes =
      existing.successes + (status === 'connected' ? 1 : status === 'degraded' ? 0.5 : 0);
    const lastSyncIso = status !== 'offline' ? nowIso : existing.lastSyncIso;

    this.trackers.set(id, {
      history,
      successes,
      totalChecks,
      lastSyncIso,
    });

    return {
      history,
      avgMs: computeAverageLatency(history),
      uptimePct: Math.round((successes / totalChecks) * 1000) / 10,
      lastSyncIso,
    };
  }

  private async probeRssEndpoint(params: {
    key: 'inforeg' | 'fsca';
    url: string;
    hostLabel: string;
    force: boolean;
  }): Promise<{
    status: IntegrationStatus;
    syncHealth: SyncHealth;
    latencyMs: number;
    itemCount: number;
    detail: string;
  }> {
    const cached = this.lastExternalResult[params.key];
    if (!params.force && cached && Date.now() - cached.fetchedAtMs < 45_000) {
      return cached;
    }

    const start = performance.now();
    try {
      const res = await fetch(params.url, {
        headers: {
          'User-Agent': 'NahaShield-HealthMonitor/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9',
        },
        signal: AbortSignal.timeout(4500),
      });
      const xml = await res.text();
      const latencyMs = roundLatencyMs(performance.now() - start);
      const itemCount = (xml.match(/<item\b/gi) ?? []).length;

      if (!res.ok) {
        const out = {
          status: 'degraded' as IntegrationStatus,
          syncHealth: 'lagging' as SyncHealth,
          latencyMs,
          itemCount,
          detail: `HTTP ${res.status} from ${params.hostLabel}`,
          fetchedAtMs: Date.now(),
        };
        this.lastExternalResult[params.key] = out;
        return out;
      }

      const out = {
        status: (itemCount > 0 ? 'connected' : 'degraded') as IntegrationStatus,
        syncHealth: (itemCount > 0 ? 'synced' : 'lagging') as SyncHealth,
        latencyMs,
        itemCount,
        detail: `HTTP 200 · ${itemCount} live XML items indexed`,
        fetchedAtMs: Date.now(),
      };
      this.lastExternalResult[params.key] = out;
      return out;
    } catch (err) {
      const latencyMs = roundLatencyMs(performance.now() - start);
      const out = {
        status: 'offline' as IntegrationStatus,
        syncHealth: 'stale' as SyncHealth,
        latencyMs,
        itemCount: 0,
        detail:
          err instanceof Error
            ? err.message
            : `Timeout probing ${params.hostLabel}`,
        fetchedAtMs: Date.now(),
      };
      this.lastExternalResult[params.key] = out;
      return out;
    }
  }

  private async probeGeminiEndpoint(
    force: boolean,
    nowIso: string,
  ): Promise<{
    status: IntegrationStatus;
    syncHealth: SyncHealth;
    latencyMs: number;
    detail: string;
  }> {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'MY_GEMINI_API_KEY') {
      return {
        status: 'offline',
        syncHealth: 'stale',
        latencyMs: 0,
        detail: 'GEMINI_API_KEY not configured (RSS fallback active)',
      };
    }

    if (
      !force &&
      this.geminiObservation &&
      Date.now() - Date.parse(this.geminiObservation.observedAtIso) < 120_000
    ) {
      return {
        status: this.geminiObservation.status,
        syncHealth:
          this.geminiObservation.status === 'connected' ? 'synced' : 'lagging',
        latencyMs: this.geminiObservation.latencyMs,
        detail: this.geminiObservation.detail,
      };
    }

    const cached = this.lastExternalResult.gemini;
    if (!force && cached && Date.now() - cached.fetchedAtMs < 60_000) {
      return {
        status: cached.status,
        syncHealth: cached.status === 'connected' ? 'synced' : 'lagging',
        latencyMs: cached.latencyMs,
        detail: cached.detail,
      };
    }

    // Lightweight metadata probe against Gemini API endpoint (does not consume generation tokens)
    const start = performance.now();
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash',
        {
          headers: { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(4000),
        },
      );
      const latencyMs = roundLatencyMs(performance.now() - start);

      // If recent regulatory-feed generation hit 429 quota, reflect degraded status honestly
      if (
        this.geminiObservation &&
        this.geminiObservation.status === 'degraded' &&
        Date.now() - Date.parse(this.geminiObservation.observedAtIso) < 180_000
      ) {
        const out = {
          status: 'degraded' as IntegrationStatus,
          latencyMs,
          detail: this.geminiObservation.detail,
          observedAtIso: nowIso,
          fetchedAtMs: Date.now(),
        };
        this.lastExternalResult.gemini = out;
        return {
          status: out.status,
          syncHealth: 'lagging',
          latencyMs: out.latencyMs,
          detail: out.detail,
        };
      }

      if (res.status === 429) {
        const out = {
          status: 'degraded' as IntegrationStatus,
          latencyMs,
          detail: '429 RESOURCE_EXHAUSTED (open-source RSS fallback active)',
          observedAtIso: nowIso,
          fetchedAtMs: Date.now(),
        };
        this.lastExternalResult.gemini = out;
        return {
          status: out.status,
          syncHealth: 'lagging',
          latencyMs,
          detail: out.detail,
        };
      }

      const status: IntegrationStatus = res.ok ? 'connected' : 'degraded';
      const detail = res.ok
        ? 'API key reachable · search grounding endpoint ready'
        : `HTTP ${res.status} from Gemini API`;
      this.lastExternalResult.gemini = {
        status,
        latencyMs,
        detail,
        observedAtIso: nowIso,
        fetchedAtMs: Date.now(),
      };
      return {
        status,
        syncHealth: res.ok ? 'synced' : 'lagging',
        latencyMs,
        detail,
      };
    } catch (err) {
      const latencyMs = roundLatencyMs(performance.now() - start);
      return {
        status: 'offline',
        syncHealth: 'stale',
        latencyMs,
        detail:
          err instanceof Error ? err.message : 'Gemini endpoint unreachable',
      };
    }
  }

  public async runProbe(
    store: NahaShieldStore,
    options?: { force?: boolean },
  ): Promise<InfrastructureHealthSnapshot> {
    const force = Boolean(options?.force);

    if (!force && this.probingPromise) {
      return this.probingPromise;
    }

    const execute = async (): Promise<InfrastructureHealthSnapshot> => {
      const nowIso = new Date().toISOString();
      const snap = store.getSnapshot();

      // 1. Real Persistence Store Probe
      const storePing = await store.pingStore();
      const storeRecordCount =
        snap.recovery_cases.length +
        snap.ledger_entries.length +
        snap.consent_policies.length +
        snap.claims_preview.length;
      const storeTracker = this.recordSample(
        'policy_claims_store',
        storePing.ok ? 'connected' : 'offline',
        storePing.latencyMs,
        nowIso,
      );

      // 2. Real SHA-256 Evidence Custody Engine Probe
      const vaultStart = performance.now();
      const vaultCheck = verifyEvidenceChain(snap.evidence_items);
      const vaultLatencyMs = roundLatencyMs(performance.now() - vaultStart);
      const vaultStatus: IntegrationStatus = vaultCheck.valid
        ? 'connected'
        : 'degraded';
      const vaultTracker = this.recordSample(
        'evidence_vault_crypto',
        vaultStatus,
        vaultLatencyMs,
        nowIso,
      );

      // 3. Real Product Anomaly & Consent Matrix Engine Probe (4 SA Insurance Segments)
      const consentStart = performance.now();
      const matrix = buildAnomalyDensityMatrix(snap.consent_policies);
      const consentLatencyMs = roundLatencyMs(performance.now() - consentStart);
      const consentTracker = this.recordSample(
        'consent_anomaly_engine',
        matrix.segments.length > 0 ? 'connected' : 'degraded',
        consentLatencyMs,
        nowIso,
      );

      // 4-6. Live External Regulatory & AI Probes in parallel
      const [inforegProbe, fscaProbe, geminiProbe] = await Promise.all([
        this.probeRssEndpoint({
          key: 'inforeg',
          url: 'https://inforegulator.org.za/feed/',
          hostLabel: 'inforegulator.org.za',
          force,
        }),
        this.probeRssEndpoint({
          key: 'fsca',
          url: 'https://news.google.com/rss/search?q=FSCA+South+Africa+insurance+OR+PPR&hl=en-ZA&gl=ZA&ceid=ZA:en',
          hostLabel: 'news.google.com/rss (ZA)',
          force,
        }),
        this.probeGeminiEndpoint(force, nowIso),
      ]);

      const inforegTracker = this.recordSample(
        'inforeg_popia_live',
        inforegProbe.status,
        inforegProbe.latencyMs,
        nowIso,
      );
      const fscaTracker = this.recordSample(
        'fsca_ppr_live',
        fscaProbe.status,
        fscaProbe.latencyMs,
        nowIso,
      );
      const geminiTracker = this.recordSample(
        'gemini_grounding_api',
        geminiProbe.status,
        geminiProbe.latencyMs,
        nowIso,
      );

      const integrations: IntegrationHealthRecord[] = [
        {
          id: 'policy_claims_store',
          name: 'Core Policy, Claims & Ledger Store',
          category: 'M1 / M2 / M3 · Persistence',
          endpoint_label:
            storePing.mode === 'postgres'
              ? 'PostgreSQL (RLS Active)'
              : 'Local Persistent JSON Store',
          status: storePing.ok ? 'connected' : 'offline',
          sync_health: storePing.ok ? 'synced' : 'stale',
          latency_ms: storePing.latencyMs,
          avg_latency_ms: storeTracker.avgMs,
          uptime_pct: storeTracker.uptimePct,
          synced_records: storeRecordCount,
          last_sync_iso: storeTracker.lastSyncIso,
          detail: `${matrix.segments.length} product lines · ${snap.ledger_entries.length} ledger · ${snap.claims_preview.length} claims synced`,
          latency_history_ms: storeTracker.history,
        },
        {
          id: 'evidence_vault_crypto',
          name: 'SHA-256 Evidence Custody Chain',
          category: 'C1 · Forensic Integrity',
          endpoint_label: 'node:crypto SHA-256 Verifier',
          status: vaultStatus,
          sync_health: vaultCheck.valid ? 'synced' : 'stale',
          latency_ms: vaultLatencyMs,
          avg_latency_ms: vaultTracker.avgMs,
          uptime_pct: vaultTracker.uptimePct,
          synced_records: vaultCheck.checked_count,
          last_sync_iso: vaultTracker.lastSyncIso,
          detail: vaultCheck.valid
            ? `${vaultCheck.checked_count}/${snap.evidence_items.length} hash-chained custody blocks verified`
            : `Chain break at ${vaultCheck.failed_evidence_id ?? 'unknown'} — fail-closed active`,
          latency_history_ms: vaultTracker.history,
        },
        {
          id: 'consent_anomaly_engine',
          name: 'PEPUDA Consent & Product Matrix',
          category: 'M2 · 4 Product Segments',
          endpoint_label: 'In-Process Rules & Threshold Engine',
          status: 'connected',
          sync_health: 'synced',
          latency_ms: consentLatencyMs,
          avg_latency_ms: consentTracker.avgMs,
          uptime_pct: consentTracker.uptimePct,
          synced_records: snap.consent_policies.length,
          last_sync_iso: consentTracker.lastSyncIso,
          detail: `${matrix.totalFlaggedSignals} active risk signals · ${snap.anomaly_alerts.filter((a) => !a.acknowledged).length} open threshold alerts`,
          latency_history_ms: consentTracker.history,
        },
        {
          id: 'inforeg_popia_live',
          name: 'Information Regulator SA (POPIA)',
          category: 'POPIA · Live Regulatory RSS',
          endpoint_label: 'inforegulator.org.za/feed/',
          status: inforegProbe.status,
          sync_health: inforegProbe.syncHealth,
          latency_ms: inforegProbe.latencyMs,
          avg_latency_ms: inforegTracker.avgMs,
          uptime_pct: inforegTracker.uptimePct,
          synced_records: inforegProbe.itemCount,
          last_sync_iso: inforegTracker.lastSyncIso,
          detail: inforegProbe.detail,
          latency_history_ms: inforegTracker.history,
        },
        {
          id: 'fsca_ppr_live',
          name: 'FSCA & PPR Conduct News Feed',
          category: 'FSCA · Live ZA RSS Feed',
          endpoint_label: 'news.google.com/rss (en-ZA)',
          status: fscaProbe.status,
          sync_health: fscaProbe.syncHealth,
          latency_ms: fscaProbe.latencyMs,
          avg_latency_ms: fscaTracker.avgMs,
          uptime_pct: fscaTracker.uptimePct,
          synced_records: fscaProbe.itemCount,
          last_sync_iso: fscaTracker.lastSyncIso,
          detail: fscaProbe.detail,
          latency_history_ms: fscaTracker.history,
        },
        {
          id: 'gemini_grounding_api',
          name: 'Gemini Search Grounding & Counsel AI',
          category: 'AI · @google/genai Gateway',
          endpoint_label: 'generativelanguage.googleapis.com',
          status: geminiProbe.status,
          sync_health: geminiProbe.syncHealth,
          latency_ms: geminiProbe.latencyMs,
          avg_latency_ms: geminiTracker.avgMs,
          uptime_pct: geminiTracker.uptimePct,
          synced_records:
            geminiProbe.status === 'connected' ? 1 : 0,
          last_sync_iso: geminiTracker.lastSyncIso,
          detail: geminiProbe.detail,
          latency_history_ms: geminiTracker.history,
        },
      ];

      const summary = summarizeInfrastructureHealth(integrations, nowIso);
      this.lastSnapshot = summary;
      return summary;
    };

    this.probingPromise = execute().finally(() => {
      this.probingPromise = null;
    });
    return this.probingPromise;
  }

  public getLastSnapshot(): InfrastructureHealthSnapshot | null {
    return this.lastSnapshot;
  }
}
