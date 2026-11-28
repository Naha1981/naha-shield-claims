import type { SimulatedAdapterMeta } from '../adapters';
import {
  buildDeterministicClaimAnalysis,
  CLAIM_AGENT_REGISTRY,
} from './claimsAgents';
import type {
  AgentAnalyticsReport,
  AgentBySpecialistMetric,
  AgentTimeSeriesPoint,
  ClaimAgentId,
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  EvidenceItemRecord,
} from './types';

const SHORT_SPECIALIST_NAMES: Record<ClaimAgentId, string> = {
  investigator_lead: 'Investigator Lead',
  claims_sla_coordinator: 'SLA Coordinator',
  document_evidence_analyst: 'Doc Evidence',
  entity_geospatial_analyst: 'Entity & Geo',
  network_payout_analyst: 'Network & Payout',
  tool_integration_auditor: 'Tool Auditor',
};

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function computePercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(sortedAsc.length * p) - 1),
  );
  return Math.round(sortedAsc[idx]);
}

function resolveRunDurationMs(run: ClaimAgentRunRecord): number {
  if (
    typeof run.duration_ms === 'number' &&
    Number.isFinite(run.duration_ms) &&
    run.duration_ms > 0
  ) {
    return Math.round(run.duration_ms);
  }
  // Deterministic fallback for legacy records created before duration_ms tracking
  const baseMs = 180 + (run.brief.findings.length * 65);
  return run.provider_label.toLowerCase().includes('deterministic')
    ? baseMs
    : baseMs + 640;
}

export function buildAgentAnalyticsReport(params: {
  runs: ClaimAgentRunRecord[];
  proposals: ClaimAgentProposalRecord[];
  totalClaimsUniverse: number;
  agentFilter?: 'all' | ClaimAgentId;
}): AgentAnalyticsReport {
  const filterId = params.agentFilter ?? 'all';

  const scopedRuns =
    filterId === 'all'
      ? params.runs
      : params.runs.filter((r) => r.agent_id === filterId);

  const scopedProposals =
    filterId === 'all'
      ? params.proposals
      : params.proposals.filter((p) => p.agent_id === filterId);

  const uniqueClaims = new Set(scopedRuns.map((r) => r.claim_id));
  const totalUniverse = Math.max(1, params.totalClaimsUniverse);
  const coveragePct = roundOneDecimal(
    Math.min(100, (uniqueClaims.size / totalUniverse) * 100),
  );

  const durations = scopedRuns.map(resolveRunDurationMs).sort((a, b) => a - b);
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : 0;
  const medianDuration = computePercentile(durations, 0.5);
  const p95Duration = computePercentile(durations, 0.95);

  const approvedCount = scopedProposals.filter(
    (p) => p.status === 'approved',
  ).length;
  const rejectedCount = scopedProposals.filter(
    (p) => p.status === 'rejected',
  ).length;
  const pendingCount = scopedProposals.filter(
    (p) => p.status === 'pending',
  ).length;
  const reviewedCount = approvedCount + rejectedCount;

  const manualOverrideRatePct =
    reviewedCount > 0 ? roundOneDecimal((rejectedCount / reviewedCount) * 100) : 0;
  const humanAcceptanceRatePct =
    reviewedCount > 0 ? roundOneDecimal((approvedCount / reviewedCount) * 100) : 0;

  const reviewLatenciesMinutes: number[] = [];
  for (const prop of scopedProposals) {
    if (!prop.reviewed_at) continue;
    const createdMs = new Date(prop.created_at).getTime();
    const reviewedMs = new Date(prop.reviewed_at).getTime();
    if (
      Number.isFinite(createdMs) &&
      Number.isFinite(reviewedMs) &&
      reviewedMs >= createdMs
    ) {
      reviewLatenciesMinutes.push((reviewedMs - createdMs) / 60000);
    }
  }
  const avgReviewLatencyMinutes =
    reviewLatenciesMinutes.length > 0
      ? roundOneDecimal(
          reviewLatenciesMinutes.reduce((s, m) => s + m, 0) /
            reviewLatenciesMinutes.length,
        )
      : null;

  const chronologicalRuns = [...scopedRuns].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const timeline: AgentTimeSeriesPoint[] = chronologicalRuns.map((run) => {
    const runProps = scopedProposals.filter((p) => p.run_id === run.run_id);
    const approvals = runProps.filter((p) => p.status === 'approved').length;
    const overrides = runProps.filter((p) => p.status === 'rejected').length;
    const pending = runProps.filter((p) => p.status === 'pending').length;
    return {
      run_id: run.run_id,
      label: run.claim_id,
      claim_id: run.claim_id,
      agent_id: run.agent_id,
      agent_name: SHORT_SPECIALIST_NAMES[run.agent_id] ?? run.agent_name,
      provider_label: run.provider_label,
      time_to_insight_ms: resolveRunDurationMs(run),
      findings_count: run.brief.findings.length,
      approvals_count: approvals,
      overrides_count: overrides,
      pending_count: pending,
      created_at: run.created_at,
    };
  });

  const bySpecialist: AgentBySpecialistMetric[] = CLAIM_AGENT_REGISTRY.map(
    (agent) => {
      const aRuns = params.runs.filter((r) => r.agent_id === agent.id);
      const aProps = params.proposals.filter((p) => p.agent_id === agent.id);
      const aClaims = new Set(aRuns.map((r) => r.claim_id));
      const aDurations = aRuns.map(resolveRunDurationMs);
      const aAvgMs =
        aDurations.length > 0
          ? Math.round(
              aDurations.reduce((s, d) => s + d, 0) / aDurations.length,
            )
          : 0;
      const aApproved = aProps.filter((p) => p.status === 'approved').length;
      const aOverrides = aProps.filter((p) => p.status === 'rejected').length;
      const aPending = aProps.filter((p) => p.status === 'pending').length;
      const aReviewed = aApproved + aOverrides;

      return {
        agent_id: agent.id,
        short_name: SHORT_SPECIALIST_NAMES[agent.id] ?? agent.name,
        agent_name: agent.name,
        claims_processed: aClaims.size,
        runs_count: aRuns.length,
        avg_time_to_insight_ms: aAvgMs,
        approved_count: aApproved,
        override_count: aOverrides,
        pending_count: aPending,
        override_rate_pct:
          aReviewed > 0 ? roundOneDecimal((aOverrides / aReviewed) * 100) : 0,
      };
    },
  );

  return {
    summary: {
      total_runs: scopedRuns.length,
      unique_claims_processed: uniqueClaims.size,
      total_claims_universe: params.totalClaimsUniverse,
      coverage_pct: coveragePct,
      avg_time_to_insight_ms: avgDuration,
      median_time_to_insight_ms: medianDuration,
      p95_time_to_insight_ms: p95Duration,
      total_proposals: scopedProposals.length,
      reviewed_proposals: reviewedCount,
      approved_proposals: approvedCount,
      rejected_proposals: rejectedCount,
      pending_proposals: pendingCount,
      manual_override_rate_pct: manualOverrideRatePct,
      human_acceptance_rate_pct: humanAcceptanceRatePct,
      avg_human_review_latency_minutes: avgReviewLatencyMinutes,
    },
    by_specialist: bySpecialist,
    timeline,
  };
}

