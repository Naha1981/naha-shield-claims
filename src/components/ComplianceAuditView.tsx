import React from 'react';
import { Lock, Search, ShieldCheck, ExternalLink } from 'lucide-react';
import type { AuditLogRecord, RoleId } from '../lib/engine/types';
import type { SimulatedAdapterMeta } from '../lib/adapters';
import { RULE_CATALOGUE_V1 } from '../lib/engine/rules';
import { apiFetch } from '../utils/format';

interface GuardrailItem {
  id: string;
  statute: string;
  title: string;
  detail: string;
  status: string;
}

interface ComplianceAuditViewProps {
  guardrails: GuardrailItem[];
  adapters: SimulatedAdapterMeta[];
  auditLog: AuditLogRecord[];
  activeRole: RoleId;
  onRefresh: () => Promise<void>;
}

export const ComplianceAuditView: React.FC<ComplianceAuditViewProps> = ({
  guardrails,
  adapters,
  auditLog,
  activeRole,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = React.useState(
    'FSCA Policyholder Protection Rules 2A.8 funeral claim 2 business days Basdeo',
  );
  const [searchResult, setSearchResult] = React.useState<{
    text: string;
    sources: Array<{ uri: string; title: string }>;
  } | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);

  async function handleRegulatorySearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const res = await apiFetch<{
        text: string;
        sources: Array<{ uri: string; title: string }>;
      }>('/api/ai/regulatory-search', activeRole, {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery }),
      });
      setSearchResult({ text: res.text, sources: res.sources ?? [] });
      await onRefresh();
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Regulatory search failed',
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-2xl font-bold text-white tracking-tight">
          Compliance Guardrails, Adapter Inventory & Audit Log
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Real-time enforcement status for POPIA, PPR Rules 2A.8/2A.10, FIC Act, PEPUDA, Uniform Rule 46A, and CPA s300(5)(b).
        </p>
      </div>

      {/* Phase 3 Cross-Insurer PSI Locked Gate */}
      <div className="p-4 rounded-md bg-slate-900/90 border border-amber-600/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-white">
              Phase 3 Cross-Insurer Private Set Intersection (PSI) — LOCKED
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Zero cross-insurer ID matching or tenant joins exist in v1. Unlock requires written Information Regulator POPIA s57/s58 prior authorisation and ASISA Competition Act governance sign-off.
            </p>
          </div>
        </div>
        <span className="px-3 py-1 rounded border border-amber-500/40 bg-amber-950/40 text-amber-300 font-mono text-xs font-semibold whitespace-nowrap shrink-0">
          LOCKED · POPIA s57/58
        </span>
      </div>

      {/* Statutory Guardrail Register */}
      <section className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">
            Active Legal & Compliance Guardrails ({guardrails.length})
          </h2>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-slate-800">
          {guardrails.map((g) => (
            <div key={g.id} className="p-4 bg-[#131C31] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-emerald-300 font-semibold">
                  {g.id} · {g.statute}
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  {g.status}
                </span>
              </div>
              <div className="text-xs font-semibold text-white">{g.title}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{g.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Versioned Rules & Simulated Adapters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-white border-b border-slate-800 pb-2.5">
            Simulated External Adapters (Credentials Required in Prod)
          </h2>
          <div className="space-y-2.5">
            {adapters.map((a) => (
              <div
                key={a.adapter_id}
                className="p-3 rounded bg-slate-900 border border-slate-800 text-xs space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{a.name}</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-950/30 text-amber-200">
                    {a.badge}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Lawful basis: {a.lawful_basis} · Degrades to: {a.degrades_to}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Regulatory Search Grounding Assistant */}
        <section className="rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-3">
          <div className="border-b border-slate-800 pb-2.5">
            <h2 className="font-display text-base font-semibold text-white">
              SA Insurance Regulatory Research (Free Provider Chain)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Selects an official topic and optional section number from your query. Only that topic, section and official text go to free models, not your query. Demo research only; do not enter personal or claim data. Published versions may omit later amendments.
            </p>
          </div>
          <form onSubmit={handleRegulatorySearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="South African regulatory search query"
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-3.5 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" />
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {searchError && (
            <div className="p-3 rounded bg-amber-950/40 border border-amber-700/60 text-xs text-amber-200">
              {searchError}
            </div>
          )}

          {searchResult && (
            <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 space-y-2 max-h-60 overflow-y-auto">
              <div className="whitespace-pre-wrap leading-relaxed">
                {searchResult.text}
              </div>
              {searchResult.sources.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-400">
                    Grounded Sources
                  </div>
                  {searchResult.sources.map((s) => (
                    <a
                      key={s.uri}
                      href={s.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {s.title || s.uri}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <div className="text-xs font-semibold text-slate-300 mb-2">
              Deterministic Rule Catalogue (v1.0.0)
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {RULE_CATALOGUE_V1.map((r) => (
                <div
                  key={r.rule_id}
                  className="text-[11px] text-slate-400 flex justify-between gap-2 border-b border-slate-800/60 pb-1"
                >
                  <span className="font-mono text-slate-200">{r.rule_id}</span>
                  <span className="truncate flex-1">{r.title}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {r.statute_ref}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Live Audit Log Stream */}
      <section className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-display text-base font-semibold text-white">
            Immutable Audit Log ({auditLog.length} recent events)
          </h2>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="py-2 px-4 font-medium">Timestamp</th>
                <th className="py-2 px-4 font-medium">Actor & Role</th>
                <th className="py-2 px-4 font-medium">Action</th>
                <th className="py-2 px-4 font-medium">Object</th>
                <th className="py-2 px-4 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono text-[11px]">
              {auditLog.map((a) => (
                <tr key={a.audit_id} className="hover:bg-slate-800/30">
                  <td className="py-2 px-4 text-slate-400 whitespace-nowrap">
                    {a.created_at.replace('T', ' ').slice(0, 19)}Z
                  </td>
                  <td className="py-2 px-4 text-slate-200 whitespace-nowrap">
                    {a.actor_id} · {a.actor_role}
                  </td>
                  <td className="py-2 px-4 text-emerald-300 whitespace-nowrap">
                    {a.action}
                  </td>
                  <td className="py-2 px-4 text-slate-300 whitespace-nowrap">
                    {a.object_type}:{a.object_id}
                  </td>
                  <td className="py-2 px-4 text-slate-400 truncate max-w-xs">
                    {JSON.stringify(a.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
