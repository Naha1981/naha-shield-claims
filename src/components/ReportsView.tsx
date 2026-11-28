// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = the three report formats. SECONDARY = the on-screen
// snapshot each format draws from. TERTIARY = export mechanics.
// A report is a snapshot of an auditable system state, never a place where
// someone types financial results by hand (28 Nov alignment review, SCREEN_17).
// Every figure carries a source link to the workspace it came from. Exports are
// audit-logged through the real export endpoint. Tokens: project scale only.
import React from 'react';
import type {
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  HumanDecisionRecord,
  LedgerEntryInput,
  RecoveryCaseInput,
  RoleId,
} from '../lib/engine/types';
import { summarizeLedger } from '../lib/engine/ledger';
import { summarizeRecoveryPortfolio } from '../lib/engine/triage';
import { apiFetch, formatZar } from '../utils/format';

type Format = 'briefing' | 'forensic' | 'finance';

const FORMATS: Array<{ id: Format; title: string; audience: string; filter: string }> = [
  { id: 'briefing', title: 'Executive briefing', audience: 'Five to ten slides for board and executive meetings', filter: 'executive-briefing' },
  { id: 'forensic', title: 'Detailed forensic report', audience: 'Case-level findings, methodologies and evidence', filter: 'forensic-report' },
  { id: 'finance', title: 'Finance and assurance statement', audience: 'Transaction-level calculations, reconciliation and sign-offs', filter: 'finance-assurance' },
];

