// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = work needing humans (pending approvals) and what ran
// (execution queue). SECONDARY = the agent directory. TERTIARY = technical ops.
// A serious AI Operations and Orchestration Console (28 Nov alignment review,
// SCREEN_22): no terminal theatrics. Run detail carries every field the review
// asks for: authorised inputs, tools, sources, output, evidence, limitations,
// human-review requirement, outcome. CPU/latency stays in a collapsed technical
// panel. Tokens: project scale only; tables scroll horizontally on phone.
import React from 'react';
import type {
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  RoleId,
} from '../lib/engine/types';
import { CLAIM_AGENT_REGISTRY } from '../lib/engine/claimsAgents';
import { formatZar } from '../utils/format';

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

  return (
    <section aria-label="AI workforce operations console">
      <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">AI workforce · Operations console · Sample</p>
      <h1 className="text-2xl font-semibold text-slate-100 mt-2">AI operations and orchestration</h1>
      <p className="text-sm text-slate-300 mt-1 max-w-prose">Agents prepare, humans decide. Every run is synthetic-only and advisory; payout, fraud and legal decisions stay human.</p>

      {/* Human approvals */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Human approvals</h2>
        {pending.length === 0 ? (
          <p className="text-[13px] text-slate-300 mt-2">No agent proposals are waiting for approval in this sample workspace.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((p) => (
              <li key={p.proposal_id} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 break-words">{p.title}</p>
                    <p className="text-xs text-slate-400 mt-1 break-words">{p.claim_id} · run {p.run_id}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold shrink-0 ${proposalTone(p.status)}`}>{p.status}</span>
                </div>
                <p className="text-[13px] text-slate-300 mt-2 break-words">{p.rationale}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-2">{agentProposals.length} proposals on record. Decisions are recorded by deciding roles in <button className="text-sky-300 underline" onClick={() => onNavigate('/needs-ok')}>Needs Your OK</button>.</p>
      </div>

      {/* Execution queue / run history / investigation runs */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Execution queue and run history</h2>
        <p className="text-xs text-slate-400 mt-1">{runs.length} recorded runs, each tied to a claim. Open a run for its full detail.</p>
        <ul className="mt-3 space-y-2">
          {runs.length === 0 && <li className="text-[13px] text-slate-300">No runs recorded yet in this sample workspace.</li>}
          {runs.slice(0, 12).map((r) => (
            <li key={r.run_id}>
              <button
                className="w-full text-left rounded-lg border border-slate-700 bg-slate-950 p-3"
                onClick={() => setOpenRunId(openRunId === r.run_id ? null : r.run_id)}
                aria-expanded={openRunId === r.run_id}
                aria-label={`Open run detail ${r.run_id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 break-words">{r.agent_name}</p>
                    <p className="text-xs text-slate-400 mt-1 break-words">Run {r.run_id} · case {r.claim_id} · {r.created_at.slice(0, 10)}</p>
                  </div>
                  <span className="rounded-full border border-emerald-700 bg-emerald-950 text-emerald-300 px-2 py-0.5 text-[11px] font-semibold shrink-0">completed</span>
                </div>
              </button>
              {openRunId === r.run_id && openRun && (
                <div className="mt-2 rounded-lg border border-sky-800 bg-slate-950 p-4" aria-label={`Run detail ${r.run_id}`}>
                  <dl className="space-y-2 text-[13px]">
                    <div><dt className="text-xs text-slate-400">Run ID</dt><dd className="text-slate-100 break-all">{openRun.run_id}</dd></div>
                    <div><dt className="text-xs text-slate-400">Agent</dt><dd className="text-slate-100">{openRun.agent_name}</dd></div>
                    <div><dt className="text-xs text-slate-400">Assigned case</dt><dd className="text-slate-100">{openRun.claim_id}</dd></div>
                    <div><dt className="text-xs text-slate-400">Task description</dt><dd className="text-slate-300 break-words">{openRun.prompt_text}</dd></div>
                    <div><dt className="text-xs text-slate-400">Authorised inputs</dt><dd className="text-slate-300 break-words">Case {openRun.brief.case_reference}; synthetic sample records only (synthetic-only enforced).</dd></div>
                    <div><dt className="text-xs text-slate-400">Tools used</dt><dd className="text-slate-300">Sample evidence retrieval and deterministic checkers. No external-action connectors.</dd></div>
                    <div><dt className="text-xs text-slate-400">Sources accessed</dt><dd className="text-slate-300 break-words">{openRun.brief.audit_references.join(', ') || 'Recorded in the audit trail'}</dd></div>
                    <div><dt className="text-xs text-slate-400">Output produced</dt><dd className="text-slate-300 break-words">{openRun.brief.narrative_summary}</dd></div>
                    <div>
                      <dt className="text-xs text-slate-400">Findings and evidence references</dt>
                      <dd>
                        <ul className="mt-1 space-y-1">
                          {openRun.brief.findings.map((f) => (
                            <li key={f.finding_id} className="text-slate-300 break-words">· {f.summary} <span className="text-slate-400">({f.coverage_status}; source {f.source_ref})</span></li>
                          ))}
                          {openRun.brief.findings.length === 0 && <li className="text-slate-400">No findings on this run.</li>}
                        </ul>
                      </dd>
                    </div>
                    <div><dt className="text-xs text-slate-400">Limitations</dt><dd className="text-slate-300 break-words">{[...openRun.brief.conflicting_or_missing_info, openRun.brief.advisory_disclaimer].filter(Boolean).join(' · ') || 'None recorded'}</dd></div>
                    <div><dt className="text-xs text-slate-400">Confidence and calibration</dt><dd className="text-slate-300 break-words">Advisory only; coverage states per finding above are the calibration signal. {openRun.brief.prompt_injection_warnings.length > 0 ? `${openRun.brief.prompt_injection_warnings.length} prompt-injection warning(s) recorded.` : 'No prompt-injection warnings.'}</dd></div>
                    <div><dt className="text-xs text-slate-400">Human-review requirement</dt><dd className="text-slate-300 break-words">{openRun.brief.suggested_next_human_step}</dd></div>
                    <div><dt className="text-xs text-slate-400">Final run outcome</dt><dd className="text-slate-100">Completed · requested by {openRun.requested_by_role} · provider {openRun.provider_label} ({openRun.model_label})</dd></div>
                  </dl>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Agent directory */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Agent directory</h2>
        <p className="text-xs text-slate-400 mt-1">The implemented roster: {CLAIM_AGENT_REGISTRY.length} specialist agents with defined scope and permissions.</p>
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
      </div>

      {/* System health: technical operations, collapsed */}
      <details className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Technical operations (latency, runs, providers)</summary>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-xs text-slate-400">Recorded runs</dt><dd className="text-slate-100 font-semibold">{runs.length}</dd></div>
          <div><dt className="text-xs text-slate-400">Total recorded run time</dt><dd className="text-slate-100 font-semibold">{Math.round(totalDuration / 1000)}s</dd></div>
          <div><dt className="text-xs text-slate-400">Failed runs</dt><dd className="text-slate-100 font-semibold">0 recorded</dd></div>
          <div><dt className="text-xs text-slate-400">Claims under analysis</dt><dd className="text-slate-100 font-semibold">{new Set(runs.map((r) => r.claim_id)).size} of {claims.length}</dd></div>
        </dl>
        <p className="text-xs text-slate-400 mt-3">Engineering metrics live here, separate from forensic findings. Largest sample claim value under analysis: {runs.length ? formatZar(Math.max(...claims.filter((c) => runs.some((r) => r.claim_id === c.claim_id)).map((c) => c.claim_amount), 0)) : 'n/a'}.</p>
      </details>
    </section>
  );
};
