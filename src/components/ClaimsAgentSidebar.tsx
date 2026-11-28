import {useQueueView, QueueControls} from './QueueControls';
import {AgentText} from './AgentText';
import React from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileSearch,
  History,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  buildClaimAgentActionHistory,
  canRoleApproveAgentProposal,
  CLAIM_AGENT_REGISTRY,
  DATED_VISUAL_RECORD_DISCLAIMER,
  NON_NEGOTIABLE_AGENT_RULES,
} from '../lib/engine/claimsAgents';
import { AgentActionHistoryDrawer } from './AgentActionHistoryDrawer';
import type {
  AuditLogRecord,
  ClaimAgentId,
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  ClaimTimerStatus,
  ConsentPolicyInput,
  EvidenceItemRecord,
  RecoveryCaseInput,
  RoleId,
} from '../lib/engine/types';
import type { SimulatedAdapterMeta } from '../lib/adapters';
import { apiFetch, ROLE_LABELS, shortHash } from '../utils/format';

export interface ClaimAgentContextPayload {
  claim: ClaimPreviewRecord;
  timer: ClaimTimerStatus;
  related_evidence: EvidenceItemRecord[];
  related_policies: ConsentPolicyInput[];
  related_recovery_cases: RecoveryCaseInput[];
  adapters: SimulatedAdapterMeta[];
  runs: ClaimAgentRunRecord[];
  proposals: ClaimAgentProposalRecord[];
  claim_audit_trail: AuditLogRecord[];
  synthetic_only: true;
}

interface ClaimsAgentSidebarProps {
  claim: ClaimPreviewRecord | undefined;
  activeRole: RoleId;
  onCommittedChange: () => Promise<void>;
}

type SidebarTab = 'brief' | 'approvals' | 'audit';

function formatShortIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function proposalTypeLabel(
  t: ClaimAgentProposalRecord['proposal_type'],
): string {
  switch (t) {
    case 'append_evidence_finding':
      return 'Evidence Vault Write-Back';
    case 'draft_basdeo_notice':
      return 'Basdeo Deferment Notice';
    case 'flag_human_review_hold':
      return 'Human Review Hold';
  }
}

