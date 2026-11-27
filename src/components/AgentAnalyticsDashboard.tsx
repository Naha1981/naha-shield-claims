import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Clock, Download, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import {
  buildAgentAnalyticsCsv,
  buildAgentAnalyticsCsvFilename,
  buildAgentAnalyticsReport,
} from '../lib/engine/agentAnalytics';
import { CLAIM_AGENT_REGISTRY } from '../lib/engine/claimsAgents';
import type {
  ClaimAgentId,
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  RoleId,
} from '../lib/engine/types';
import { apiFetch } from '../utils/format';

interface AgentAnalyticsDashboardProps {
  runs: ClaimAgentRunRecord[];
  proposals: ClaimAgentProposalRecord[];
  claims: ClaimPreviewRecord[];
  activeRole: RoleId;
  onRefresh: () => Promise<void>;
}

function formatDurationMs(ms: number): string {
  if (ms <= 0) return '0 ms';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const AgentAnalyticsDashboard: React.FC<
  AgentAnalyticsDashboardProps
> = ({ runs, proposals, claims, activeRole, onRefresh }) => {
  const [agentFilter, setAgentFilter] = React.useState<'all' | ClaimAgentId>(
    'all',
  );
  const [runningSample, setRunningSample] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [runFeedback, setRunFeedback] = React.useState<string | null>(null);

  const report = React.useMemo(
    () =>
      buildAgentAnalyticsReport({
        runs,
        proposals,
        totalClaimsUniverse: claims.length || 10,
        agentFilter,
      }),
    [runs, proposals, claims.length, agentFilter],
  );

  const processedClaimIds = React.useMemo(
    () => new Set(runs.map((r) => r.claim_id)),
    [runs],
  );

  // Pick a clean claim for live benchmark runs (prefer unprocessed non-SYN-CLM-001/009 claims first if available)
  const nextTargetClaim = React.useMemo(() => {
    const preferredOrder = claims.filter(
      (c) =>
        !processedClaimIds.has(c.claim_id) &&
        c.claim_id !== 'SYN-CLM-001' &&
        c.claim_id !== 'SYN-CLM-009',
    );
    if (preferredOrder.length > 0) return preferredOrder[0];
    const anyUnprocessed = claims.find((c) => !processedClaimIds.has(c.claim_id));
    return anyUnprocessed ?? claims[0];
  }, [claims, processedClaimIds]);

  async function handleRunBenchmark() {
    if (!nextTargetClaim) return;
    setRunningSample(true);
    setRunError(null);
    setRunFeedback(null);
    const chosenAgent: ClaimAgentId =
      agentFilter === 'all' ? 'claims_sla_coordinator' : agentFilter;
    try {
      const res = await apiFetch<{
        ok: boolean;
        run: ClaimAgentRunRecord;
      }>(
        `/api/claims/${encodeURIComponent(nextTargetClaim.claim_id)}/agent-analyze`,
        activeRole,
        {
          method: 'POST',
          body: JSON.stringify({
            agent_id: chosenAgent,
            prompt:
              'Efficiency telemetry benchmark run (POPIA s71 advisory only).',
          }),
        },
      );
      await onRefresh();
      setRunFeedback(
        `Processed ${nextTargetClaim.claim_id} via ${res.run.agent_name} in ${formatDurationMs(res.run.duration_ms ?? 0)}.`,
      );
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : 'Unable to execute benchmark run',
      );
    } finally {
      setRunningSample(false);
    }
  }

  function handleExportCsv() {
    setRunError(null);
    const exportedAtIso = new Date().toISOString();
    const filename = buildAgentAnalyticsCsvFilename(agentFilter, exportedAtIso);
    const csv = buildAgentAnalyticsCsv({
      report,
      agentFilter,
      exportedAtIso,
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const specCount =
      agentFilter === 'all' ? report.by_specialist.length : 1;
    setRunFeedback(
      `Exported ${filename} (${report.timeline.length} timeline runs, ${specCount} specialist rows) for offline compliance review.`,
    );

    void apiFetch('/api/compliance/agent-analytics-export', activeRole, {
      method: 'POST',
      body: JSON.stringify({
        filename,
        specialist_filter: agentFilter,
        claims_processed: report.summary.unique_claims_processed,
        total_runs: report.summary.total_runs,
      }),
    })
      .then(() => onRefresh())
      .catch(() => {
        // Offline / non-blocking: CSV file already downloaded cleanly
      });
  }

  const { summary, by_specialist: bySpecialist, timeline } = report;

  return (
    <section
      aria-label="Agent Analytics"
      data-testid="agent-analytics-dashboard"
      className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden"
    >
      {/* Header & Controls */}
      <div className="p-5 border-b border-slate-800 bg-[#0F172A]/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Agent Analytics &amp; Efficiency Reporting
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Synthetic seeded runs plus activity in this workspace. Not real insurer productivity, fraud accuracy or compliance evidence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto min-w-0">
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <label
              htmlFor="analytics-specialist-filter"
              className="text-xs text-slate-400 whitespace-nowrap shrink-0"
            >
              Specialist
            </label>
            <select
              id="analytics-specialist-filter"
              value={agentFilter}
              onChange={(e) =>
                setAgentFilter(e.target.value as 'all' | ClaimAgentId)
              }
              className="w-full sm:w-auto min-w-0 max-w-full truncate bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">
                All Specialists ({CLAIM_AGENT_REGISTRY.length})
              </option>
              {CLAIM_AGENT_REGISTRY.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            data-testid="analytics-export-csv-btn"
            aria-label="Export Agent Analytics CSV"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRunBenchmark()}
            disabled={runningSample || !nextTargetClaim}
            data-testid="analytics-run-next-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {runningSample
                ? 'Analyzing Claim...'
                : nextTargetClaim && !processedClaimIds.has(nextTargetClaim.claim_id)
                  ? `Analyze ${nextTargetClaim.claim_id}`
                  : 'Run Telemetry Sample'}
            </span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {(runError || runFeedback) && (
        <div className="px-5 pt-4">
          {runError && (
            <div
              role="alert"
              className="p-2.5 rounded bg-red-950/50 border border-red-600/60 text-xs text-red-200"
            >
              {runError}
            </div>
          )}
          {runFeedback && (
            <div
              role="status"
              className="p-2.5 rounded bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200"
            >
              {runFeedback}
            </div>
          )}
        </div>
      )}

      {/* 4 KPI Summary Strip */}
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] text-slate-400">
            Total Claims Processed
          </div>
          <div
            data-testid="analytics-kpi-claims-processed"
            className="font-mono text-xl font-semibold text-white tabular-nums"
          >
            {summary.unique_claims_processed} / {summary.total_claims_universe}
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {summary.coverage_pct}% portfolio coverage · {summary.total_runs} runs
          </div>
        </div>

        <div className="p-3.5 rounded bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Mean Time-to-Insight</span>
          </div>
          <div
            data-testid="analytics-kpi-time-to-insight"
            className="font-mono text-xl font-semibold text-emerald-300 tabular-nums"
          >
            {formatDurationMs(summary.avg_time_to_insight_ms)}
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            Median {formatDurationMs(summary.median_time_to_insight_ms)} · P95{' '}
            {formatDurationMs(summary.p95_time_to_insight_ms)}
          </div>
        </div>

        <div className="p-3.5 rounded bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Manual Override Frequency</span>
          </div>
          <div
            data-testid="analytics-kpi-override-rate"
            className="font-mono text-xl font-semibold text-amber-300 tabular-nums"
          >
            {summary.manual_override_rate_pct}%
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {summary.rejected_proposals} overridden / {summary.reviewed_proposals} human-reviewed
          </div>
        </div>

        <div className="p-3.5 rounded bg-slate-900/80 border border-slate-800 space-y-1">
          <div className="text-[11px] text-slate-400">
            Human Approval Alignment
          </div>
          <div
            data-testid="analytics-kpi-acceptance-rate"
            className="font-mono text-xl font-semibold text-white tabular-nums"
          >
            {summary.human_acceptance_rate_pct}%
          </div>
          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            {summary.approved_proposals} approved · {summary.pending_proposals} pending gate
          </div>
        </div>
      </div>

      {/* Recharts Visualizations or Filtered Empty State */}
      {timeline.length === 0 ? (
        <div
          data-testid="analytics-empty-state"
          className="mx-5 mb-5 p-6 rounded bg-slate-900/70 border border-slate-800 text-center space-y-3"
        >
          <div className="text-sm font-semibold text-white">
            No Runs Recorded for This Specialist Filter
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            No agent execution telemetry matches the selected specialist yet. Reset the filter to view all agents or run a benchmark pass now.
          </p>
          <div className="flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setAgentFilter('all')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Show All Specialists</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunBenchmark()}
              disabled={runningSample || !nextTargetClaim}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run Specialist Benchmark</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5 space-y-5">
          {/* Two Side-by-Side Recharts Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Chart 1: Time-to-Insight & Findings Volume */}
            <div className="p-4 rounded bg-slate-900/70 border border-slate-800 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-white">
                    Time-to-Insight Latency &amp; Findings per Run
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Measured server turnaround (ms) vs evidence-tagged findings surfaced
                  </p>
                </div>
                <span className="font-mono text-[11px] text-emerald-300 tabular-nums whitespace-nowrap">
                  {timeline.length} runs
                </span>
              </div>

              <div
                className="h-[240px] w-full min-w-0"
                data-testid="analytics-time-chart"
              >
                <ResponsiveContainer width="100%" height={240} minWidth={200}>
                  <AreaChart
                    data={timeline}
                    margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="insightFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="ms"
                      stroke="#10b981"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      unit=" ms"
                      width={68}
                    />
                    <YAxis
                      yAxisId="cnt"
                      orientation="right"
                      stroke="#f59e0b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      allowDecimals={false}
                      width={34}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }}
                    />
                    <Area
                      yAxisId="ms"
                      type="monotone"
                      dataKey="time_to_insight_ms"
                      name="Time-to-Insight (ms)"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#insightFill)"
                    />
                    <Area
                      yAxisId="cnt"
                      type="monotone"
                      dataKey="findings_count"
                      name="Findings"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fillOpacity={0.12}
                      fill="#f59e0b"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Human Gate & Manual Override Breakdown by Specialist */}
            <div className="p-4 rounded bg-slate-900/70 border border-slate-800 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-white">
                    Human Approvals vs Manual Overrides by Specialist
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Proposal disposition across all 6 integrated claims agents
                  </p>
                </div>
                <span className="font-mono text-[11px] text-amber-300 tabular-nums whitespace-nowrap">
                  {summary.avg_human_review_latency_minutes !== null
                    ? `Avg review: ${summary.avg_human_review_latency_minutes} min`
                    : 'POPIA s71'}
                </span>
              </div>

              <div
                className="h-[240px] w-full min-w-0"
                data-testid="analytics-override-chart"
              >
                <ResponsiveContainer width="100%" height={240} minWidth={200}>
                  <BarChart
                    data={bySpecialist}
                    margin={{ top: 8, right: 16, left: 22, bottom: 8 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="short_name"
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      interval={0}
                      angle={-14}
                      textAnchor="end"
                      height={46}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      allowDecimals={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', color: '#cbd5e1' }}
                    />
                    <Bar
                      dataKey="approved_count"
                      name="Approved"
                      stackId="disp"
                      fill="#10b981"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="override_count"
                      name="Manual Override"
                      stackId="disp"
                      fill="#ef4444"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="pending_count"
                      name="Pending Gate"
                      stackId="disp"
                      fill="#f59e0b"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Specialist Efficiency Breakdown Table */}
          <div className="rounded border border-slate-800 overflow-x-auto bg-slate-900/50">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2.5 px-3.5 font-medium">Specialist Agent</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">
                    Claims Processed
                  </th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Runs</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">
                    Avg Time-to-Insight
                  </th>
                  <th className="py-2.5 px-3.5 font-medium text-right">
                    Approved
                  </th>
                  <th className="py-2.5 px-3.5 font-medium text-right">
                    Manual Overrides
                  </th>
                  <th className="py-2.5 px-3.5 font-medium text-right">
                    Override Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {bySpecialist.map((row) => (
                  <tr key={row.agent_id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3.5 font-medium text-slate-200">
                      {row.agent_name}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-white">
                      {row.claims_processed}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-300">
                      {row.runs_count}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-emerald-300">
                      {row.runs_count > 0
                        ? formatDurationMs(row.avg_time_to_insight_ms)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-emerald-300">
                      {row.approved_count}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-amber-300">
                      {row.override_count}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-200">
                      {row.override_rate_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
