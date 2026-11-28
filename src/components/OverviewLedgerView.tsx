import {useQueueView, QueueControls} from './QueueControls';
import React from 'react';
import { Check, AlertTriangle, Download, FileDown, Printer } from 'lucide-react';
import { evaluateLedgerEntry, summarizeLedger } from '../lib/engine/ledger';
import { summarizeRecoveryPortfolio } from '../lib/engine/triage';
import { summarizeConsentAudit } from '../lib/engine/consent';
import type {
  ClaimPreviewRecord,
  ConsentPolicyInput,
  EvidenceItemRecord,
  KpiAuditNoteRecord,
  LedgerEntryInput,
  RecoveryCaseInput,
  RoleId,
  VaultVerificationResult,
} from '../lib/engine/types';
import { TodayHero } from './TodayHero';
import { ExecutiveBoard } from './ExecutiveBoard';
import { apiFetch, formatZar } from '../utils/format';
import { generateAndDownloadPopiaPdf } from '../utils/pdfReport';
import { AnomalyDensityHeatmap } from './AnomalyDensityHeatmap';
import type { AnomalyAlertRecord } from '../lib/engine/anomaly';
import { KpiSummaryWidget } from './KpiSummaryWidget';
import { RegulatoryNewsFeedWidget } from './RegulatoryNewsFeedWidget';
import { InfrastructureHealthWidget } from './InfrastructureHealthWidget';
import {
  StakeholderApprovalWorkflow,
  type ApplyDigitalSignaturePayload,
  type ApplyDigitalSignatureResult,
} from './StakeholderApprovalWorkflow';
import {
  isLedgerEntryVerified,
  type LedgerApprovalWorkflowRecord,
} from '../lib/engine/approvalWorkflow';
import type { NavRoute } from './LayoutShell';

interface OverviewLedgerViewProps {
  orgId: string;
  entries: LedgerEntryInput[];
  recoveryCases: RecoveryCaseInput[];
  consentPolicies: ConsentPolicyInput[];
  evidenceItems: EvidenceItemRecord[];
  vaultVerification: VaultVerificationResult;
  claims?: ClaimPreviewRecord[];
  anomalyThresholdPct: number;
  anomalyAlerts: AnomalyAlertRecord[];
  kpiAuditNotes: KpiAuditNoteRecord[];
  approvalWorkflows: Record<string, LedgerApprovalWorkflowRecord>;
  onAddKpiAuditNote: (content: string) => Promise<KpiAuditNoteRecord>;
  onToggleKpiAuditNotePdf: (
    noteId: string,
    includeInPdf: boolean,
  ) => Promise<void>;
  onDeleteKpiAuditNote: (noteId: string) => Promise<void>;
  onUpdateThreshold: (thresholdPct: number) => Promise<void>;
  orgName: string;
  activeRole: RoleId;
  activeActorName: string;
  onToggleSignoff: (
    entryId: string,
    signoffType: 'forensics' | 'finance',
    signed: boolean,
  ) => Promise<void>;
  onApplyDigitalSignature: (
    payload: ApplyDigitalSignaturePayload,
  ) => Promise<ApplyDigitalSignatureResult>;
  onNavigate?: (route: NavRoute) => void;
  onRefresh?: () => Promise<void>;
  readoutModalOpen: boolean;
  onCloseReadoutModal: () => void;
}

type LedgerFilter = 'all' | 'counted' | 'awaiting' | 'excluded' | 'backtest';

const FILTER_LABELS: Record<LedgerFilter, string> = {
  all: 'All Rows',
  counted: 'Counted (sample)',
  awaiting: 'Awaiting Sign-Off',
  excluded: 'Excluded / Not Money',
  backtest: 'Backtest',
};

