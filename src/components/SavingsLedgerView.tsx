// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = the money state (six lifecycle stages, big figures).
// SECONDARY = the reconciliation bridge. TERTIARY = the transaction ledger detail.
// The six financial event lifecycle states stay visibly separate (28 Nov alignment
// review, SCREEN_30): prevented is never recovered cash; backtest is never a live
// outcome. Rand found is the vault-sealed, archived statement of countable value,
// with amounts in exact cents and a logged PDF export. Tokens: project scale only,
// two weights, three text colours; tables scroll horizontally on phone.
import { InlineNavLink } from './InlineNavLink';
import React from 'react';
import type { LedgerEntryInput, RecoveryCaseInput, RoleId } from '../lib/engine/types';
import { evaluateLedgerEntry, summarizeLedger } from '../lib/engine/ledger';
import { summarizeRecoveryPortfolio } from '../lib/engine/triage';
import { apiFetch, formatZar, ROLE_LABELS } from '../utils/format';

const NON_MONEY = new Set(['Criminal arrest / conviction', 'False positive review']);

function formatZarExact(amount: number): string {
  const cents = Math.round(amount * 100);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100).toLocaleString('en-ZA');
  const rem = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}R ${rands}.${rem}`;
}

type LifecycleStage = {
  n: number;
  label: string;
  meaning: string;
  amount: number;
  isCost?: boolean;
};

function lifecycleStages(entries: LedgerEntryInput[], summary: ReturnType<typeof summarizeLedger>): LifecycleStage[] {
  let potential = 0;
  let cashReceivedUnreconciled = 0;
  for (const e of entries) {
    if (e.cleared_fp || NON_MONEY.has(e.event_type)) continue;
    const dualSigned = e.forensics_signoff && e.finance_signoff;
    if (!dualSigned) {
      potential += e.amount_at_stake;
      continue;
    }
    if (e.event_type === 'Cash recovered' && !e.bank_reconciled) {
      cashReceivedUnreconciled += e.amount_at_stake;
    }
  }
  return [
    { n: 1, label: 'Potentially protected', meaning: 'Estimated opportunity, awaiting dual sign-off', amount: Math.round(potential * 100) / 100 },
    { n: 2, label: 'Human-confirmed protected', meaning: 'Verified against the attribution rules', amount: summary.incremental_protected_live },
    { n: 3, label: 'Recovery initiated', meaning: 'Judgment, order or repayment plan under way', amount: Math.round((summary.judgment_order_value + summary.agreed_repayment_plans) * 100) / 100 },
    { n: 4, label: 'Cash received', meaning: 'Funds received with transaction evidence, not yet bank-reconciled', amount: Math.round(cashReceivedUnreconciled * 100) / 100 },
    { n: 5, label: 'Bank reconciled', meaning: 'Receipt matched against banking evidence', amount: summary.bank_reconciled_cash_received },
    { n: 6, label: 'Fees settled', meaning: 'Legal costs and fees paid (a cost, never a saving)', amount: summary.legal_costs_spent, isCost: true },
  ];
}

function approvalState(e: LedgerEntryInput): { label: string; tone: string } {
  if (e.cleared_fp) return { label: 'Excluded', tone: 'border-slate-600 bg-slate-800 text-slate-300' };
  if (!e.forensics_signoff || !e.finance_signoff) return { label: 'Pending', tone: 'border-amber-700 bg-amber-950 text-amber-300' };
  return { label: 'Approved', tone: 'border-emerald-700 bg-emerald-950 text-emerald-300' };
}

export const SavingsLedgerView: React.FC<{
  entries: LedgerEntryInput[];
  recoveryCases: RecoveryCaseInput[];
  activeRole: RoleId;
  onNavigate: (route: import('../routes').NavRoute) => void;
}> = ({ entries, recoveryCases, activeRole, onNavigate }) => {
  const summary = React.useMemo(
    () => summarizeLedger(entries, summarizeRecoveryPortfolio(recoveryCases).total_lost),
    [entries, recoveryCases],
  );
  const stages = React.useMemo(() => lifecycleStages(entries, summary), [entries, summary]);
  const rows = React.useMemo(
    () => entries.map((entry) => ({ entry, out: evaluateLedgerEntry(entry) })),
    [entries],
  );
  const grossProtected = stages[0].amount + stages[1].amount;

  return (
    <section aria-label="Savings ledger">
      <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Savings ledger · Sample statement</p>
      <h1 className="text-2xl font-semibold text-slate-100 mt-2">Financial event lifecycle</h1>
      <p className="text-sm text-slate-300 mt-1 max-w-prose">Prevented losses are never recovered cash. Backtest value is never a live outcome. Each state below is counted separately.</p>

      {/* Financial position: six lifecycle states */}
      <ol className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stages.map((s) => (
          <li key={s.n} className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0">
            <p className="text-xs text-slate-400">State {s.n}</p>
            <p className="text-sm font-semibold text-slate-100 mt-0.5 break-words">{s.label}</p>
            <p className={`text-xl font-semibold mt-1 break-words ${s.isCost ? 'text-slate-400' : 'text-slate-100'}`}>{formatZar(s.amount)}</p>
            <p className="text-xs text-slate-400 mt-1 break-words">{s.meaning}</p>
          </li>
        ))}
      </ol>

      {/* Reconciliation bridge */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Reconciliation bridge</h2>
        <p className="text-xs text-slate-400 mt-1">Exactly how each amount was calculated, from gross protected to net attributable value.</p>
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Gross protected (potential + confirmed)</dt><dd className="font-semibold text-slate-100 shrink-0">{formatZar(grossProtected)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Less: awaiting dual sign-off</dt><dd className="font-semibold text-slate-100 shrink-0">-{formatZar(stages[0].amount)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Net attributable protected (live)</dt><dd className="font-semibold text-emerald-300 shrink-0">{formatZar(summary.incremental_protected_live)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Cash received, bank-reconciled</dt><dd className="font-semibold text-emerald-300 shrink-0">{formatZar(summary.bank_reconciled_cash_received)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Futile spend avoided (counted value)</dt><dd className="font-semibold text-slate-100 shrink-0">{formatZar(summary.futile_spend_avoided)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-300">Legal costs and fees spent</dt><dd className="font-semibold text-slate-400 shrink-0">-{formatZar(summary.legal_costs_spent)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-slate-700 pt-2"><dt className="text-slate-300">Would have protected (backtest only, never a live outcome)</dt><dd className="font-semibold text-slate-400 shrink-0">{formatZar(summary.would_have_protected_backtest)}</dd></div>
        </dl>
      </div>

      {/* Transaction ledger */}
      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Transaction ledger</h2>
        <p className="text-xs text-slate-400 mt-1">Fictional sample rows. Every transaction traces to claim, classification, integer-cents calculation, attribution, rule, evidence, sign-off and reconciliation.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-700">
                <th className="py-2 pr-3 font-semibold">Claim</th>
                <th className="py-2 pr-3 font-semibold">Gross impact</th>
                <th className="py-2 pr-3 font-semibold">Attribution</th>
                <th className="py-2 pr-3 font-semibold">Evidence</th>
                <th className="py-2 font-semibold">Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, out }) => {
                const ap = approvalState(entry);
                return (
                  <tr key={entry.entry_id} className="border-b border-slate-800 align-top">
                    <td className="py-2 pr-3 text-slate-100 font-semibold whitespace-nowrap">{entry.case_ref}</td>
                    <td className="py-2 pr-3 text-slate-100 whitespace-nowrap">{formatZarExact(entry.amount_at_stake)}</td>
                    <td className="py-2 pr-3 text-slate-300">{out.language_label} · {entry.basis}</td>
                    <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">{entry.entry_id}</td>
                    <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ap.tone}`}>{ap.label}</span></td>
                  </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-sky-300">Traceability detail for every row</summary>
          <ul className="mt-2 space-y-2">
            {rows.map(({ entry, out }) => (
              <li key={entry.entry_id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300 break-words">
                <span className="font-semibold text-slate-100">{entry.entry_id}</span> · {entry.event_type} · exact {formatZarExact(entry.amount_at_stake)} (integer-cents arithmetic, rule evaluateLedgerEntry v1) · {entry.basis} basis · sign-off: forensics {entry.forensics_signoff_by ?? 'pending'}, finance {entry.finance_signoff_by ?? 'pending'} · reconciliation: {entry.bank_reconciled ? 'bank-reconciled with transaction reference' : 'not bank-reconciled'} · {out.why_not_counted ?? 'counted rand value'}
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-slate-400 mt-3">Sign-off and recovery actions: <InlineNavLink onClick={() => onNavigate('/recovery')}>open Recovery desk</InlineNavLink>. Signed in as {ROLE_LABELS[activeRole]} (sample view).</p>
      </div>
    </section>
  );
};

export const RandFoundView: React.FC<{
  entries: LedgerEntryInput[];
  recoveryCases: RecoveryCaseInput[];
  vaultValid: boolean;
  activeRole: RoleId;
}> = ({ entries, recoveryCases, vaultValid, activeRole }) => {
  const summary = React.useMemo(
    () => summarizeLedger(entries, summarizeRecoveryPortfolio(recoveryCases).total_lost),
    [entries, recoveryCases],
  );
  const found = React.useMemo(() => {
    const countable = entries
      .map((entry) => ({ entry, out: evaluateLedgerEntry(entry) }))
      .filter(({ out }) => out.is_counted_rand_value);
    const total = countable.reduce((acc, { out }) => acc + out.live_protected + out.net_cash_recovered + out.futile_spend_avoided, 0);
    return { countable, total: Math.round(total * 100) / 100 };
  }, [entries]);
  const [receipt, setReceipt] = React.useState('');

  const exportPdf = async () => {
    try {
      const j = await apiFetch<{ ok: boolean; report_id?: string }>('/api/audit/export-pdf', activeRole, {
        method: 'POST',
        body: JSON.stringify({ filter: 'rand-found', row_count: found.countable.length }),
      });
      setReceipt(`Export logged${j.report_id ? ` · report ${j.report_id}` : ''}. Your browser print dialog opens next; choose Save as PDF.`);
      window.print();
    } catch (e) {
      setReceipt(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <section aria-label="Rand found">
      <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Rand found · Sample statement</p>
      <h1 className="text-2xl font-semibold text-slate-100 mt-2">Savings found in the sample book</h1>
      <p className="text-4xl font-semibold text-slate-100 mt-3 break-words">{formatZarExact(found.total)}</p>
      <p className="text-sm text-slate-300 mt-2 max-w-prose">Protected, found and recovered are separate. Found value below is human-confirmed and dual-signed; it counts as recovered cash only after bank reconciliation clears ({formatZar(summary.bank_reconciled_cash_received)} reconciled so far).</p>

      <ul className="mt-4 space-y-2">
        {found.countable.map(({ entry, out }) => (
          <li key={entry.entry_id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100 break-words">{entry.case_ref} · {entry.event_type}</p>
                <p className="text-xs text-slate-400 mt-1 break-words">Archived {entry.event_date} · evidence {entry.entry_id} · {out.language_label}</p>
              </div>
              <p className="text-lg font-semibold text-slate-100 shrink-0 whitespace-nowrap">{formatZarExact(out.live_protected + out.net_cash_recovered + out.futile_spend_avoided)}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className={`rounded-full border px-2 py-0.5 ${vaultValid ? 'border-sky-700 bg-sky-950 text-sky-300' : 'border-slate-600 bg-slate-800 text-slate-300'}`}>{vaultValid ? 'Vault-sealed' : 'Vault seal unverified'}</span>
              <span className="rounded-full border border-emerald-700 bg-emerald-950 text-emerald-300 px-2 py-0.5">Dual sign-off</span>
              <span className={`rounded-full border px-2 py-0.5 ${entry.bank_reconciled ? 'border-emerald-700 bg-emerald-950 text-emerald-300' : 'border-slate-600 bg-slate-800 text-slate-300'}`}>{entry.bank_reconciled ? 'Bank-reconciled' : 'Not yet bank-reconciled'}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <button className="rounded-lg border border-sky-700 bg-sky-900 text-sky-100 px-4 py-3 text-sm font-semibold w-full sm:w-auto" onClick={exportPdf}>
          Export PDF statement
        </button>
        <p className="text-xs text-slate-400 mt-2">Every export is logged in the audit trail with a report ID. Amounts are exact cents from integer-cents arithmetic. Sample statement; never a financial claim against a real insurer.</p>
        {receipt && <p className="text-[13px] text-emerald-300 mt-2 break-words">{receipt}</p>}
      </div>
    </section>
  );
};