export const ReportsView: React.FC<{
  claims: ClaimPreviewRecord[];
  entries: LedgerEntryInput[];
  recoveryCases: RecoveryCaseInput[];
  decisions: HumanDecisionRecord[];
  agentRuns: ClaimAgentRunRecord[];
  activeRole: RoleId;
  onNavigate: (route: import('../routes').NavRoute) => void;
}> = ({ claims, entries, recoveryCases, decisions, agentRuns, activeRole, onNavigate }) => {
  const summary = React.useMemo(
    () => summarizeLedger(entries, summarizeRecoveryPortfolio(recoveryCases).total_lost),
    [entries, recoveryCases],
  );
  const [format, setFormat] = React.useState<Format>('briefing');
  const [receipt, setReceipt] = React.useState('');

  const exportReport = async (filter: string, rowCount: number) => {
    setReceipt('');
    try {
      const j = await apiFetch<{ ok: boolean; report_id?: string }>('/api/audit/export-pdf', activeRole, {
        method: 'POST',
        body: JSON.stringify({ filter, row_count: rowCount }),
      });
      setReceipt(`Export logged${j.report_id ? ` · report ${j.report_id}` : ''}. Your browser print dialog opens next; choose Save as PDF.`);
      window.print();
    } catch (e) {
      setReceipt(String(e instanceof Error ? e.message : e));
    }
  };

  const Source: React.FC<{ label: string; route: import('../routes').NavRoute }> = ({ label, route }) => (
    <button type="button" className="inline-flex items-center gap-1 ml-2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-slate-800 hover:border-sky-700 transition-colors" onClick={() => onNavigate(route)}>Source: {label}</button>
  );

  const flagged = claims.filter((c) => c.avs_r_status === 'MISMATCH' || c.agent_churn_flag || c.living_person_signal || c.dha_office_outlier || c.bi1663_box24_word_of_mouth);
  const active = FORMATS.find((f) => f.id === format)!;

  return (
    <section aria-label="Reports">
      <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Reports &amp; assurance · Sample</p>
      <h1 className="text-2xl font-semibold text-slate-100 mt-2">Reports from auditable state</h1>
      <p className="text-sm text-slate-300 mt-1 max-w-prose">Every report is a snapshot of the system state you can inspect elsewhere in this workspace. No figure is typed by hand; every number links to its source.</p>

      <div className="mt-4 grid gap-3">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className={`text-left rounded-xl border p-4 ${format === f.id ? 'border-sky-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`}
            onClick={() => { setFormat(f.id); setReceipt(''); }}
            aria-pressed={format === f.id}
          >
            <p className="text-sm font-semibold text-slate-100">{f.title}</p>
            <p className="text-xs text-slate-400 mt-1">{f.audience}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">{active.title} · snapshot</h2>

        {format === 'briefing' && (
          <ol className="mt-3 space-y-3">
            <li className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs text-slate-400">Slide 1 · Money position</p>
              <p className="text-lg font-semibold text-slate-100 mt-1 break-words">{formatZar(summary.incremental_protected_live)} protected live · {formatZar(summary.bank_reconciled_cash_received)} recovered and bank-reconciled</p>
              <Source label="Savings Ledger" route="/savings-ledger" />
            </li>
            <li className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs text-slate-400">Slide 2 · Needs your OK</p>
              <p className="text-lg font-semibold text-slate-100 mt-1">{claims.length} sample claims in the review queue · {decisions.length} decisions recorded</p>
              <Source label="Needs Your OK" route="/needs-ok" />
            </li>
            <li className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs text-slate-400">Slide 3 · Cases under investigation</p>
              <p className="text-lg font-semibold text-slate-100 mt-1">{flagged.length} flagged cases with open evidence</p>
              <Source label="Case Workspace" route="/case-workspace" />
            </li>
            <li className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs text-slate-400">Slide 4 · AI workforce activity</p>
              <p className="text-lg font-semibold text-slate-100 mt-1">{agentRuns.length} advisory runs · 0 automated actions</p>
              <Source label="AI Workforce" route="/ai-ops" />
            </li>
            <li className="rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs text-slate-400">Slide 5 · Assurance and boundaries</p>
              <p className="text-sm text-slate-200 mt-1">Sample workspace. Internally generated; not a regulator certification or independent assurance. Backtest value of {formatZar(summary.would_have_protected_backtest)} is excluded from live outcomes.</p>
              <Source label="Audit & assurance" route="/compliance" />
            </li>
          </ol>
        )}

        {format === 'forensic' && (
          <ul className="mt-3 space-y-2">
            {flagged.map((c) => (
              <li key={c.claim_id} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 break-words">{c.claim_id} · {formatZar(c.claim_amount)}</p>
                    <p className="text-[13px] text-slate-300 mt-1 break-words">Findings: {[
                      c.avs_r_status === 'MISMATCH' && 'AVS-R mismatch',
                      c.agent_churn_flag && 'agent movement',
                      c.living_person_signal && 'living-person signal',
                      c.dha_office_outlier && 'DHA office outlier',
                      c.bi1663_box24_word_of_mouth && 'BI-1663 word-of-mouth',
                    ].filter(Boolean).join(', ')}</p>
                    <p className="text-xs text-slate-400 mt-1">Methodology: deterministic sample rules over intake fields; every finding is a lead for human review, with evidence on the case tabs.</p>
                  </div>
                  <Source label="Case Workspace" route="/case-workspace" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {format === 'finance' && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[520px]">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-700">
                  <th className="py-2 pr-3 font-semibold">Entry</th>
                  <th className="py-2 pr-3 font-semibold">Amount</th>
                  <th className="py-2 pr-3 font-semibold">Sign-off</th>
                  <th className="py-2 font-semibold">Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.entry_id} className="border-b border-slate-800 align-top">
                    <td className="py-2 pr-3 text-slate-100 font-semibold whitespace-nowrap">{e.case_ref}</td>
                    <td className="py-2 pr-3 text-slate-100 whitespace-nowrap">{formatZar(e.amount_at_stake)}</td>
                    <td className="py-2 pr-3 text-slate-300">{e.forensics_signoff && e.finance_signoff ? `Dual · ${e.forensics_signoff_by ?? 'forensics'} + ${e.finance_signoff_by ?? 'finance'}` : 'Pending'}</td>
                    <td className="py-2 text-slate-300">{e.bank_reconciled ? 'Bank-reconciled' : 'Not bank-reconciled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2">Full integer-cents traceability:<Source label="Savings Ledger" route="/savings-ledger" /> · sealed statement:<Source label="Rand found" route="/rand-found" /></p>
          </div>
        )}

        <div className="mt-4 border-t border-slate-700 pt-3">
          <button
            className="rounded-lg border border-sky-700 bg-sky-900 text-sky-100 px-4 py-3 text-sm font-semibold w-full sm:w-auto"
            onClick={() => exportReport(active.filter, format === 'finance' ? entries.length : format === 'forensic' ? flagged.length : 5)}
          >
            Export {active.title} as PDF
          </button>
          <p className="text-xs text-slate-400 mt-2">Every export is audit-logged with a report ID. The snapshot above is exactly what exports.</p>
          {receipt && <p className="text-[13px] text-emerald-300 mt-2 break-words">{receipt}</p>}
        </div>
      </div>
    </section>
  );
};