export const OverviewLedgerView: React.FC<OverviewLedgerViewProps> = ({
  orgId,
  entries,
  recoveryCases,
  consentPolicies,
  evidenceItems,
  vaultVerification,
  claims = [],
  anomalyThresholdPct,
  anomalyAlerts,
  kpiAuditNotes,
  approvalWorkflows,
  onAddKpiAuditNote,
  onToggleKpiAuditNotePdf,
  onDeleteKpiAuditNote,
  onUpdateThreshold,
  orgName,
  activeRole,
  activeActorName,
  onToggleSignoff,
  onApplyDigitalSignature,
  onNavigate,
  onRefresh,
  readoutModalOpen,
  onCloseReadoutModal,
}) => {
  const [filter, setFilter] = React.useState<LedgerFilter>('all');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rbacError, setRbacError] = React.useState<string | null>(null);
  const [draftAuditNote, setDraftAuditNote] = React.useState<string>('');
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const [pdfConfirmation, setPdfConfirmation] = React.useState<{
    reportId: string;
    filename: string;
    noteCount: number;
  } | null>(null);

  const recoverySummary = React.useMemo(
    () => summarizeRecoveryPortfolio(recoveryCases),
    [recoveryCases],
  );
  const summary = React.useMemo(
    () => summarizeLedger(entries, recoverySummary.total_lost),
    [entries, recoverySummary.total_lost],
  );
  const consentSummary = React.useMemo(
    () => summarizeConsentAudit(consentPolicies),
    [consentPolicies],
  );

  const evaluatedRows = React.useMemo(() => {
    return entries.map((entry) => ({
      entry,
      evalOut: evaluateLedgerEntry(entry),
    }));
  }, [entries]);

  const filteredRows = React.useMemo(() => {
    return evaluatedRows.filter(({ entry, evalOut }) => {
      if (filter === 'all') return true;
      if (filter === 'counted') return evalOut.is_counted_rand_value;
      if (filter === 'awaiting') {
        return evalOut.language_label === 'awaiting dual sign-off';
      }
      if (filter === 'backtest') return entry.basis === 'Backtest';
      if (filter === 'excluded') {
        return (
          evalOut.language_label === 'n/a — not money' ||
          evalOut.language_label === 'no credit — existing controls' ||
          evalOut.language_label === 'friction logged'
        );
      }
      return true;
    });
  }, [evaluatedRows, filter]);

  async function handleSignoffClick(
    entryId: string,
    signoffType: 'forensics' | 'finance',
    nextVal: boolean,
  ) {
    setRbacError(null);
    setBusyId(`${entryId}-${signoffType}`);
    try {
      await onToggleSignoff(entryId, signoffType, nextVal);
    } catch (err) {
      setRbacError(
        err instanceof Error ? err.message : 'Sign-off action rejected',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleExportPopiaPdf() {
    setRbacError(null);
    setPdfBusy(true);
    try {
      let effectiveNotes = kpiAuditNotes;
      const trimmedDraft = draftAuditNote.trim();
      if (trimmedDraft) {
        const createdNote = await onAddKpiAuditNote(trimmedDraft);
        setDraftAuditNote('');
        effectiveNotes = [
          createdNote,
          ...kpiAuditNotes.filter((n) => n.note_id !== createdNote.note_id),
        ];
      }

      const includedNotes = effectiveNotes.filter((n) => n.include_in_pdf);
      const visibleEntries = filteredRows.map((r) => r.entry);
      const auditMeta = await apiFetch<{
        report_id: string;
        generated_at: string;
        org_name: string;
        actor_display_name: string;
        actor_role: RoleId;
      }>('/api/audit/export-pdf', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          filter,
          row_count: visibleEntries.length,
          note_ids: includedNotes.map((n) => n.note_id),
        }),
      });

      const filename = generateAndDownloadPopiaPdf({
        reportId: auditMeta.report_id,
        generatedAt: auditMeta.generated_at,
        orgName: auditMeta.org_name || orgName,
        actorDisplayName: auditMeta.actor_display_name || activeActorName,
        actorRole: auditMeta.actor_role || activeRole,
        activeFilterLabel: FILTER_LABELS[filter],
        entries,
        filteredEntries: visibleEntries,
        recoveryCases,
        consentPolicies,
        evidenceItems,
        vaultVerification,
        auditNotes: effectiveNotes,
      });

      setPdfConfirmation({
        reportId: auditMeta.report_id,
        filename,
        noteCount: includedNotes.length,
      });
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      setRbacError(
        err instanceof Error ? err.message : 'Unable to export POPIA PDF report',
      );
    } finally {
      setPdfBusy(false);
    }
  }

  const ledgerQueue=useQueueView('savings',filteredRows,{filters:{filter},onRestore:f=>setFilter((f.filter||'all') as LedgerFilter)});
  function handleOpenApprovals() {
    const el = document.getElementById('approvals-tray');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-6">
      {/* Executive intelligence board: 28 Nov alignment review, screen 1 (audit-rc) */}
      <ExecutiveBoard summary={summary} />
      {/* Today hero: approved Screen Designs borrow (owner Go+Sure 28 Nov) */}
      <TodayHero
        exposure={summary.confirmed_fraudulent_loss}
        protectedLive={summary.incremental_protected_live}
        savedAvoided={summary.futile_spend_avoided}
        recoveredCash={summary.bank_reconciled_cash_received}
        caseCount={recoverySummary.case_count}
        claims={claims}
        awaitingSignoffCount={summary.awaiting_signoff_count}
        vaultVerification={vaultVerification}
        evidenceCount={evidenceItems.length}
        onNavigate={onNavigate ? (route) => onNavigate(route) : undefined}
        onOpenApprovals={handleOpenApprovals}
      />

      {/* Page Header */}
      <div id="savings-detail" className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white tracking-tight">
            Sample financial overview
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Arrests, judgments, and repayment promises are excluded from Rand totals. Only bank-reconciled cash and dual-signed incremental saves count.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="text-xs font-mono text-slate-400">
            {entries.length} ledger entries · Dual sign-off enforced
          </div>
          <button
            type="button"
            disabled={pdfBusy}
            onClick={handleExportPopiaPdf}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-md border border-emerald-500/40 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 inline-flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5" />
            {pdfBusy ? 'Generating PDF...' : 'Export sample PDF'}
          </button>
        </div>
      </div>

      {/* POPIA PDF Export Confirmation Banner */}
      {pdfConfirmation && (
        <div
          role="status"
          className="flex items-start gap-3 p-3.5 rounded-md bg-emerald-950/40 border border-emerald-600/50 text-emerald-200 text-xs"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Sample PDF exported: </span>
            <span className="font-mono">{pdfConfirmation.filename}</span> (Report ID{' '}
            <span className="font-mono">{pdfConfirmation.reportId}</span>,{' '}
            <span className="font-mono tabular-nums">
              {pdfConfirmation.noteCount}
            </span>{' '}
            audit note(s) attached and recorded in the local audit trail. Review privacy and disclosure before real use).
          </div>
          <button
            type="button"
            onClick={() => setPdfConfirmation(null)}
            className="text-emerald-300 hover:text-white font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* RBAC Enforcement Alert */}
      {rbacError && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3.5 rounded-md bg-amber-950/50 border border-amber-700/60 text-amber-200 text-xs"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Access Control Enforcement: </span>
            {rbacError}
          </div>
          <button
            type="button"
            onClick={() => setRbacError(null)}
            className="text-amber-300 hover:text-white font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Strictly Separated Executive KPI Strip */}
      <div className="executive-summary"><section aria-label="Separated financial metrics" className="financial-metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Exposure in scope</div>
          <div className="font-mono text-xl font-semibold text-white mt-1.5 tabular-nums">
            {formatZar(summary.confirmed_fraudulent_loss)}
          </div>
          <div className="text-[13px] text-slate-400 mt-1">
            {recoverySummary.case_count} registered loss cases
          </div>
        </div>

        <div className="p-4 rounded-md bg-[#131C31] border border-emerald-500/40">
          <div className="text-xs text-emerald-300 font-medium">
            Reconciled cash · example
          </div>
          <div className="font-mono text-xl font-semibold text-emerald-400 mt-1.5 tabular-nums">
            {formatZar(summary.bank_reconciled_cash_received)}
          </div>
          <div className="text-[13px] text-slate-400 mt-1">
            Net of legal & tracing costs · dual-signed
          </div>
        </div>

        <div className="p-4 rounded-md bg-[#131C31] border border-emerald-500/30">
          <div className="text-xs text-emerald-300 font-medium">
            Protected value · example
          </div>
          <div className="font-mono text-xl font-semibold text-white mt-1.5 tabular-nums">
            {formatZar(summary.incremental_protected_live)}
          </div>
          <div className="text-[13px] text-slate-400 mt-1">
            10% booking factor applied to cancelled policies
          </div>
        </div>

        <div className="p-4 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Avoided spend · example</div>
          <div className="font-mono text-xl font-semibold text-slate-100 mt-1.5 tabular-nums">
            {formatZar(summary.futile_spend_avoided)}
          </div>
          <div className="text-[13px] text-slate-400 mt-1">
            Litigation halted on PTO / nulla bona targets
          </div>
        </div>
      </section><aside className="insights-rail"><div className="context-label">Review insights</div><h3>Financial evidence first</h3><p>{entries.length} sample entries. Values remain separate by evidence and review state.</p><dl><div><dt>Source basis</dt><dd>Seeded ledger and case records</dd></div><div><dt>Required control</dt><dd>Finance and forensic sign-off</dd></div><div><dt>Actual cash collected by this app</dt><dd className="insight-value">R 0</dd></div></dl><a href="#financial-ledger" className="text-sky-300 underline">Inspect underlying records ↓</a></aside></div>

      {/* Non-Cash & Friction Separation Strip */}
      <section aria-label="Non-cash and operational metrics" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">Judgment / Order Value (Not Cash)</div>
            <div className="text-[13px] text-slate-500">Excluded from cash totals</div>
          </div>
          <div className="font-mono text-base font-semibold text-slate-200 tabular-nums">
            {formatZar(summary.judgment_order_value)}
          </div>
        </div>

        <div className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">Agreed Repayment Plans (Not Cash)</div>
            <div className="text-[13px] text-slate-500">Counts only when EFT clears</div>
          </div>
          <div className="font-mono text-base font-semibold text-slate-200 tabular-nums">
            {formatZar(summary.agreed_repayment_plans)}
          </div>
        </div>

        <div className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400">Legal Costs Spent · Cleared FP Friction</div>
            <div className="text-[13px] text-slate-500">
              {summary.cleared_fp_count} FP review(s) · {formatZar(summary.fp_review_cost_total)}
            </div>
          </div>
          <div className="font-mono text-base font-semibold text-amber-300 tabular-nums">
            {formatZar(summary.legal_costs_spent)}
          </div>
        </div>
      </section>

      {/* KPI Summary Widget (Real-Time Cross-Module Data Visualizations + Timestamped Notes) */}
      <KpiSummaryWidget
        recoveryCases={recoveryCases}
        consentPolicies={consentPolicies}
        evidenceItems={evidenceItems}
        vaultVerification={vaultVerification}
        onNavigate={onNavigate}
        auditNotes={kpiAuditNotes}
        draftAuditNote={draftAuditNote}
        onDraftAuditNoteChange={setDraftAuditNote}
        onAttachAuditNote={async (content) => {
          await onAddKpiAuditNote(content);
        }}
        onToggleAuditNotePdf={onToggleKpiAuditNotePdf}
        onDeleteAuditNote={onDeleteKpiAuditNote}
      />

      {/* Anomaly Density Heatmap (Product Segment × Transactional Risk Matrix) */}
      <AnomalyDensityHeatmap
        consentPolicies={consentPolicies}
        anomalyThresholdPct={anomalyThresholdPct}
        anomalyAlerts={anomalyAlerts}
        onUpdateThreshold={onUpdateThreshold}
        onNavigate={onNavigate}
      />

      {/* Live FSCA & POPIA Regulatory News Feed (Google Search Grounding) */}
      <RegulatoryNewsFeedWidget
        activeRole={activeRole}
        onNavigate={onNavigate}
        onSynced={onRefresh}
      />

      {/* Real-Time Infrastructure Health & Integration Latency Sparklines */}
      <InfrastructureHealthWidget
        activeRole={activeRole}
        onProbed={onRefresh}
      />

      {/* Stakeholder Dual-Factor Approval Workflow (Head of Forensics + CFO) */}
      <div id="approvals-tray" className="scroll-mt-20">
      <StakeholderApprovalWorkflow
        orgId={orgId}
        entries={entries}
        approvalWorkflows={approvalWorkflows}
        activeRole={activeRole}
        activeActorName={activeActorName}
        onApplyDigitalSignature={onApplyDigitalSignature}
      />
      </div>

      {/* Ledger Controls & Table */}
      <section className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Dual-Signed Savings & Recovery Ledger
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Forensics co-signature requires <span className="text-slate-200">Head of Forensics</span> role · Finance co-signature requires <span className="text-slate-200">Finance / CFO</span> role. Backtest total: <span className="font-mono text-slate-200">{formatZar(summary.would_have_protected_backtest)}</span> (excluded from Live).
              </p>
            </div>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleExportPopiaPdf}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1.5 self-start lg:self-auto whitespace-nowrap shrink-0"
            >
              <FileDown className="w-3.5 h-3.5 text-emerald-400" />
              Export Filtered View (PDF)
            </button>
          </div>

          <div className="inline-flex flex-nowrap items-center gap-1 p-1 bg-slate-900 rounded-md border border-slate-800 max-w-full overflow-x-auto">
            {(
              [
                ['all', 'All Rows'],
                ['counted', 'Counted (sample)'],
                ['awaiting', `Awaiting Sign-Off (${summary.awaiting_signoff_count})`],
                ['excluded', 'Excluded / Not Money'],
                ['backtest', 'Backtest'],
              ] as Array<[LedgerFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  filter === key
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <QueueControls label="Savings ledger" queue={ledgerQueue}/>
          <table id="financial-ledger" className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                <th className="py-2.5 px-4 font-medium">Entry</th>
                <th className="py-2.5 px-4 font-medium">Event & Description</th>
                <th className="py-2.5 px-4 font-medium">Basis</th>
                <th className="py-2.5 px-4 font-medium text-right">At Stake / Cost</th>
                <th className="py-2.5 px-4 font-medium text-right">Counted (ZAR)</th>
                <th className="py-2.5 px-4 font-medium">Language Lock</th>
                <th className="py-2.5 px-4 font-medium">Approval Status</th>
                <th className="py-2.5 px-4 font-medium text-center">Forensics</th>
                <th className="py-2.5 px-4 font-medium text-center">Finance CFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {ledgerQueue.rows.map(({ entry, evalOut }) => {
                const countedAmount =
                  evalOut.live_protected +
                  evalOut.net_cash_recovered +
                  evalOut.futile_spend_avoided;

                const labelStyle =
                  evalOut.language_label === 'protected / recovered'
                    ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40'
                    : evalOut.language_label === 'awaiting dual sign-off'
                      ? 'text-amber-300 border-amber-500/40 bg-amber-950/40'
                      : evalOut.language_label === 'would have protected'
                        ? 'text-sky-300 border-sky-500/40 bg-sky-950/40'
                        : 'text-slate-300 border-slate-700 bg-slate-900/60';

                return (
                  <tr
                    key={entry.entry_id}
                    className="hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-3 px-4 align-top font-mono text-slate-200 whitespace-nowrap">
                      <div>{entry.entry_id}</div>
                      <div className="text-[13px] text-slate-400">{entry.case_ref}</div>
                    </td>
                    <td className="py-3 px-4 align-top max-w-md">
                      <div className="font-semibold text-slate-100">
                        {entry.event_type}
                      </div>
                      <div className="text-slate-400 mt-0.5 leading-relaxed">
                        {entry.description}
                      </div>
                      {evalOut.why_not_counted && (
                        <div className="text-[13px] text-amber-300/90 mt-1">
                          {evalOut.why_not_counted}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top whitespace-nowrap text-slate-300">
                      <div>{entry.basis}</div>
                      <div className="text-[13px] text-slate-500 font-mono">
                        {entry.event_date}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-slate-200">
                        {formatZar(entry.amount_at_stake)}
                      </div>
                      {entry.legal_costs > 0 && (
                        <div className="text-[13px] text-slate-400">
                          Costs: {formatZar(entry.legal_costs)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top text-right font-mono tabular-nums whitespace-nowrap">
                      <div
                        className={`font-semibold ${
                          countedAmount > 0 ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {formatZar(countedAmount)}
                      </div>
                      {evalOut.would_have_protected > 0 && (
                        <div className="text-[13px] text-sky-300">
                          Backtest: {formatZar(evalOut.would_have_protected)}
                        </div>
                      )}
                      {evalOut.fp_review_cost > 0 && (
                        <div className="text-[13px] text-amber-300">
                          FP cost: {formatZar(evalOut.fp_review_cost)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded border text-[13px] font-medium ${labelStyle}`}
                      >
                        {evalOut.language_label}
                      </span>
                    </td>
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      {(() => {
                        const wf = approvalWorkflows[entry.entry_id];
                        const verified = isLedgerEntryVerified(wf);
                        return verified ? (
                          <div>
                            <div className="text-[13px] font-semibold text-emerald-400">
                              Verified
                            </div>
                            <div className="text-[13px] font-mono text-slate-400 tabular-nums">
                              Cert: {wf.verification_certificate_hash?.slice(0, 10)}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-[13px] font-medium text-amber-300">
                              {wf?.workflow_status ?? 'Pending Dual-Factor'}
                            </div>
                            <div className="text-[13px] text-slate-500">
                              2FA dual sign-off required
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 align-top text-center whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busyId === `${entry.entry_id}-forensics`}
                        aria-label={`Toggle Forensics signoff for ${entry.entry_id}`}
                        onClick={() =>
                          handleSignoffClick(
                            entry.entry_id,
                            'forensics',
                            !entry.forensics_signoff,
                          )
                        }
                        className={`px-2.5 py-1 rounded border text-[13px] font-medium inline-flex items-center gap-1 transition-colors ${
                          entry.forensics_signoff
                            ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {entry.forensics_signoff && <Check className="w-3 h-3" />}
                        {entry.forensics_signoff ? 'Signed' : 'Sign'}
                      </button>
                    </td>
                    <td className="py-3 px-4 align-top text-center whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busyId === `${entry.entry_id}-finance`}
                        aria-label={`Toggle Finance signoff for ${entry.entry_id}`}
                        onClick={() =>
                          handleSignoffClick(
                            entry.entry_id,
                            'finance',
                            !entry.finance_signoff,
                          )
                        }
                        className={`px-2.5 py-1 rounded border text-[13px] font-medium inline-flex items-center gap-1 transition-colors ${
                          entry.finance_signoff
                            ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {entry.finance_signoff && <Check className="w-3 h-3" />}
                        {entry.finance_signoff ? 'Signed' : 'Sign'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase 0 Executive Readout Modal */}
      {readoutModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Phase 0 Executive Readout Summary"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-2xl rounded-lg bg-[#131C31] border border-slate-700 p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  Phase 0 Executive Readout
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  De-identified sample baseline readout · No unconfirmed ROI projections
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseReadoutModal}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-700"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 rounded bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400">R Lost (Confirmed Fraud)</div>
                <div className="font-mono text-lg font-bold text-white mt-1 tabular-nums">
                  {formatZar(recoverySummary.total_lost)}
                </div>
              </div>
              <div className="p-3.5 rounded bg-slate-900 border border-emerald-500/40">
                <div className="text-xs text-emerald-300">R Realistically Collectable</div>
                <div className="font-mono text-lg font-bold text-emerald-400 mt-1 tabular-nums">
                  {formatZar(recoverySummary.total_collectable)}
                </div>
              </div>
              <div className="p-3.5 rounded bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400">R Wasted / Futile Spend Avoided</div>
                <div className="font-mono text-lg font-bold text-amber-300 mt-1 tabular-nums">
                  {formatZar(recoverySummary.total_futile_spend_avoided)}
                </div>
              </div>
              <div className="p-3.5 rounded bg-slate-900 border border-slate-800">
                <div className="text-xs text-slate-400">Consent Exposure Gap (M2)</div>
                <div className="font-mono text-lg font-bold text-red-400 mt-1 tabular-nums">
                  {formatZar(consentSummary.total_exposure_at_gap)}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-300 bg-slate-900/70 border border-slate-800 rounded p-3.5 leading-relaxed">
              Summary: Across {recoverySummary.case_count} recovery files,{' '}
              <span className="font-mono text-white">
                {formatZar(recoverySummary.total_lost)}
              </span>{' '}
              was lost to confirmed fraud, of which{' '}
              <span className="font-mono text-emerald-400">
                {formatZar(recoverySummary.total_collectable)}
              </span>{' '}
              is legally accessible and practically collectable after bonds, arrears, forced-sale discounts, and legal costs. Halting litigation on{' '}
              {recoverySummary.write_off_count} non-executable or nulla bona targets avoids{' '}
              <span className="font-mono text-amber-300">
                {formatZar(recoverySummary.total_futile_spend_avoided)}
              </span>{' '}
              in futile legal spend.
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 text-xs font-medium rounded-md border border-slate-700 text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Summary
              </button>
              <a
                href="/api/readout/phase0?format=csv"
                className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV Readout
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
