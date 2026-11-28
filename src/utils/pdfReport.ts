import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { evaluateConsentPolicy } from '../lib/engine/consent';
import { evaluateLedgerEntry, summarizeLedger } from '../lib/engine/ledger';
import { evaluateRecoveryCase, summarizeRecoveryPortfolio } from '../lib/engine/triage';
import type {
  ConsentPolicyInput,
  EvidenceItemRecord,
  KpiAuditNoteRecord,
  LedgerEntryInput,
  RecoveryCaseInput,
  RoleId,
  VaultVerificationResult,
} from '../lib/engine/types';
import {
  filterIncludedAuditNotesForPdf,
  sanitizePopiaText,
} from '../lib/engine/popia';
import { formatZar, ROLE_LABELS } from './format';

export { sanitizePopiaText };

export interface PopiaPdfReportInput {
  reportId: string;
  generatedAt: string;
  orgName: string;
  actorDisplayName: string;
  actorRole: RoleId;
  activeFilterLabel: string;
  entries: LedgerEntryInput[];
  filteredEntries: LedgerEntryInput[];
  recoveryCases: RecoveryCaseInput[];
  consentPolicies: ConsentPolicyInput[];
  evidenceItems: EvidenceItemRecord[];
  vaultVerification: VaultVerificationResult;
  auditNotes?: KpiAuditNoteRecord[];
}