/**
 * Seeds realistic baseline telemetry on SYN-CLM-002, SYN-CLM-003, SYN-CLM-004,
 * and SYN-CLM-007 while leaving SYN-CLM-001 and SYN-CLM-009 unanalyzed by default.
 */
export function buildSeedAgentTelemetry(params: {
  claims: ClaimPreviewRecord[];
  evidenceItems: EvidenceItemRecord[];
  adapters: SimulatedAdapterMeta[];
}): {
  runs: ClaimAgentRunRecord[];
  proposals: ClaimAgentProposalRecord[];
} {
  const seedSpecs: Array<{
    claimId: string;
    agentId: ClaimAgentId;
    runId: string;
    createdAt: string;
    durationMs: number;
    providerLabel: string;
    modelLabel: string;
    proposalDecisions: Array<{
      status: 'approved' | 'rejected' | 'pending';
      reviewedAt: string | null;
      note: string | null;
      committedRef: string | null;
    }>;
  }> = [
    {
      claimId: 'SYN-CLM-002',
      agentId: 'entity_geospatial_analyst',
      runId: 'AGRUN-SEED-002',
      createdAt: '2026-11-26T18:10:00.000Z',
      durationMs: 420,
      providerLabel: 'Deterministic ClaimTrace Engine',
      modelLabel: 'claims-rules-v1',
      proposalDecisions: [
        {
          status: 'approved',
          reviewedAt: '2026-11-26T18:22:00.000Z',
          note: 'Approved cluster linkage summary into Evidence Vault for Eastern Star file.',
          committedRef: 'EVD-SEED-CLM002',
        },
      ],
    },
    {
      claimId: 'SYN-CLM-003',
      agentId: 'network_payout_analyst',
      runId: 'AGRUN-SEED-003',
      createdAt: '2026-11-26T19:05:00.000Z',
      durationMs: 890,
      providerLabel: 'OpenRouter free + Deterministic Engine',
      modelLabel: 'google/gemma-4-31b-it:free',
      proposalDecisions: [
        {
          status: 'approved',
          reviewedAt: '2026-11-26T19:14:00.000Z',
          note: 'Confirmed pre-EFT AVS-R mismatch note stored for compliance audit.',
          committedRef: 'EVD-SEED-CLM003',
        },
        {
          status: 'rejected',
          reviewedAt: '2026-11-26T19:19:00.000Z',
          note: 'Manual override: claimant supplied stamped bank confirmation letter resolving AVS-R check.',
          committedRef: null,
        },
      ],
    },
    {
      claimId: 'SYN-CLM-004',
      agentId: 'investigator_lead',
      runId: 'AGRUN-SEED-004',
      createdAt: '2026-11-26T20:15:00.000Z',
      durationMs: 1180,
      providerLabel: 'Gemini free + Deterministic Engine',
      modelLabel: 'gemini-4-hydrogen',
      proposalDecisions: [
        {
          status: 'approved',
          reviewedAt: '2026-11-26T20:28:00.000Z',
          note: 'AgentShield broker churn telemetry archived under POPIA s71.',
          committedRef: 'EVD-SEED-CLM004',
        },
      ],
    },
    {
      claimId: 'SYN-CLM-007',
      agentId: 'document_evidence_analyst',
      runId: 'AGRUN-SEED-007',
      createdAt: '2026-11-26T21:00:00.000Z',
      durationMs: 310,
      providerLabel: 'Deterministic ClaimTrace Engine',
      modelLabel: 'claims-rules-v1',
      proposalDecisions: [
        {
          status: 'rejected',
          reviewedAt: '2026-11-26T21:11:00.000Z',
          note: 'Manual override: BI-1663 Box 2.4 informant confirmed as registered tribal authority representative.',
          committedRef: null,
        },
      ],
    },
    {
      claimId: 'SYN-CLM-002',
      agentId: 'claims_sla_coordinator',
      runId: 'AGRUN-SEED-002B',
      createdAt: '2026-11-26T21:40:00.000Z',
      durationMs: 240,
      providerLabel: 'Deterministic ClaimTrace Engine',
      modelLabel: 'claims-rules-v1',
      proposalDecisions: [
        {
          status: 'pending',
          reviewedAt: null,
          note: null,
          committedRef: null,
        },
      ],
    },
  ];

  const runs: ClaimAgentRunRecord[] = [];
  const proposals: ClaimAgentProposalRecord[] = [];

  for (const spec of seedSpecs) {
    const claim = params.claims.find((c) => c.claim_id === spec.claimId);
    if (!claim) continue;
    const relatedEvidence = params.evidenceItems.filter(
      (ev) => ev.case_ref === claim.claim_id || ev.case_ref === claim.policy_ref,
    );
    const analysis = buildDeterministicClaimAnalysis({
      claim,
      agentId: spec.agentId,
      relatedEvidence,
      relatedPolicies: [],
      relatedRecoveryCases: [],
      adapters: params.adapters,
    });

    runs.push({
      run_id: spec.runId,
      org_id: 'ORG-DEMO-ZA',
      claim_id: claim.claim_id,
      agent_id: spec.agentId,
      agent_name: analysis.agent.name,
      requested_by_role: 'head_of_forensics',
      requested_by_id: 'usr_forensics_01',
      prompt_text: '',
      provider_label: spec.providerLabel,
      model_label: spec.modelLabel,
      synthetic_only: true,
      duration_ms: spec.durationMs,
      brief: analysis.brief,
      created_at: spec.createdAt,
    });

    analysis.proposals.forEach((draft, idx) => {
      const dec = spec.proposalDecisions[idx] ?? {
        status: 'pending' as const,
        reviewedAt: null,
        note: null,
        committedRef: null,
      };
      proposals.push({
        proposal_id: `AGPROP-SEED-${spec.runId.split('-').pop()}-${idx + 1}`,
        run_id: spec.runId,
        org_id: 'ORG-DEMO-ZA',
        claim_id: claim.claim_id,
        agent_id: spec.agentId,
        proposal_type: draft.proposal_type,
        title: draft.title,
        rationale: draft.rationale,
        proposed_payload: draft.proposed_payload,
        lint_ok: draft.lint_ok,
        lint_violations: draft.lint_violations,
        status: dec.status,
        reviewed_by_role: dec.status === 'pending' ? null : 'head_of_forensics',
        reviewed_by_id: dec.status === 'pending' ? null : 'usr_forensics_01',
        reviewed_by_name:
          dec.status === 'pending' ? null : 'Head of Forensics',
        reviewer_note: dec.note,
        reviewed_at: dec.reviewedAt,
        committed_ref: dec.committedRef,
        created_at: spec.createdAt,
      });
    });
  }

  return {
    runs: runs.reverse(),
    proposals: proposals.reverse(),
  };
}