export const ClaimsAgentSidebar: React.FC<ClaimsAgentSidebarProps> = ({
  claim,
  activeRole,
  onCommittedChange,
}) => {
  const [context, setContext] =
    React.useState<ClaimAgentContextPayload | null>(null);
  const [loadingContext, setLoadingContext] = React.useState(false);
  const [contextError, setContextError] = React.useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] =
    React.useState<ClaimAgentId>('investigator_lead');
  const [officerPrompt, setOfficerPrompt] = React.useState('');
  const [runningAnalysis, setRunningAnalysis] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = React.useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = React.useState<SidebarTab>('brief');
  const [showGuardrails, setShowGuardrails] = React.useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = React.useState(false);

  const [reviewNotes, setReviewNotes] = React.useState<Record<string, string>>(
    {},
  );
  const [reviewBusyId, setReviewBusyId] = React.useState<string | null>(null);
  const [reviewError, setReviewError] = React.useState<string | null>(null);

  const claimId = claim?.claim_id ?? '';

  const fetchAgentContext = React.useCallback(
    async (targetClaimId: string, withAudit = false) => {
      if (!targetClaimId) return;
      setLoadingContext(true);
      setContextError(null);
      try {
        const res = await apiFetch<ClaimAgentContextPayload & { ok: boolean }>(
          `/api/claims/${encodeURIComponent(targetClaimId)}/agent-context${withAudit ? '?audit=1' : ''}`,
          activeRole,
        );
        setContext(res);
      } catch (err) {
        setContextError(
          err instanceof Error
            ? err.message
            : 'Unable to load claim agent context',
        );
      } finally {
        setLoadingContext(false);
      }
    },
    [activeRole],
  );

  React.useEffect(() => {
    if (!claimId) return;
    setAnalysisError(null);
    setReviewError(null);
    setActionFeedback(null);
    void fetchAgentContext(claimId, false);
  }, [claimId, fetchAgentContext]);

  async function runAgentAnalysis() {
    if (!claimId) return;
    setRunningAnalysis(true);
    setAnalysisError(null);
    setActionFeedback(null);
    setReviewError(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        run: ClaimAgentRunRecord;
        created_proposals: ClaimAgentProposalRecord[];
        context: ClaimAgentContextPayload;
      }>(`/api/claims/${encodeURIComponent(claimId)}/agent-analyze`, activeRole, {
        method: 'POST',
        body: JSON.stringify({
          agent_id: selectedAgentId,
          prompt: officerPrompt,
        }),
      });
      setContext(res.context);
      setActiveTab('brief');
      setActionFeedback(
        `${res.run.agent_name} completed analysis on ${claimId} (${res.created_proposals.length} human-gated proposal${res.created_proposals.length === 1 ? '' : 's'} queued).`,
      );
      await onCommittedChange();
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Agent analysis failed',
      );
    } finally {
      setRunningAnalysis(false);
    }
  }

  function handleRunAnalysis(e: React.FormEvent) {
    e.preventDefault();
    void runAgentAnalysis();
  }

  async function handleReviewProposal(
    proposal: ClaimAgentProposalRecord,
    decision: 'approve' | 'reject',
  ) {
    if (!claimId) return;
    setReviewError(null);
    setActionFeedback(null);
    const note=(reviewNotes[proposal.proposal_id]??'').trim();
    if(!note){setReviewError('Record your review reason before accepting or returning a proposal.');return;}

    setReviewBusyId(proposal.proposal_id);
    try {
      const res = await apiFetch<{
        ok: boolean;
        proposal: ClaimAgentProposalRecord;
        context: ClaimAgentContextPayload;
      }>(
        `/api/claims/${encodeURIComponent(claimId)}/agent-proposals/${encodeURIComponent(proposal.proposal_id)}/review`,
        activeRole,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            reviewer_note: note,
          }),
        },
      );
      setContext(res.context);
      setActionFeedback(
        decision === 'approve'
          ? `Decision recorded for synthetic action "${proposal.title}"${res.proposal.committed_ref ? ` (Ref: ${res.proposal.committed_ref})` : ''}.`
          : `Returned for revision "${proposal.title}" — logged to claim audit trail.`,
      );
      await onCommittedChange();
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : 'Failed to review proposal',
      );
    } finally {
      setReviewBusyId(null);
    }
  }

  const latestRun = context?.runs?.[0] ?? null;
  const proposals = context?.proposals ?? [];
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const reviewedProposals = proposals.filter((p) => p.status !== 'pending');
  const auditTrail = context?.claim_audit_trail ?? [];
  const actionHistory = React.useMemo(
    () => buildClaimAgentActionHistory(context?.runs ?? [], proposals),
    [context?.runs, proposals],
  );
  const roleCanApprove = canRoleApproveAgentProposal(activeRole);
  const selectedAgent =
    CLAIM_AGENT_REGISTRY.find((a) => a.id === selectedAgentId) ??
    CLAIM_AGENT_REGISTRY[0];

  const pendingQueue=useQueueView('pending-proposals',pendingProposals);
  const reviewedQueue=useQueueView('reviewed-proposals',reviewedProposals);
  const trailQueue=useQueueView('claim-audit-trail',auditTrail);
  return (
    <aside
      aria-label="Agent Interaction Sidebar"
      data-testid="claims-agent-sidebar"
      className="w-full rounded-md bg-[#131C31] border border-slate-800 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-[#0F172A] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-400 shrink-0" />
              <h2 className="font-display text-base font-semibold text-white">
                Agent Interaction
              </h2>
            </div>
            <p className="text-[13px] text-slate-400 mt-0.5">
              {claim
                ? `${claim.claim_id} · ${claim.policy_ref} · Synthetic Data Only`
                : 'Select a claim row to inspect'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchAgentContext(claimId, true)}
            disabled={loadingContext || !claimId}
            aria-label="Sync Context, refresh ClaimTrace claim context"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 text-[13px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3 h-3 ${loadingContext ? 'animate-spin' : ''}`}
            />
            <span>Sync Context</span>
          </button>
        </div>

        {/* Scoped ClaimTrace Data Snapshot */}
        {context && (
          <div className="grid grid-cols-3 gap-2 pt-1 text-[13px]">
            <div className="rounded bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
              <div className="text-slate-400">Vault Items</div>
              <div className="font-mono font-semibold text-white tabular-nums">
                {context.related_evidence.length}
              </div>
            </div>
            <div className="rounded bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
              <div className="text-slate-400">AVS-R Gate</div>
              <div
                className={`font-mono font-semibold ${
                  context.claim.avs_r_status === 'MATCHED'
                    ? 'text-emerald-300'
                    : context.claim.avs_r_status === 'MISMATCH'
                      ? 'text-red-300'
                      : 'text-amber-300'
                }`}
              >
                {context.claim.avs_r_status}
              </div>
            </div>
            <div className="rounded bg-slate-900/90 border border-slate-800 px-2.5 py-1.5">
              <div className="text-slate-400">Adapters</div>
              <div className="font-mono font-semibold text-amber-300">
                Simulated
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setHistoryDrawerOpen(true)}
          disabled={!claimId}
          data-testid="open-action-history-drawer-btn"
          title="Open Agent Action History drawer"
          className="w-full inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded border border-slate-700 bg-slate-900/90 hover:bg-slate-800 disabled:opacity-50 text-xs font-medium text-slate-200 transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <History className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Agent Action History</span>
          </span>
          <span className="font-mono text-[13px] text-slate-300 tabular-nums whitespace-nowrap">
            {actionHistory.length}{' '}
            {actionHistory.length === 1 ? 'action' : 'actions'}
          </span>
        </button>
      </div>

      {/* Execution Form */}
      <form
        onSubmit={handleRunAnalysis}
        className="p-4 border-b border-slate-800 space-y-3"
      >
        <div>
          <label
            htmlFor="claims-agent-selector"
            className="block text-xs font-medium text-slate-300 mb-1"
          >
            Specialist Agent
          </label>
          <select
            id="claims-agent-selector"
            value={selectedAgentId}
            onChange={(e) =>
              setSelectedAgentId(e.target.value as ClaimAgentId)
            }
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {CLAIM_AGENT_REGISTRY.map((ag) => (
              <option key={ag.id} value={ag.id}>
                {ag.name}
              </option>
            ))}
          </select>
          <p className="text-[13px] text-slate-400 mt-1 leading-relaxed">
            {selectedAgent.scope_summary}
          </p>
        </div>

        <div>
          <label
            htmlFor="claims-agent-prompt"
            className="block text-xs font-medium text-slate-300 mb-1"
          >
            Officer Question or Scope Focus (Optional)
          </label>
          <textarea
            id="claims-agent-prompt"
            rows={2}
            maxLength={400}
            value={officerPrompt}
            onChange={(e) => setOfficerPrompt(e.target.value)}
            placeholder="e.g. Check BI-1663 Box 2.4 gaps, innocent explanations, and Basdeo SLA readiness."
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowGuardrails((v) => !v)}
            aria-expanded={showGuardrails}
            className="text-[13px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
          >
            {showGuardrails ? 'Hide Agent Guardrails' : 'View 9 Agent Guardrails'}
          </button>
          <button
            type="submit"
            disabled={runningAnalysis || !claimId}
            data-testid="run-claim-agent-btn"
            className="px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            {runningAnalysis ? 'Running Analysis...' : 'Run Agent Analysis'}
          </button>
        </div>

        {showGuardrails && (
          <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800 space-y-1 text-[13px] text-slate-300">
            <div className="font-semibold text-white">
              Claims-Agents Non-Negotiable Rules (POPIA s71)
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
              {NON_NEGOTIABLE_AGENT_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        )}
      </form>

      {/* Alerts / Feedback */}
      {(contextError || analysisError || reviewError || actionFeedback) && (
        <div className="px-4 pt-3 space-y-2">
          {contextError && (
            <div
              role="alert"
              className="p-2.5 rounded bg-red-950/50 border border-red-600/60 text-xs text-red-200"
            >
              {contextError}
            </div>
          )}
          {analysisError && (
            <div
              role="alert"
              className="p-2.5 rounded bg-red-950/50 border border-red-600/60 text-xs text-red-200"
            >
              {analysisError}
            </div>
          )}
          {reviewError && (
            <div
              role="alert"
              className="p-2.5 rounded bg-red-950/50 border border-red-600/60 text-xs text-red-200"
            >
              {reviewError}
            </div>
          )}
          {actionFeedback && (
            <div
              role="status"
              className="p-2.5 rounded bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200"
            >
              {actionFeedback}
            </div>
          )}
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="px-4 pt-3">
        <div
          role="tablist"
          aria-label="Agent interaction views"
          className="grid grid-cols-3 gap-1 p-1 rounded-md bg-slate-900 border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'brief'}
            onClick={() => setActiveTab('brief')}
            className={`px-2 py-1.5 text-[13px] font-medium rounded transition-colors whitespace-nowrap ${
              activeTab === 'brief'
                ? 'bg-[#131C31] text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Case Brief
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'approvals'}
            onClick={() => setActiveTab('approvals')}
            className={`px-2 py-1.5 text-[13px] font-medium rounded transition-colors whitespace-nowrap font-mono tabular-nums ${
              activeTab === 'approvals'
                ? 'bg-[#131C31] text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Approvals ({pendingProposals.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit'}
            onClick={() => setActiveTab('audit')}
            className={`px-2 py-1.5 text-[13px] font-medium rounded transition-colors whitespace-nowrap font-mono tabular-nums ${
              activeTab === 'audit'
                ? 'bg-[#131C31] text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Audit ({auditTrail.length})
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      <div className="p-4 space-y-4">
        {activeTab === 'brief' && (
          <div className="space-y-4">
            {!latestRun ? (
              <div className="p-4 rounded bg-slate-900/70 border border-slate-800 text-xs text-slate-300 space-y-2">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <FileSearch className="w-4 h-4 text-emerald-400" />
                  <span>Ready to Analyze {claim?.claim_id ?? 'Claim'}</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Click <strong className="text-slate-200">Run Agent Analysis</strong> to inspect ClaimTrace SLA clocks, hash-chained Evidence Vault items, living-person/cluster signals, AVS-R status, and generate human-gated proposals.
                </p>
                {context && (
                  <div className="pt-1 text-[13px] text-slate-400 font-mono">
                    Current SLA: {context.timer.clock_label}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3" data-testid="agent-case-brief">
                {/* Advisory Boundary & Run Metadata */}
                <div className="p-2.5 rounded bg-amber-950/30 border border-amber-600/40 text-[13px] text-amber-200">
                  {latestRun.brief.advisory_disclaimer}
                </div>

                <div className="text-[13px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
                  <span className="text-emerald-300 font-semibold">
                    {latestRun.agent_name}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{latestRun.provider_label}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatShortIso(latestRun.created_at)}</span>
                </div>

                {latestRun.brief.prompt_injection_warnings.length > 0 && (
                  <div
                    role="alert"
                    className="p-2.5 rounded bg-red-950/40 border border-red-600/50 text-[13px] text-red-200 flex items-start gap-2"
                  >
                    <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Prompt-Injection Pattern Quarantined
                      </div>
                      <div className="text-red-300/90 mt-0.5">
                        {latestRun.brief.prompt_injection_warnings.join('; ')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Narrative Summary */}
                <div className="p-3 rounded bg-slate-900/90 border border-slate-800 space-y-1">
                  <div className="text-[13px] font-semibold text-slate-300">
                    1. Case Reference & Synthesis
                  </div>
                  <div className="text-[13px] font-mono text-slate-400">
                    {latestRun.brief.case_reference}
                  </div>
                  <div className="text-xs text-slate-200 leading-relaxed pt-1">
                    <AgentText text={latestRun.brief.narrative_summary}/>
                  </div>
                </div>

                {/* 2. Purpose & Checks Run */}
                <div className="space-y-1">
                  <h3 className="text-[13px] font-semibold text-slate-300">
                    2. Checks Run
                  </h3>
                  <ul className="space-y-1 text-[13px] text-slate-400 list-disc pl-4">
                    {latestRun.brief.purpose_and_checks_run.map((chk) => (
                      <li key={chk}>{chk}</li>
                    ))}
                  </ul>
                </div>

                {/* 3. Evidence-Tagged Findings */}
                <div className="space-y-2">
                  <h3 className="text-[13px] font-semibold text-slate-300">
                    3. Tagged Findings ({latestRun.brief.findings.length})
                  </h3>
                  <div className="space-y-2">
                    {latestRun.brief.findings.map((f) => (
                      <div
                        key={f.finding_id}
                        className="p-2.5 rounded bg-slate-900/80 border border-slate-800 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-[13px] font-mono">
                          <span className="text-emerald-300 font-semibold">
                            {f.reason_code}
                          </span>
                          <span className="text-slate-300">
                            {f.evidence_tag} · {f.coverage_status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-200 leading-relaxed">
                          <AgentText text={f.summary}/>
                        </div>
                        <div className="text-[13px] font-mono text-slate-500">
                          Source: {f.source_ref} · {f.evidence_type}
                        </div>
                        {f.visual_record_disclaimer && (
                          <div className="p-1.5 rounded bg-amber-950/40 border border-amber-500/40 text-[13px] text-amber-200 font-medium">
                            {DATED_VISUAL_RECORD_DISCLAIMER}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4 & 5. Missing Info + Innocent Explanations */}
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-300">
                      4. Conflicting or Missing Information
                    </h3>
                    <ul className="mt-1 space-y-1 text-[13px] text-slate-400 list-disc pl-4">
                      {latestRun.brief.conflicting_or_missing_info.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-300">
                      5. Innocent Explanations & False-Positive Checks
                    </h3>
                    <ul className="mt-1 space-y-1 text-[13px] text-slate-400 list-disc pl-4">
                      {latestRun.brief.innocent_explanations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-300">
                      6. What Would Resolve It
                    </h3>
                    <ul className="mt-1 space-y-1 text-[13px] text-slate-400 list-disc pl-4">
                      {latestRun.brief.what_would_resolve.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800 space-y-1">
                    <h3 className="text-[13px] font-semibold text-emerald-300">
                      7. Advisory Next Human Step
                    </h3>
                    <div className="text-xs text-slate-200 leading-relaxed">
                      {latestRun.brief.suggested_next_human_step}
                    </div>
                  </div>
                  <div className="text-[13px] font-mono text-slate-500 break-words">
                    8. Audit Refs: {latestRun.brief.audit_references.join(' · ')}
                  </div>
                </div>

                {pendingProposals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('approvals')}
                    className="w-full py-2 px-3 rounded-md border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-950/50 text-xs font-semibold text-emerald-200 transition-colors"
                  >
                    Review {pendingProposals.length} Pending Human Approval
                    {pendingProposals.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="space-y-3" data-testid="agent-approvals-panel">
            {!roleCanApprove && (
              <div className="p-2.5 rounded bg-amber-950/40 border border-amber-500/40 text-[13px] text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Active role is <strong>{ROLE_LABELS[activeRole]}</strong>. Separation of Duties blocks Finance / CFO from approving claim investigation write-backs.
                </span>
              </div>
            )}

            {proposals.length === 0 ? (
              <div className="p-4 rounded bg-slate-900/70 border border-slate-800 text-xs text-slate-400">
                No agent action proposals queued for {claimId || 'this claim'} yet. Run Agent Analysis first.
              </div>
            ) : (
              <>
                <QueueControls label="Pending proposals" queue={pendingQueue}/>{pendingQueue.rows.map((prop) => {
                  const busy = reviewBusyId === prop.proposal_id;
                  return (
                    <div
                      key={prop.proposal_id}
                      data-testid={`agent-proposal-${prop.proposal_id}`}
                      className="p-3 rounded bg-slate-900 border border-slate-700 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[13px] font-mono text-amber-300">
                            PENDING HUMAN APPROVAL · {proposalTypeLabel(prop.proposal_type)}
                          </div>
                          <h4 className="text-xs font-semibold text-white mt-0.5">
                            {prop.title}
                          </h4>
                        </div>
                      </div>

                      <div className="text-[13px] text-slate-300 leading-relaxed">
                        <AgentText text={prop.rationale}/>
                      </div>

                      {prop.proposed_payload.evidence_summary && (
                        <div className="p-2 rounded bg-[#0B1120] border border-slate-800 text-[13px] text-slate-300 space-y-1">
                          <div className="font-mono text-[13px] text-emerald-300">
                            Tag: {prop.proposed_payload.evidence_tag}
                          </div>
                          <div className="leading-relaxed">
                            <AgentText text={prop.proposed_payload.evidence_summary}/>
                          </div>
                        </div>
                      )}

                      {prop.proposed_payload.notice_text && (
                        <div className="p-2 rounded bg-[#0B1120] border border-slate-800 text-[13px] text-slate-300 space-y-1">
                          <div className="font-mono text-[13px] text-emerald-300">
                            FIC Linter: {prop.lint_ok ? 'CLEAN' : `BLOCKED (${prop.lint_violations.join(', ')})`}
                          </div>
                          <div className="leading-relaxed">
                            <AgentText text={prop.proposed_payload.notice_text}/>
                          </div>
                        </div>
                      )}

                      {prop.proposed_payload.suggested_status && (
                        <div className="p-2 rounded bg-[#0B1120] border border-slate-800 text-[13px] text-slate-300 space-y-1">
                          <div className="font-mono text-[13px] text-amber-300">
                            Target Status: {prop.proposed_payload.suggested_status}
                          </div>
                          <ul className="list-disc pl-4 text-[13px] text-slate-400">
                            {(prop.proposed_payload.objective_reasons ?? []).map(
                              (r) => (
                                <li key={r}>{r}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor={`reviewer-note-${prop.proposal_id}`}
                          className="block text-[13px] text-slate-400 mb-1"
                        >
                          Human Reviewer Note / Objective Reason (POPIA s71)
                        </label>
                        <input
                          id={`reviewer-note-${prop.proposal_id}`}
                          type="text"
                          value={reviewNotes[prop.proposal_id] ?? ''}
                          onChange={(e) =>
                            setReviewNotes((prev) => ({
                              ...prev,
                              [prop.proposal_id]: e.target.value,
                            }))
                          }
                          placeholder="Confirm verified source or state reason for rejection"
                          className="w-full bg-[#0B1120] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy || !prop.lint_ok}
                          onClick={() =>
                            void handleReviewProposal(prop, 'approve')
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{busy ? 'Saving...' : 'Record reviewed test action'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleReviewProposal(prop, 'reject')
                          }
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium text-slate-200 whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Return for revision</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {reviewedProposals.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="text-[13px] font-semibold text-slate-400">
                      Reviewed Decisions ({reviewedProposals.length})
                    </div>
                    <QueueControls label="Reviewed proposals" queue={reviewedQueue}/>{reviewedQueue.rows.map((prop) => (
                      <div
                        key={prop.proposal_id}
                        className="p-2.5 rounded bg-slate-900/60 border border-slate-800 text-[13px] space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">
                            {prop.title}
                          </span>
                          <span
                            className={`font-mono font-semibold uppercase ${
                              prop.status === 'approved'
                                ? 'text-emerald-300'
                                : 'text-red-300'
                            }`}
                          >
                            {prop.status==='approved'?'Decision Recorded':'Returned for Revision'}
                          </span>
                        </div>
                        <div className="text-slate-400">
                          {prop.reviewer_note}
                        </div>
                        <div className="font-mono text-[13px] text-slate-500">
                          {prop.reviewed_by_name} (
                          {prop.reviewed_by_role
                            ? ROLE_LABELS[prop.reviewed_by_role]
                            : 'Reviewer'}
                          ) · {formatShortIso(prop.reviewed_at)}
                          {prop.committed_ref
                            ? ` · Ref: ${prop.committed_ref}`
                            : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-2.5" data-testid="agent-audit-panel">
            <div className="flex items-center justify-between text-[13px] text-slate-400">
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <History className="w-3.5 h-3.5 text-emerald-400" />
                <span>Claim Audit Trail ({claimId})</span>
              </span>
              <span className="font-mono tabular-nums">
                {auditTrail.length} events
              </span>
            </div>

            {auditTrail.length === 0 ? (
              <div className="p-3 rounded bg-slate-900/70 border border-slate-800 text-xs text-slate-400">
                No agent or claim audit events recorded for {claimId} yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                <QueueControls label="Claim audit trail" queue={trailQueue}/>{trailQueue.rows.map((log) => (
                  <div
                    key={log.audit_id}
                    className="p-2.5 rounded bg-slate-900/80 border border-slate-800 text-[13px] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="text-emerald-300 font-semibold">
                        {log.action}
                      </span>
                      <span className="text-slate-500">
                        {shortHash(log.audit_id)}
                      </span>
                    </div>
                    <div className="text-slate-300">
                      Actor: {ROLE_LABELS[log.actor_role]} ({log.actor_id}) · Object:{' '}
                      <span className="font-mono">{log.object_id}</span>
                    </div>
                    <div className="text-[13px] font-mono text-slate-500">
                      {formatShortIso(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {context && context.related_evidence.length > 0 && (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="text-[13px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Linked Vault Custody ({context.related_evidence.length})</span>
                </div>
                {context.related_evidence.map((ev) => (
                  <div
                    key={ev.evidence_id}
                    className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[13px] space-y-0.5"
                  >
                    <div className="flex items-center justify-between font-mono text-[13px]">
                      <span className="text-emerald-300">{ev.evidence_id}</span>
                      <span className="text-slate-400">{ev.evidence_tag}</span>
                    </div>
                    <div className="text-slate-200 font-medium">{ev.title}</div>
                    <div className="font-mono text-[13px] text-slate-500">
                      Chain: {shortHash(ev.chain_hash)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AgentActionHistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        claim={claim}
        actions={actionHistory}
        loading={loadingContext}
        runningAnalysis={runningAnalysis}
        onRunAnalysis={() => void runAgentAnalysis()}
      />
    </aside>
  );
};
