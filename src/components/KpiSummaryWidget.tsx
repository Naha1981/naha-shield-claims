import React from 'react';
import {
  ArrowUpRight,
  FileText,
  FolderLock,
  Plus,
  Scale,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { evaluateConsentPolicy } from '../lib/engine/consent';
import { MAX_KPI_AUDIT_NOTE_LENGTH } from '../lib/engine/popia';
import { evaluateRecoveryCase } from '../lib/engine/triage';
import type {
  ConsentPolicyInput,
  EvidenceItemRecord,
  KpiAuditNoteRecord,
  RecoveryCaseInput,
  VaultVerificationResult,
} from '../lib/engine/types';
import { formatZar, formatZarCompact, ROLE_LABELS } from '../utils/format';
import type { NavRoute } from './LayoutShell';

interface KpiSummaryWidgetProps {
  recoveryCases: RecoveryCaseInput[];
  consentPolicies: ConsentPolicyInput[];
  evidenceItems: EvidenceItemRecord[];
  vaultVerification: VaultVerificationResult;
  onNavigate?: (route: NavRoute) => void;
  auditNotes?: KpiAuditNoteRecord[];
  draftAuditNote?: string;
  onDraftAuditNoteChange?: (value: string) => void;
  onAttachAuditNote?: (content: string) => Promise<void>;
  onToggleAuditNotePdf?: (noteId: string, includeInPdf: boolean) => Promise<void>;
  onDeleteAuditNote?: (noteId: string) => Promise<void>;
}

export const KpiSummaryWidget: React.FC<KpiSummaryWidgetProps> = ({
  recoveryCases,
  consentPolicies,
  evidenceItems,
  vaultVerification,
  onNavigate,
  auditNotes = [],
  draftAuditNote = '',
  onDraftAuditNoteChange,
  onAttachAuditNote,
  onToggleAuditNotePdf,
  onDeleteAuditNote,
}) => {
  const [hoveredSegment, setHoveredSegment] = React.useState<string | null>(null);
  const [noteBusy, setNoteBusy] = React.useState(false);
  const [noteError, setNoteError] = React.useState<string | null>(null);

  async function handleSubmitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!onAttachAuditNote) return;
    const trimmed = draftAuditNote.trim();
    if (!trimmed) {
      setNoteError('Enter a short internal audit observation before attaching.');
      return;
    }
    setNoteError(null);
    setNoteBusy(true);
    try {
      await onAttachAuditNote(trimmed);
      onDraftAuditNoteChange?.('');
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : 'Unable to attach audit note.',
      );
    } finally {
      setNoteBusy(false);
    }
  }

  // 1. Real-time Recovery Pipeline Analytics
  const pipelineStats = React.useMemo(() => {
    let totalLost = 0;
    let collectable = 0;
    let futileAvoided = 0;
    let s300Count = 0;
    let s297Count = 0;
    let writeOffCount = 0;
    let settlementCount = 0;

    for (const c of recoveryCases) {
      const t = evaluateRecoveryCase(c);
      totalLost += c.original_payout;
      collectable += t.practically_recoverable;
      futileAvoided += t.futile_spend_avoided;

      if (t.early_write_off && c.employment === 'Salaried') {
        s297Count += 1;
      } else if (t.early_write_off) {
        writeOffCount += 1;
      } else if (t.s300_forum) {
        s300Count += 1;
      } else {
        settlementCount += 1;
      }
    }

    const uncoveredGap = Math.max(totalLost - collectable, 0);
    const recoveryRatePct =
      totalLost > 0 ? Math.round((collectable / totalLost) * 100) : 0;

    return {
      totalLost,
      collectable,
      uncoveredGap,
      futileAvoided,
      recoveryRatePct,
      caseCount: recoveryCases.length,
      routes: [
        {
          id: 's300',
          label: 'Civil / CPA s300',
          count: s300Count,
          color: '#10B981',
        },
        {
          id: 'settlement',
          label: 'Structured Settlement',
          count: settlementCount,
          color: '#38BDF8',
        },
        {
          id: 's297',
          label: 'CPA s297 Emoluments',
          count: s297Count,
          color: '#F59E0B',
        },
        {
          id: 'writeoff',
          label: 'Early Write-Off',
          count: writeOffCount,
          color: '#64748B',
        },
      ],
    };
  }, [recoveryCases]);

  // 2. Real-time Pending Consent Actions Analytics
  const consentStats = React.useMemo(() => {
    let pendingDistinct = 0;
    let consentGap = 0;
    let channelNotIndependent = 0;
    let contactUnverified = 0;
    let duressAlerts = 0;
    let cleanThirdParty = 0;
    let exposureAtGap = 0;

    for (const p of consentPolicies) {
      const ev = evaluateConsentPolicy(p);
      const hasContactIssue =
        ev.contact_independence_status ===
        'Contact Independence Unverified — Escalate';
      const hasGap = ev.consent_gap_status === 'CONSENT GAP';
      const hasChannelIssue =
        ev.consent_gap_status === 'CHANNEL NOT INDEPENDENT';

      if (hasGap) consentGap += 1;
      if (hasChannelIssue) channelNotIndependent += 1;
      if (hasContactIssue) contactUnverified += 1;
      if (p.duress_alert) duressAlerts += 1;

      if (hasGap || hasChannelIssue || hasContactIssue || p.duress_alert) {
        pendingDistinct += 1;
      } else if (ev.third_party) {
        cleanThirdParty += 1;
      }
      exposureAtGap += ev.exposure_at_gap;
    }

    const total = Math.max(consentPolicies.length, 1);
    const categories = [
      {
        id: 'gap',
        label: 'Missing Consent',
        count: consentGap,
        pct: Math.round((consentGap / total) * 100),
        barClass: 'bg-red-500',
      },
      {
        id: 'channel',
        label: 'Channel Not Independent',
        count: channelNotIndependent,
        pct: Math.round((channelNotIndependent / total) * 100),
        barClass: 'bg-amber-400',
      },
      {
        id: 'contact',
        label: 'Unverified Contact',
        count: contactUnverified,
        pct: Math.round((contactUnverified / total) * 100),
        barClass: 'bg-sky-400',
      },
      {
        id: 'duress',
        label: 'Silent Duress Alert',
        count: duressAlerts,
        pct: Math.round((duressAlerts / total) * 100),
        barClass: 'bg-rose-500',
      },
    ];

    return {
      pendingDistinct,
      cleanThirdParty,
      totalPolicies: consentPolicies.length,
      exposureAtGap,
      categories,
    };
  }, [consentPolicies]);

  // 3. Real-time Vault Integrity Score & Hash-Chain Link Analytics
  const vaultStats = React.useMemo(() => {
    const totalLinks = Math.max(
      vaultVerification.checked_count,
      evidenceItems.length,
    );
    const intactLinks = vaultVerification.valid
      ? totalLinks
      : Math.max(vaultVerification.failed_index ?? 0, 0);
    const integrityScore =
      totalLinks > 0 ? Math.round((intactLinks / totalLinks) * 100) : 100;

    const verifiedFacts = evidenceItems.filter(
      (i) => i.evidence_tag === 'Verified Fact',
    ).length;
    const allegations = evidenceItems.filter(
      (i) => i.evidence_tag === 'Documented Allegation',
    ).length;

    const links = evidenceItems.map((item, idx) => {
      const broken =
        !vaultVerification.valid &&
        vaultVerification.failed_index !== null &&
        idx >= vaultVerification.failed_index;
      return {
        id: item.evidence_id,
        tag: item.evidence_tag,
        broken,
        isFailPoint: vaultVerification.failed_index === idx,
      };
    });

    return {
      valid: vaultVerification.valid,
      integrityScore,
      intactLinks,
      totalLinks,
      verifiedFacts,
      allegations,
      failedId: vaultVerification.failed_evidence_id,
      links,
    };
  }, [evidenceItems, vaultVerification]);

  // SVG gauge geometry for Vault Integrity Score
  const gaugeRadius = 32;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset =
    gaugeCircumference * (1 - vaultStats.integrityScore / 100);

  const collectableWidthPct =
    pipelineStats.totalLost > 0
      ? (pipelineStats.collectable / pipelineStats.totalLost) * 100
      : 0;

  return (
    <section
      aria-label="KPI Summary"
      className="rounded-md bg-[#131C31] border border-slate-800 p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            KPI Summary
          </h2>
          <p className="text-xs text-slate-400">
            Sample cross-module calculations from recovery estimates, consent simulation and stored evidence checks.
          </p>
        </div>
        <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
          SYNTHETIC ENGINE VIEW · NOT BOOKED CASH
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card 1: Total Recovery Pipeline Value + Stacked Pipeline & Route Chart */}
        <div className="p-4 rounded-md bg-[#0F172A] border border-slate-800 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Scale className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Total Recovery Pipeline Value</span>
              </div>
              <div className="font-mono text-2xl font-bold text-emerald-400 mt-1 tabular-nums">
                {formatZar(pipelineStats.collectable)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                {pipelineStats.recoveryRatePct}% of {formatZarCompact(pipelineStats.totalLost)} gross loss ({pipelineStats.caseCount} files)
              </div>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/recovery')}
                aria-label="Open Recovery Desk"
                className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Pipeline Proportion Chart */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="truncate">Collectable vs Unsecured Gap</span>
              <span className="font-mono text-amber-300 tabular-nums whitespace-nowrap shrink-0">
                {formatZarCompact(pipelineStats.futileAvoided)} futile halted
              </span>
            </div>
            <svg
              viewBox="0 0 280 14"
              className="w-full h-3.5 rounded overflow-hidden"
              role="img"
              aria-label={`Recovery pipeline bar: ${pipelineStats.recoveryRatePct}% practically collectable`}
            >
              <rect x="0" y="0" width="280" height="14" fill="#1E293B" />
              <rect
                x="0"
                y="0"
                width={Math.max(0, (280 * collectableWidthPct) / 100)}
                height="14"
                fill="#10B981"
              />
            </svg>
          </div>

          {/* Case Route Distribution Bar Chart */}
          <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
            <div className="text-[11px] text-slate-400">
              Case Count by Triage Route
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {pipelineStats.routes.map((r) => (
                <div
                  key={r.id}
                  onMouseEnter={() => setHoveredSegment(`route-${r.id}`)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  className={`flex items-center justify-between text-[11px] rounded px-1.5 py-0.5 transition-colors ${
                    hoveredSegment === `route-${r.id}`
                      ? 'bg-slate-800/70'
                      : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-slate-300 truncate">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className="font-mono font-semibold text-white tabular-nums ml-1">
                    {r.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Pending Consent Actions + Horizontal Bar Breakdown */}
        <div className="p-4 rounded-md bg-[#0F172A] border border-slate-800 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Pending Consent Actions</span>
              </div>
              <div className="font-mono text-2xl font-bold text-white mt-1 tabular-nums">
                {consentStats.pendingDistinct}
                <span className="text-sm font-normal text-slate-400 ml-1.5">
                  / {consentStats.totalPolicies} policies
                </span>
              </div>
              <div className="text-[11px] text-red-400 mt-0.5 font-mono tabular-nums">
                {formatZar(consentStats.exposureAtGap)} exposure at gap
              </div>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/consent')}
                aria-label="Open Consent Integrity"
                className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Horizontal Bar Chart of Pending Consent Categories */}
          <div
            className="space-y-2"
            role="group" aria-label={`Pending consent breakdown across ${consentStats.pendingDistinct} flagged policies`}
          >
            {consentStats.categories.map((cat) => (
              <div key={cat.id} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">{cat.label}</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {cat.count} ({cat.pct}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded ${cat.barClass} transition-all duration-300`}
                    style={{
                      width: `${Math.max(cat.count > 0 ? 6 : 0, cat.pct)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3: Vault Integrity Score + Radial Gauge & Chain Link Strip */}
        <div
          className={`p-4 rounded-md bg-[#0F172A] border flex flex-col justify-between gap-4 ${
            vaultStats.valid ? 'border-slate-800' : 'border-red-600/60'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              {/* SVG Circular Integrity Gauge */}
              <svg
                width="76"
                height="76"
                viewBox="0 0 76 76"
                className="shrink-0"
                role="img"
                aria-label={`Vault Integrity Score ${vaultStats.integrityScore}%`}
              >
                <circle
                  cx="38"
                  cy="38"
                  r={gaugeRadius}
                  fill="none"
                  stroke="#1E293B"
                  strokeWidth="7"
                />
                <circle
                  cx="38"
                  cy="38"
                  r={gaugeRadius}
                  fill="none"
                  stroke={vaultStats.valid ? '#10B981' : '#EF4444'}
                  strokeWidth="7"
                  strokeDasharray={gaugeCircumference}
                  strokeDashoffset={gaugeOffset}
                  strokeLinecap="butt"
                  transform="rotate(-90 38 38)"
                />
                <text
                  x="38"
                  y="42"
                  textAnchor="middle"
                  className="fill-white font-mono text-[14px] font-bold"
                >
                  {vaultStats.integrityScore}%
                </text>
              </svg>

              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <FolderLock
                    className={`w-3.5 h-3.5 shrink-0 ${
                      vaultStats.valid ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  />
                  <span>Vault Integrity Score</span>
                </div>
                <div
                  className={`font-mono text-lg font-bold mt-1 ${
                    vaultStats.valid ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {vaultStats.valid ? 'CHAIN VALID' : 'TAMPER DETECTED'}
                </div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                  {vaultStats.intactLinks}/{vaultStats.totalLinks} SHA-256 links intact
                </div>
              </div>
            </div>

            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/vault')}
                aria-label="Open Evidence Vault"
                className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Hash-Chain Node Verification Strip */}
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Append-Only Custody Chain</span>
              <span className="font-mono text-slate-300 tabular-nums">
                {vaultStats.verifiedFacts} Facts · {vaultStats.allegations} Allegations
              </span>
            </div>
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${Math.max(vaultStats.links.length, 1)}, minmax(0, 1fr))`,
              }}
            >
              {vaultStats.links.map((link) => (
                <div
                  key={link.id}
                  title={`${link.id} · ${link.tag} · ${link.broken ? 'Hash mismatch' : 'Verified'}`}
                  className={`h-6 rounded flex items-center justify-center font-mono text-[10px] border ${
                    link.broken
                      ? 'bg-red-950/60 border-red-500/60 text-red-300'
                      : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {link.id.replace('EVD-', '#')}
                </div>
              ))}
            </div>
            {!vaultStats.valid && vaultStats.failedId && (
              <div className="text-[11px] text-red-300 font-mono">
                Break detected at {vaultStats.failedId} — fail-closed active
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Internal Audit Trail Notes (Attached to Exported POPIA PDF Reports) */}
      <div className="p-4 rounded-md bg-[#0F172A] border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <label
              htmlFor="kpi-audit-note-input"
              className="text-xs font-semibold text-white"
            >
              Internal Audit Trail Notes (Attached to Exported POPIA PDF)
            </label>
          </div>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {auditNotes.filter((n) => n.include_in_pdf).length} attached for PDF · POPIA s19 auto-redaction active
          </span>
        </div>

        <form onSubmit={handleSubmitNote} className="space-y-2.5">
          <textarea
            id="kpi-audit-note-input"
            aria-label="Internal audit note for exported PDF reports"
            rows={2}
            maxLength={MAX_KPI_AUDIT_NOTE_LENGTH}
            value={draftAuditNote}
            onChange={(e) => {
              setNoteError(null);
              onDraftAuditNoteChange?.(e.target.value);
            }}
            placeholder="Record a short governance observation (e.g. CFO verified R201.5k EFT clearance; holding SYN-009 pending parlour invoice check)..."
            className="w-full rounded-md bg-slate-900 border border-slate-700 focus:border-emerald-500 focus:outline-none px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 resize-y min-h-[60px]"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="font-mono tabular-nums">
                {draftAuditNote.length} / {MAX_KPI_AUDIT_NOTE_LENGTH} chars
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>
                SA IDs, emails &amp; phone numbers are automatically masked on save
              </span>
            </div>

            <button
              type="submit"
              disabled={noteBusy || !draftAuditNote.trim()}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap self-start sm:self-auto shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {noteBusy ? 'Attaching...' : 'Attach Timestamped Note'}
            </button>
          </div>

          {noteError && (
            <div role="alert" className="text-[11px] text-amber-300">
              {noteError}
            </div>
          )}
        </form>

        {auditNotes.length > 0 && (
          <ul
            aria-label="Attached timestamped KPI audit notes"
            className="divide-y divide-slate-800 border-t border-slate-800 pt-1"
          >
            {auditNotes.map((note) => (
              <li
                key={note.note_id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                    <span className="font-mono text-emerald-400 tabular-nums">
                      {note.created_at.replace('T', ' ').slice(0, 19)}Z
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-200 font-medium">
                      {note.author_name}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span>{ROLE_LABELS[note.author_role] ?? note.author_role}</span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-500">{note.note_id}</span>
                  </div>
                  <p className="text-slate-200 leading-relaxed break-words">
                    {note.content}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-start">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={note.include_in_pdf}
                      onChange={(e) =>
                        onToggleAuditNotePdf?.(note.note_id, e.target.checked)
                      }
                      className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    Include in PDF
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove audit note ${note.note_id}`}
                    onClick={() => onDeleteAuditNote?.(note.note_id)}
                    className="p-1 rounded text-slate-400 hover:text-red-300 hover:bg-slate-800 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
