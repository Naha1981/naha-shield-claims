// Design rule (Thabiso, 28 Nov): a busy manager gets this page in 5 seconds.
// Big numbers, status chips, one primary action, ~40 words visible per section.
// Jargon (run IDs, rules, delegations, latency) lives behind Details only.
import React from 'react';
import {
  AlarmClock,
  Banknote,
  Briefcase,
  FileCheck2,
  MapPin,
  Plug,
} from 'lucide-react';
import type {
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  RoleId,
} from '../lib/engine/types';
import { CLAIM_AGENT_REGISTRY } from '../lib/engine/claimsAgents';
import { formatZar } from '../utils/format';

/** Plain-language name and job per registered agent. Registry detail stays in Details. */
const PLAIN_AGENTS: Record<string, { name: string; job: string; icon: React.ElementType }> = {
  investigator_lead: { name: 'Lead investigator', job: 'Pulls everything about a claim into one short brief.', icon: Briefcase },
  claims_sla_coordinator: { name: 'Deadline checker', job: 'Watches legal time limits and missing documents.', icon: AlarmClock },
  document_evidence_analyst: { name: 'Document checker', job: 'Checks death notices and evidence files are complete and untampered.', icon: FileCheck2 },
  entity_geospatial_analyst: { name: 'People and places checker', job: 'Spots unusual patterns. Innocent explanations come first.', icon: MapPin },
  network_payout_analyst: { name: 'Payment checker', job: 'Checks money goes to the right account at the right time.', icon: Banknote },
  tool_integration_auditor: { name: 'Systems checker', job: 'Confirms which checks are real and which are sample.', icon: Plug },
};

function proposalTone(status: string): string {
  if (status === 'approved') return 'border-emerald-700 bg-emerald-950 text-emerald-300';
  if (status === 'rejected') return 'border-red-800 bg-red-950 text-red-300';
  return 'border-amber-700 bg-amber-950 text-amber-300';
}

