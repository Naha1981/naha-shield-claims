// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = Net attributable savings (one big number).
// SECONDARY = the waterfall legs that explain it (gross prevented, deductions).
// TERTIARY = outcome states (cash reconciled, still held, illustrative fee fields).
// One primary action: none on this panel (it is a readout; actions stay in
// "Needs you" below). Tokens: project Tailwind scale only (slate/emerald/sky/
// amber), text sizes from the existing hero scale, two weights (400/600),
// three text colors (slate-100 / slate-300 / slate-400). All figures are
// computed from the live sample ledger summary so the arithmetic always ties.
import React from 'react';
import type { LedgerSummary } from '../lib/engine/types';
import { formatZar } from '../utils/format';

const FEE_RATE = 0.15;

function Badge({ children, tone }: { children: string; tone: 'sample' | 'pending' | 'confirmed' | 'reconciled' }) {
  const cls =
    tone === 'reconciled'
      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
      : tone === 'confirmed'
        ? 'bg-sky-950 text-sky-300 border-sky-700'
        : tone === 'pending'
          ? 'bg-amber-950 text-amber-300 border-amber-700'
          : 'bg-slate-800 text-slate-300 border-slate-600';
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

export const ExecutiveBoard: React.FC<{ summary: LedgerSummary }> = ({ summary }) => {
  const grossPrevented = summary.incremental_protected_live + summary.futile_spend_avoided;
  const deductions = summary.fp_review_cost_total + summary.legal_costs_spent;
  const netAttributable = Math.max(0, grossPrevented - deductions);
  const cashReceived = summary.bank_reconciled_cash_received;
  const stillHeld = Math.max(0, netAttributable - cashReceived);
  const feeBase = netAttributable;
  const feeFinal = Math.round(feeBase * FEE_RATE * 100) / 100;

  return (
    <section aria-label="Executive intelligence board" className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-6 mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <p className="text-[13px] font-semibold tracking-widest text-slate-400 uppercase">Executive intelligence board</p>
        <Badge tone="sample">SAMPLE · illustrative composition</Badge>
      </div>
      <p className="text-sm text-slate-300 mb-5">Money states from the sample ledger. Every figure is computed, never typed.</p>

      <div className="space-y-5">
        <div>
          <p className="text-[13px] text-slate-400 mb-2">Financial attribution</p>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="rounded-lg bg-slate-800 p-2 sm:p-3 min-w-0">
              <p className="text-[13px] text-slate-400">Gross prevented</p>
              <p className="text-base sm:text-lg font-semibold text-slate-100 mt-1 break-words">{formatZar(grossPrevented)}</p>
              <p className="text-[13px] text-slate-400 mt-1">Protected + saved</p>
            </div>
            <div className="rounded-lg bg-slate-800 p-2 sm:p-3 min-w-0">
              <p className="text-[13px] text-slate-400">Less deductions</p>
              <p className="text-base sm:text-lg font-semibold text-slate-100 mt-1 break-words">−{formatZar(deductions)}</p>
              <p className="text-[13px] text-slate-400 mt-1">Review + legal costs</p>
            </div>
            <div className="rounded-lg border border-emerald-700 bg-emerald-950 p-2 sm:p-3 min-w-0 overflow-hidden">
              <p className="text-[13px] text-emerald-300">Net attributable</p>
              <p className="text-lg sm:text-2xl font-semibold text-emerald-200 mt-1 break-words leading-tight">{formatZar(netAttributable)}</p>
              <p className="text-[13px] text-emerald-300/80 mt-1">Waterfall, not three pools</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[13px] text-slate-400 mb-2">Financial outcome states</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg bg-slate-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-slate-400">Cash received</p>
                <Badge tone="reconciled">Reconciled</Badge>
              </div>
              <p className="text-lg font-semibold text-slate-100">{formatZar(cashReceived)}</p>
              <p className="text-[13px] text-slate-400">Bank reconciled · dual-signed</p>
            </div>
            <div className="rounded-lg bg-slate-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-slate-400">Still held</p>
                <Badge tone="pending">Pending</Badge>
              </div>
              <p className="text-lg font-semibold text-slate-100">{formatZar(stillHeld)}</p>
              <p className="text-[13px] text-slate-400">Being checked · not cash yet</p>
            </div>
            <div className="rounded-lg bg-slate-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-slate-400">Performance fee</p>
                <Badge tone="sample">Illustrative</Badge>
              </div>
              <p className="text-lg font-semibold text-slate-100">{formatZar(feeFinal)}</p>
              <p className="text-[13px] text-slate-400">
                Base {formatZar(feeBase)} × 15% · adjustments {formatZar(0)} · nothing settled
              </p>
            </div>
          </div>
        </div>

        <p className="text-[13px] text-slate-400">
          {summary.awaiting_signoff_count} ledger row(s) awaiting dual sign-off · Backtest value {formatZar(summary.would_have_protected_backtest)} is excluded from live outcomes · Ledger arithmetic and bank reconciliation are separate measurements.
        </p>
      </div>
    </section>
  );
};
