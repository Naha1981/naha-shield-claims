import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { filterClaimAgentActionHistory } from '../lib/engine/claimsAgents';
import type {
  ClaimAgentActionCategory,
  ClaimAgentActionHistoryItem,
  ClaimAgentActionOutcomeStatus,
  ClaimPreviewRecord,
} from '../lib/engine/types';

interface AgentActionHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  claim: ClaimPreviewRecord | undefined;
  actions: ClaimAgentActionHistoryItem[];
  loading: boolean;
  runningAnalysis: boolean;
  onRunAnalysis: () => void;
}

type FilterOption = 'all' | ClaimAgentActionCategory;

const FILTER_TABS: Array<{ id: FilterOption; label: string }> = [
  { id: 'all', label: 'All Actions' },
  { id: 'analysis_run', label: 'Runs' },
  { id: 'automated_check', label: 'Checks' },
  { id: 'guardrail_lint', label: 'Guardrails' },
  { id: 'human_gate', label: 'Human Gates' },
];

function formatUtcTimestamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return `${dt.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function outcomeBadge(status: ClaimAgentActionOutcomeStatus): {
  icon: React.ReactNode;
  textClass: string;
} {
  switch (status) {
    case 'completed':
    case 'verified':
    case 'approved':
      return {
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
        textClass: 'text-emerald-300',
      };
    case 'warning':
    case 'pending':
      return {
        icon:
          status === 'pending' ? (
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          ),
        textClass: 'text-amber-300',
      };
    case 'blocked':
    case 'rejected':
      return {
        icon:
          status === 'blocked' ? (
            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          ),
        textClass: 'text-red-300',
      };
  }
}

export const AgentActionHistoryDrawer: React.FC<
  AgentActionHistoryDrawerProps
> = ({
  open,
  onClose,
  claim,
  actions,
  loading,
  runningAnalysis,
  onRunAnalysis,
}) => {
  const [categoryFilter, setCategoryFilter] =
    React.useState<FilterOption>('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const closeBtnRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  React.useEffect(() => {
    setCategoryFilter('all');
    setSearchQuery('');
  }, [claim?.claim_id]);

  if (!open) return null;

  const filteredActions = filterClaimAgentActionHistory(
    actions,
    categoryFilter,
    searchQuery,
  );
  const runsCount = actions.filter((a) => a.category === 'analysis_run').length;
  const checksCount = actions.filter(
    (a) => a.category === 'automated_check' || a.category === 'guardrail_lint',
  ).length;
  const gatesCount = actions.filter((a) => a.category === 'human_gate').length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-action-history-title"
        data-testid="agent-action-history-drawer"
        className="w-full max-w-2xl bg-[#0F172A] border-l border-slate-800 h-full flex flex-col shadow-2xl"
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-[#0B1120] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400 shrink-0" />
              <h2
                id="agent-action-history-title"
                className="font-display text-base font-semibold text-white"
              >
                Agent Action History
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate">
              {claim
                ? `${claim.claim_id} · ${claim.policy_ref} · ${claim.deceased_alias} · Synthetic Data Only`
                : 'Select a claim record to inspect automated agent actions'}
            </p>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close Agent Action History drawer"
            className="p-2 rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary Strip */}
        <div className="px-5 py-3 border-b border-slate-800 bg-[#131C31]/70 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="rounded bg-slate-900/90 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-400">Total Actions</div>
            <div
              data-testid="drawer-total-actions"
              className="font-mono text-sm font-semibold text-white tabular-nums mt-0.5"
            >
              {actions.length}
            </div>
          </div>
          <div className="rounded bg-slate-900/90 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-400">Analysis Runs</div>
            <div className="font-mono text-sm font-semibold text-emerald-300 tabular-nums mt-0.5">
              {runsCount}
            </div>
          </div>
          <div className="rounded bg-slate-900/90 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-400">Checks &amp; Lints</div>
            <div className="font-mono text-sm font-semibold text-slate-200 tabular-nums mt-0.5">
              {checksCount}
            </div>
          </div>
          <div className="rounded bg-slate-900/90 border border-slate-800 px-3 py-2">
            <div className="text-[11px] text-slate-400">Human Gates</div>
            <div className="font-mono text-sm font-semibold text-amber-300 tabular-nums mt-0.5">
              {gatesCount}
            </div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="px-5 py-3 border-b border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-slate-900 border border-slate-800">
            {FILTER_TABS.map((tab) => {
              const active = categoryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#131C31] text-white border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter agent actions by action type, agent, or outcome"
              placeholder="Filter by action type, agent name, or outcome..."
              className="w-full bg-slate-900 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Action List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="space-y-3 py-2" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-20 rounded bg-slate-900/70 border border-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : actions.length === 0 ? (
            <div
              data-testid="drawer-empty-state"
              className="p-6 rounded-md bg-slate-900/70 border border-slate-800 text-center space-y-3 my-4"
            >
              <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">
                  No Automated Agent Actions Recorded Yet
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  No integrated claims agent has run automated checks on{' '}
                  <span className="font-mono text-slate-200">
                    {claim?.claim_id ?? 'this claim'}
                  </span>{' '}
                  yet. Execute an analysis to inspect SLA clocks, vault provenance, entity triangulation, and FIC tipping-off linting.
                </p>
              </div>
              <button
                type="button"
                disabled={runningAnalysis || !claim}
                onClick={onRunAnalysis}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {runningAnalysis ? 'Running Analysis...' : 'Run Agent Analysis'}
                </span>
              </button>
            </div>
          ) : filteredActions.length === 0 ? (
            <div className="p-5 rounded-md bg-slate-900/70 border border-slate-800 text-xs text-slate-400 text-center">
              No automated agent actions match the current filter or search query.
            </div>
          ) : (
            <div
              data-testid="agent-action-history-list"
              className="divide-y divide-slate-800 border border-slate-800 rounded-md bg-[#131C31]/50"
            >
              {filteredActions.map((item) => {
                const badge = outcomeBadge(item.outcome_status);
                return (
                  <div
                    key={item.action_id}
                    data-testid={`history-action-${item.action_id}`}
                    className="p-3.5 space-y-1.5 hover:bg-slate-900/60 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-white">
                        {item.action_type}
                      </div>
                      <time
                        dateTime={item.timestamp}
                        className="text-[11px] font-mono text-slate-400 tabular-nums"
                      >
                        {formatUtcTimestamp(item.timestamp)}
                      </time>
                    </div>

                    <div className="flex items-start gap-1.5 text-xs">
                      {badge.icon}
                      <span className={`font-medium ${badge.textClass}`}>
                        {item.outcome}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {item.detail}
                    </p>

                    <div className="text-[10px] font-mono text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>Agent: {item.agent_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>Ref: {item.reference}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-[#0B1120] flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">
            POPIA s71 Human-in-the-Loop Enforced · Automated outputs remain advisory
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={runningAnalysis || !claim}
              onClick={onRunAnalysis}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap transition-colors"
            >
              <Play className="w-3 h-3" />
              <span>
                {runningAnalysis ? 'Running...' : 'Run New Analysis'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