export const AiOperationsView: React.FC<{
  agentRuns: ClaimAgentRunRecord[];
  agentProposals: ClaimAgentProposalRecord[];
  claims: ClaimPreviewRecord[];
  activeRole: RoleId;
  onNavigate: (route: import('../routes').NavRoute) => void;
}> = ({ agentRuns, agentProposals, claims, activeRole, onNavigate }) => {
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const runs = React.useMemo(
    () => [...agentRuns].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [agentRuns],
  );
  const pending = agentProposals.filter((p) => p.status === 'pending');
  const openRun = runs.find((r) => r.run_id === openRunId) ?? null;
  const totalDuration = runs.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0);
  const casesChecked = new Set(runs.map((r) => r.claim_id)).size;
  const plainAgent = (id: string) =>
    PLAIN_AGENTS[id] ?? { name: id.replaceAll('_', ' '), job: 'Prepares claim checks for a person to review.', icon: Briefcase };

  return (
    <section aria-label="AI checks overview">
      <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">AI checks · Sample</p>
      <h1 className="text-2xl font-semibold text-slate-100 mt-2">What the AI helpers did</h1>
      <p className="text-sm text-slate-300 mt-1 max-w-prose">
        Six AI helpers check claims and prepare the paperwork. You decide what happens.
      </p>

      {/* Glance row: big numbers */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-amber-700 bg-amber-950/40 p-4 text-center">
          <p className="text-3xl font-bold text-amber-300">{pending.length}</p>
          <p className="text-xs text-slate-300 mt-1">Need your OK</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
          <p className="text-3xl font-bold text-slate-100">{runs.length}</p>
          <p className="text-xs text-slate-400 mt-1">Checks finished</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-center">
          <p className="text-3xl font-bold text-slate-100">{casesChecked}</p>
          <p className="text-xs text-slate-400 mt-1">Cases checked</p>
        </div>
      </div>

      {/* Primary action */}
      <button
        type="button"
        onClick={() => onNavigate('/needs-ok')}
        className="mt-4 w-full min-h-[48px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-3 transition-colors"
      >
        {pending.length > 0 ? `Review ${pending.length} item${pending.length === 1 ? '' : 's'} in Needs Your OK` : 'Open Needs Your OK'}
      </button>

      {/* Waiting for a person */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-100">Waiting for a person</h2>
        <p className="text-xs text-slate-400 mt-1">The AI prepared these. Nothing happens until a person says yes or no.</p>
        {pending.length === 0 ? (
          <p className="text-[13px] text-slate-300 mt-2">Nothing waiting right now.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((p) => (
              <li key={p.proposal_id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-100 break-words min-w-0">{plainAgent(p.agent_id).name}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold shrink-0 ${proposalTone(p.status)}`}>Waiting</span>
                </div>
                <p className="text-[13px] text-slate-300 mt-1 break-words">Prepared a case brief for {p.claim_id}. Nothing is filed until a person signs off.</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200">Details</summary>
                  <p className="text-xs text-slate-300 mt-1 break-words">{p.title}</p>
                  <p className="text-xs text-slate-400 mt-1 break-words">{p.rationale}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Finished checks */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-100">Finished checks</h2>
        <p className="text-xs text-slate-400 mt-1">What each helper already looked at. Tap one for the full detail.</p>
        <ul className="mt-2 space-y-2">
          {runs.length === 0 && <li className="text-[13px] text-slate-300">No checks finished yet in this sample workspace.</li>}
          {runs.slice(0, 12).map((r) => (
            <li key={r.run_id}>
              <button
                className="w-full text-left rounded-lg border border-slate-700 bg-slate-900 p-3 min-h-[44px]"
                onClick={() => setOpenRunId(openRunId === r.run_id ? null : r.run_id)}
                aria-expanded={openRunId === r.run_id}
                aria-label={`Open detail for check on ${r.claim_id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 break-words">{plainAgent(r.agent_id).name}</p>
                    <p className="text-xs text-slate-400 mt-1 break-words">{r.claim_id} · {r.created_at.slice(0, 10)}</p>
                  </div>
                  <span className="rounded-full border border-emerald-700 bg-emerald-950 text-emerald-300 px-2 py-0.5 text-[11px] font-semibold shrink-0">Done</span>
                </div>
              </button>
              {openRunId === r.run_id && openRun && (
                <div className="mt-2 rounded-lg border border-sky-800 bg-slate-950 p-4" aria-label={`Check detail ${r.run_id}`}>
                  <dl className="space-y-2 text-[13px]">
                    <div><dt className="text-xs text-slate-400">Run ID</dt><dd className="text-slate-100 break-all">{openRun.run_id}</dd></div>
                    <div><dt className="text-xs text-slate-400">Helper</dt><dd className="text-slate-100">{openRun.agent_name}</dd></div>
                    <div><dt className="text-xs text-slate-400">Case</dt><dd className="text-slate-100">{openRun.claim_id}</dd></div>
                    <div><dt className="text-xs text-slate-400">What it was asked to do</dt><dd className="text-slate-300 break-words">{openRun.prompt_text}</dd></div>
                    <div><dt className="text-xs text-slate-400">What it was allowed to read</dt><dd className="text-slate-300 break-words">Case {openRun.brief.case_reference}; sample records only.</dd></div>
                    <div><dt className="text-xs text-slate-400">Sources</dt><dd className="text-slate-300 break-words">{openRun.brief.audit_references.join(', ') || 'Recorded in the audit trail'}</dd></div>
                    <div><dt className="text-xs text-slate-400">What it found</dt><dd className="text-slate-300 break-words">{openRun.brief.narrative_summary}</dd></div>
                    <div>
                      <dt className="text-xs text-slate-400">Findings</dt>
                      <dd>
                        <ul className="mt-1 space-y-1">
                          {openRun.brief.findings.map((f) => (
                            <li key={f.finding_id} className="text-slate-300 break-words">· {f.summary} <span className="text-slate-400">({f.coverage_status}; source {f.source_ref})</span></li>
                          ))}
                          {openRun.brief.findings.length === 0 && <li className="text-slate-400">No findings on this check.</li>}
                        </ul>
                      </dd>
                    </div>
                    <div><dt className="text-xs text-slate-400">What it could not check</dt><dd className="text-slate-300 break-words">{[...openRun.brief.conflicting_or_missing_info, openRun.brief.advisory_disclaimer].filter(Boolean).join(' · ') || 'None recorded'}</dd></div>
                    <div><dt className="text-xs text-slate-400">Suggested next step for a person</dt><dd className="text-slate-300 break-words">{openRun.brief.suggested_next_human_step}</dd></div>
                    <div><dt className="text-xs text-slate-400">Technical</dt><dd className="text-slate-100">Completed · requested by {openRun.requested_by_role} · provider {openRun.provider_label} ({openRun.model_label}){openRun.brief.prompt_injection_warnings.length > 0 ? ` · ${openRun.brief.prompt_injection_warnings.length} prompt-injection warning(s)` : ''}</dd></div>
                  </dl>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* The six helpers */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-100">The six helpers</h2>
        <p className="text-xs text-slate-400 mt-1">Each has one job. None can pay, reject or accuse on its own.</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {CLAIM_AGENT_REGISTRY.map((a) => {
            const plain = plainAgent(a.id);
            const Icon = plain.icon;
            return (
              <li key={a.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden />
                    <p className="text-sm font-semibold text-slate-100 truncate">{plain.name}</p>
                  </span>
                  <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-300 shrink-0">Ready · sample</span>
                </div>
                <p className="text-[13px] text-slate-300 mt-1.5 break-words">{plain.job}</p>
                <button
                  type="button"
                  onClick={() => onNavigate('/workforce')}
                  className="mt-2 min-h-[44px] w-full rounded-md border border-slate-600 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-slate-800 transition-colors"
                >
                  Open the AI team
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Details: technical operations + registry jargon */}
      <details className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Details: technical operations and full agent registry</summary>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-xs text-slate-400">Recorded runs</dt><dd className="text-slate-100 font-semibold">{runs.length}</dd></div>
          <div><dt className="text-xs text-slate-400">Total recorded run time</dt><dd className="text-slate-100 font-semibold">{Math.round(totalDuration / 1000)}s</dd></div>
          <div><dt className="text-xs text-slate-400">Failed runs</dt><dd className="text-slate-100 font-semibold">0 recorded</dd></div>
          <div><dt className="text-xs text-slate-400">Claims under analysis</dt><dd className="text-slate-100 font-semibold">{casesChecked} of {claims.length}</dd></div>
        </dl>
        <p className="text-xs text-slate-400 mt-3">Engineering metrics live here, separate from forensic findings. Largest sample claim value under analysis: {runs.length ? formatZar(Math.max(...claims.filter((c) => runs.some((r) => r.claim_id === c.claim_id)).map((c) => c.claim_amount), 0)) : 'n/a'}.</p>
        <ul className="mt-3 space-y-2">
          {CLAIM_AGENT_REGISTRY.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-sm font-semibold text-slate-100 break-words">{a.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{a.role_title} · {a.phase}</p>
              <p className="text-[13px] text-slate-300 mt-1 break-words">{a.scope_summary}</p>
              <p className="text-xs text-slate-400 mt-1">Permissions: advisory output only; no payout, fraud or legal authority.{a.delegates_to?.length ? ` Delegates to: ${a.delegates_to.join(', ')}.` : ''}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500 mt-3">Signed-in view: {activeRole} (sample filter, not account access). Every run is synthetic-only and advisory.</p>
      </details>
    </section>
  );
};