export function escapeCsvCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Prevent CSV formula injection in spreadsheet tools for non-numeric strings
  if (
    typeof value === 'string' &&
    text.length > 0 &&
    /^[=+\-@\t\r]/.test(text)
  ) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildAgentAnalyticsCsvFilename(
  agentFilter: 'all' | ClaimAgentId,
  exportedAtIso: string = new Date().toISOString(),
): string {
  const datePart = exportedAtIso.slice(0, 10).replace(/[^0-9-]/g, '') || 'report';
  const safeScope = String(agentFilter).replace(/[^a-z0-9_-]/gi, '_');
  return `claimtrace-agent-analytics-${safeScope}-${datePart}.csv`;
}

export function buildAgentAnalyticsCsv(params: {
  report: AgentAnalyticsReport;
  agentFilter: 'all' | ClaimAgentId;
  exportedAtIso?: string;
}): string {
  const exportedAt = params.exportedAtIso ?? new Date().toISOString();
  const scope = params.agentFilter;
  const { summary, by_specialist: bySpecialist, timeline } = params.report;

  const headers = [
    'record_type',
    'specialist_filter',
    'exported_at',
    'metric_or_id',
    'label_or_claim',
    'agent_id',
    'value_or_duration_ms',
    'findings_or_runs',
    'approved_count',
    'override_count',
    'pending_count',
    'override_rate_pct',
    'detail_or_provider',
    'timestamp',
  ];

  const rows: Array<Array<string | number | null>> = [
    [
      'summary_kpi',
      scope,
      exportedAt,
      'total_claims_processed',
      'Total Claims Processed',
      scope,
      summary.unique_claims_processed,
      summary.total_runs,
      summary.approved_proposals,
      summary.rejected_proposals,
      summary.pending_proposals,
      summary.manual_override_rate_pct,
      `${summary.unique_claims_processed}/${summary.total_claims_universe} (${summary.coverage_pct}% portfolio coverage · sample only)`,
      exportedAt,
    ],
    [
      'summary_kpi',
      scope,
      exportedAt,
      'mean_time_to_insight_ms',
      'Mean Time-to-Insight (ms)',
      scope,
      summary.avg_time_to_insight_ms,
      summary.total_runs,
      summary.approved_proposals,
      summary.rejected_proposals,
      summary.pending_proposals,
      summary.manual_override_rate_pct,
      `Median ${summary.median_time_to_insight_ms} ms · P95 ${summary.p95_time_to_insight_ms} ms`,
      exportedAt,
    ],
    [
      'summary_kpi',
      scope,
      exportedAt,
      'manual_override_frequency_pct',
      'Manual Override Frequency (%)',
      scope,
      summary.manual_override_rate_pct,
      summary.reviewed_proposals,
      summary.approved_proposals,
      summary.rejected_proposals,
      summary.pending_proposals,
      summary.manual_override_rate_pct,
      `${summary.rejected_proposals} overridden / ${summary.reviewed_proposals} human-reviewed`,
      exportedAt,
    ],
    [
      'summary_kpi',
      scope,
      exportedAt,
      'human_approval_alignment_pct',
      'Human Approval Alignment (%)',
      scope,
      summary.human_acceptance_rate_pct,
      summary.total_proposals,
      summary.approved_proposals,
      summary.rejected_proposals,
      summary.pending_proposals,
      summary.manual_override_rate_pct,
      summary.avg_human_review_latency_minutes !== null
        ? `Avg human review latency ${summary.avg_human_review_latency_minutes} min`
        : 'POPIA s71 human review gate active',
      exportedAt,
    ],
  ];

  const scopedSpecialists =
    scope === 'all'
      ? bySpecialist
      : bySpecialist.filter((row) => row.agent_id === scope);

  for (const spec of scopedSpecialists) {
    rows.push([
      'specialist_metric',
      scope,
      exportedAt,
      spec.agent_id,
      spec.agent_name,
      spec.agent_id,
      spec.avg_time_to_insight_ms,
      spec.runs_count,
      spec.approved_count,
      spec.override_count,
      spec.pending_count,
      spec.override_rate_pct,
      `${spec.claims_processed} unique claims processed`,
      exportedAt,
    ]);
  }

  for (const pt of timeline) {
    const ptReviewed = pt.approvals_count + pt.overrides_count;
    const ptOverridePct =
      ptReviewed > 0 ? roundOneDecimal((pt.overrides_count / ptReviewed) * 100) : 0;
    rows.push([
      'run_timeline',
      scope,
      exportedAt,
      pt.run_id,
      pt.claim_id,
      pt.agent_id,
      pt.time_to_insight_ms,
      pt.findings_count,
      pt.approvals_count,
      pt.overrides_count,
      pt.pending_count,
      ptOverridePct,
      `${pt.agent_name} · ${pt.provider_label}`,
      pt.created_at,
    ]);
  }

  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\r\n');
}