export function buildPopiaReportMetrics(input: PopiaPdfReportInput) {
  const recovery = summarizeRecoveryPortfolio(input.recoveryCases);
  const ledger = summarizeLedger(input.entries, recovery.total_lost);

  let s300Count = 0;
  let s297Count = 0;
  let writeOffCount = 0;
  let settlementCount = 0;

  for (const c of input.recoveryCases) {
    const t = evaluateRecoveryCase(c);
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

  let pendingConsent = 0;
  let missingConsent = 0;
  let channelIssue = 0;
  let contactIssue = 0;
  let duressCount = 0;
  let exposureAtGap = 0;

  for (const p of input.consentPolicies) {
    const ev = evaluateConsentPolicy(p);
    const hasContact =
      ev.contact_independence_status ===
      'Contact Independence Unverified — Escalate';
    const hasGap = ev.consent_gap_status === 'CONSENT GAP';
    const hasChannel = ev.consent_gap_status === 'CHANNEL NOT INDEPENDENT';
    if (hasGap) missingConsent += 1;
    if (hasChannel) channelIssue += 1;
    if (hasContact) contactIssue += 1;
    if (p.duress_alert) duressCount += 1;
    if (hasGap || hasChannel || hasContact || p.duress_alert) {
      pendingConsent += 1;
    }
    exposureAtGap += ev.exposure_at_gap;
  }

  const totalLinks = Math.max(
    input.vaultVerification.checked_count,
    input.evidenceItems.length,
  );
  const intactLinks = input.vaultVerification.valid
    ? totalLinks
    : Math.max(input.vaultVerification.failed_index ?? 0, 0);
  const vaultScorePct =
    totalLinks > 0 ? Math.round((intactLinks / totalLinks) * 100) : 100;

  const includedAuditNotes = filterIncludedAuditNotesForPdf(input.auditNotes);

  return {
    recovery,
    ledger,
    routes: { s300Count, settlementCount, s297Count, writeOffCount },
    consent: {
      totalPolicies: input.consentPolicies.length,
      pendingConsent,
      missingConsent,
      channelIssue,
      contactIssue,
      duressCount,
      exposureAtGap,
    },
    vault: {
      valid: input.vaultVerification.valid,
      vaultScorePct,
      intactLinks,
      totalLinks,
      failedId: input.vaultVerification.failed_evidence_id,
    },
    includedAuditNotes,
    auditNoteCount: includedAuditNotes.length,
  };
}

export function generateAndDownloadPopiaPdf(input: PopiaPdfReportInput): string {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const metrics = buildPopiaReportMetrics(input);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const datePart = input.generatedAt.slice(0, 10);
  const filename = `claimtrace-popia-ledger-report-${datePart}.pdf`;

  // Top Header Band
  doc.setFillColor(15, 23, 42); // #0F172A
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(16, 185, 129); // #10B981
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('ClaimTrace', margin, 11);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(
    'POPIA-Compliant Executive KPI & Dual-Signed Ledger Report',
    margin + 32,
    11,
  );

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    sanitizePopiaText(
      `Tenant: ${input.orgName}  |  Report ID: ${input.reportId}  |  Generated: ${input.generatedAt.replace('T', ' ').slice(0, 19)} UTC`,
    ),
    margin,
    18,
  );
  doc.text(
    sanitizePopiaText(
      `Prepared By: ${input.actorDisplayName} (${ROLE_LABELS[input.actorRole]})  |  Ledger Filter: ${input.activeFilterLabel}`,
    ),
    margin,
    22.5,
  );

  // POPIA Compliance & Data-Minimisation Classification Banner
  let cursorY = 31;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(margin, cursorY, contentWidth, 13, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(
    'CONFIDENTIAL — POPIA s19 SAFEGUARDS · DE-IDENTIFIED / SYNTHETIC DATA ONLY · SINGLE-TENANT ISOLATION',
    margin + 3,
    cursorY + 5,
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    'Data Minimisation (POPIA s10/s14): Only de-identified case/policy references are exported. All SA ID numbers, bank account numbers, and personal contact details are excluded/redacted. POPIA s71 human review enforced.',
    margin + 3,
    cursorY + 9.8,
  );

  cursorY += 18;

  // Section 1: Separated Financial & Anti-Puffery Summary
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    '1. Separated Executive Financials (Anti-Puffery Ledger Totals)',
    margin,
    cursorY,
  );
  cursorY += 3;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [
      [
        'Confirmed Fraudulent Loss',
        'Bank-Reconciled Cash (Net)',
        'Incremental Protected (Live)',
        'Futile Spend Avoided',
        'Judgment / Order (Not Cash)',
        'Repayment Plans (Not Cash)',
        'Backtest (Excluded)',
      ],
    ],
    body: [
      [
        formatZar(metrics.ledger.confirmed_fraudulent_loss),
        formatZar(metrics.ledger.bank_reconciled_cash_received),
        formatZar(metrics.ledger.incremental_protected_live),
        formatZar(metrics.ledger.futile_spend_avoided),
        formatZar(metrics.ledger.judgment_order_value),
        formatZar(metrics.ledger.agreed_repayment_plans),
        formatZar(metrics.ledger.would_have_protected_backtest),
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8.5,
      fontStyle: 'bold',
      textColor: [15, 23, 42],
    },
  });

   
  cursorY = (doc as any).lastAutoTable.finalY + 7;

  // Section 2: Real-Time KPI Summary (Cross-Module Engine Metrics)
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    '2. KPI Summary (Real-Time Cross-Module Engine Telemetry)',
    margin,
    cursorY,
  );
  cursorY += 3;

  const recoveryRate =
    metrics.recovery.total_lost > 0
      ? Math.round(
          (metrics.recovery.total_collectable / metrics.recovery.total_lost) *
            100,
        )
      : 0;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [
      ['KPI Metric', 'Current Value', 'Breakdown & Regulatory Context'],
    ],
    body: [
      [
        'Total Recovery Pipeline Value',
        `${formatZar(metrics.recovery.total_collectable)} (${recoveryRate}% of ${formatZar(metrics.recovery.total_lost)})`,
        `Across ${metrics.recovery.case_count} loss files: Civil/CPA s300 (${metrics.routes.s300Count}), Structured Settlement (${metrics.routes.settlementCount}), CPA s297 (${metrics.routes.s297Count}), Early Write-Off (${metrics.routes.writeOffCount}). Futile legal spend halted: ${formatZar(metrics.recovery.total_futile_spend_avoided)}.`,
      ],
      [
        'Pending Consent Actions',
        `${metrics.consent.pendingConsent} / ${metrics.consent.totalPolicies} policies (${formatZar(metrics.consent.exposureAtGap)} exposure)`,
        `Missing Consent: ${metrics.consent.missingConsent} | Channel Not Independent: ${metrics.consent.channelIssue} | Unverified Contact: ${metrics.consent.contactIssue} | Silent Duress Alerts: ${metrics.consent.duressCount}.`,
      ],
      [
        'Vault Integrity Score',
        `${metrics.vault.vaultScorePct}% (${metrics.vault.valid ? 'CHAIN VERIFIED' : 'TAMPER DETECTED'})`,
        `${metrics.vault.intactLinks}/${metrics.vault.totalLinks} SHA-256 append-only custody links intact.${metrics.vault.failedId ? ` Break detected at ${metrics.vault.failedId} (fail-closed active).` : ' Zero tampering detected.'}`,
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontSize: 7.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [15, 23, 42],
    },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 68, fontStyle: 'bold' },
    },
  });

   
  cursorY = (doc as any).lastAutoTable.finalY + 7;

  // Section 3: Internal Audit Trail — Timestamped KPI Governance Notes
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    `3. Internal Audit Trail — Timestamped KPI Governance Notes (${metrics.includedAuditNotes.length})`,
    margin,
    cursorY,
  );
  cursorY += 3;

  const noteRows =
    metrics.includedAuditNotes.length > 0
      ? metrics.includedAuditNotes.map((n) => [
          `${n.created_at.replace('T', ' ').slice(0, 19)} UTC\n${n.note_id}`,
          sanitizePopiaText(
            `${n.author_name}\n${ROLE_LABELS[n.author_role] ?? n.author_role}`,
          ),
          sanitizePopiaText(n.content),
        ])
      : [
          [
            '—',
            'System Audit Check',
            'No timestamped KPI governance notes attached to this export.',
          ],
        ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [['Timestamp (UTC) / Note ID', 'Author & RBAC Role', 'De-Identified Internal Audit Note']],
    body: noteRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [15, 23, 42],
      valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 52 },
    },
  });

   
  cursorY = (doc as any).lastAutoTable.finalY + 7;

  // Section 4: Dual-Signed Savings & Recovery Ledger Table
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    `4. Dual-Signed Savings & Recovery Ledger (${input.filteredEntries.length} rows — Filter: ${input.activeFilterLabel})`,
    margin,
    cursorY,
  );
  cursorY += 3;

  const ledgerRows = input.filteredEntries.map((entry) => {
    const evalOut = evaluateLedgerEntry(entry);
    const counted =
      evalOut.live_protected +
      evalOut.net_cash_recovered +
      evalOut.futile_spend_avoided;
    return [
      `${entry.entry_id}\n${entry.case_ref}`,
      sanitizePopiaText(`${entry.event_type}\n${entry.description}`),
      `${entry.basis}\n${entry.event_date}`,
      formatZar(entry.amount_at_stake),
      formatZar(counted),
      evalOut.language_label,
      entry.forensics_signoff ? 'Signed' : 'Pending',
      entry.finance_signoff ? 'Signed' : 'Pending',
    ];
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 18 },
    head: [
      [
        'Entry / Ref',
        'Event & De-Identified Description',
        'Basis / Date',
        'At Stake (ZAR)',
        'Counted (ZAR)',
        'Language Lock',
        'Forensics',
        'Finance CFO',
      ],
    ],
    body: ledgerRows,
    theme: 'striped',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [15, 23, 42],
      valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 96 },
      2: { cellWidth: 24 },
      3: { cellWidth: 26, halign: 'right' },
      4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 32 },
      6: { cellWidth: 20, halign: 'center' },
      7: { cellWidth: 20, halign: 'center' },
    },
  });

  // Multi-page POPIA Governance Footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `ClaimTrace · POPIA s19/s71 Audit Export · Report ${input.reportId} · Only bank-reconciled cash & dual-signed incremental saves count toward Rand totals`,
      margin,
      pageHeight - 7,
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 7,
      { align: 'right' },
    );
  }

  // Trigger clean iframe-safe Blob download (no window.open)
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}
