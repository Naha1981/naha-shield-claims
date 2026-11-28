import {useQueueView, QueueControls} from './QueueControls';
import React from 'react';
import { CheckCircle2, RotateCcw, ShieldAlert, ShieldCheck, Plus } from 'lucide-react';
import type {
  EvidenceItemRecord,
  EvidenceTag,
  RoleId,
  VaultVerificationResult,
} from '../lib/engine/types';
import { apiFetch, shortHash } from '../utils/format';
import { EvidenceIngestion } from './EvidenceIngestion';

interface EvidenceVaultViewProps {
  items: EvidenceItemRecord[];
  verification: VaultVerificationResult;
  tamperSimulated: boolean;
  activeRole: RoleId;
  onRefresh: () => Promise<void>;
}

const EVIDENCE_TAGS: EvidenceTag[] = [
  'Verified Fact',
  'Documented Allegation',
  'Inference',
  'Hypothesis',
  'Unknown',
];

export const EvidenceVaultView: React.FC<EvidenceVaultViewProps> = ({
  items,
  verification,
  tamperSimulated,
  activeRole,
  onRefresh,
}) => {
  const [caseFilter, setCaseFilter] = React.useState('ALL');
  const [caseRef, setCaseRef] = React.useState('SYN-RC-004');
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [evidenceTag, setEvidenceTag] = React.useState<EvidenceTag | ''>('');
  const [sourceAdapter, setSourceAdapter] = React.useState(
    'Manual Investigator Upload',
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const uniqueCases = React.useMemo(() => {
    const s = new Set(items.map((i) => i.case_ref));
    return ['ALL', ...Array.from(s)];
  }, [items]);

  const visibleItems = React.useMemo(() => {
    const filtered =
      caseFilter === 'ALL'
        ? items
        : items.filter((i) => i.case_ref === caseFilter);
    return [...filtered].reverse();
  }, [items, caseFilter]);

  const evidenceQueue=useQueueView('vault',visibleItems,{filters:{caseFilter},onRestore:f=>setCaseFilter(f.caseFilter||'ALL')});
  async function handleRunVerify() {
    setBusy(true);
    try {
      await apiFetch('/api/vault/verify', activeRole, { method: 'POST' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateTamper() {
    setBusy(true);
    try {
      await apiFetch('/api/vault/simulate-tamper', activeRole, {
        method: 'POST',
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    setBusy(true);
    try {
      await apiFetch('/api/vault/restore', activeRole, { method: 'POST' });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAppendEvidence(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!evidenceTag) {
      setFormError(
        'Mandatory Evidence Tag is required (Verified Fact | Documented Allegation | Inference | Hypothesis | Unknown).',
      );
      return;
    }
    if (!title.trim() || !summary.trim()) {
      setFormError('Title and evidentiary summary are required.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/vault/evidence', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          case_ref: caseRef,
          title,
          content_summary: summary,
          evidence_tag: evidenceTag,
          source_adapter: sourceAdapter,
        }),
      });
      setTitle('');
      setSummary('');
      setEvidenceTag('');
      await onRefresh();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to append evidence',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white tracking-tight">
            Evidence records & chain of custody
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            SHA-256 checks detect changes to stored content or links. This sample local store is not an independently immutable evidence system.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={handleRunVerify}
            className="px-3.5 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Run Tamper Check
          </button>
          {!tamperSimulated ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleSimulateTamper}
              className="px-3.5 py-2 text-xs font-semibold rounded-md border border-red-600/60 bg-red-950/40 text-red-200 hover:bg-red-900/50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Simulate Tamper Attack
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={handleRestore}
              className="px-3.5 py-2 text-xs font-semibold rounded-md border border-amber-500/60 bg-amber-950/50 text-amber-200 hover:bg-amber-900/50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Valid Chain
            </button>
          )}
        </div>
      </div>

      {/* Live Hash Chain Verification Status Banner */}
      <div
        role="status"
        className={`p-4 rounded-md border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          verification.valid
            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
            : 'bg-red-950/50 border-red-500/60 text-red-200'
        }`}
      >
        <div className="flex items-start gap-3">
          {verification.valid ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="text-sm font-semibold">
              {verification.valid
                ? `HASH CHAIN VALID — ${verification.checked_count} of ${items.length} records sealed`
                : `TAMPER DETECTED (FAILED CLOSED) — ${verification.failed_evidence_id}`}
            </div>
            <div className="text-xs opacity-90 mt-0.5">
              {verification.valid
                ? 'Every content_hash and prev_chain_hash link matches cryptographic SHA-256 chain.'
                : verification.reason}
            </div>
          </div>
        </div>
        <div className="font-mono text-xs shrink-0">
          Status: {verification.valid ? 'INTEGRITY CHECK PASSED · not legal admissibility' : 'QUARANTINED'}
        </div>
      </div>

      {/* Secure Document & Camera Capture Ingestion */}
      <EvidenceIngestion
        activeRole={activeRole}
        tamperSimulated={tamperSimulated}
        defaultCaseRef={caseRef}
        onIngested={onRefresh}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Append Form */}
        <form
          onSubmit={handleAppendEvidence}
          className="lg:col-span-4 rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-display text-base font-semibold text-white">
              Seal New Evidence Item
            </h2>
            <Plus className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="ev-case" className="block text-slate-400 mb-1">
                Case / Policy Reference
              </label>
              <input
                id="ev-case"
                value={caseRef}
                onChange={(e) => setCaseRef(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono"
              />
            </div>

            <div>
              <label htmlFor="ev-tag" className="block text-slate-400 mb-1">
                Mandatory Evidence Tag (NOT NULL)
              </label>
              <select
                id="ev-tag"
                value={evidenceTag}
                onChange={(e) =>
                  setEvidenceTag(e.target.value as EvidenceTag | '')
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
              >
                <option value="">-- Select Evidence Strength --</option>
                {EVIDENCE_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ev-title" className="block text-slate-400 mb-1">
                Document / Signal Title
              </label>
              <input
                id="ev-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Sheriff Return of Service / WinDeed Extract"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder:text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="ev-source" className="block text-slate-400 mb-1">
                Source / Adapter Provenance
              </label>
              <input
                id="ev-source"
                value={sourceAdapter}
                onChange={(e) => setSourceAdapter(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
              />
            </div>

            <div>
              <label htmlFor="ev-summary" className="block text-slate-400 mb-1">
                Evidentiary Payload Summary
              </label>
              <textarea
                id="ev-summary"
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Objective facts, hash metadata, or documented allegation..."
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          {formError && (
            <div className="p-2.5 rounded bg-red-950/40 border border-red-700/50 text-xs text-red-200">
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || tamperSimulated}
            className="w-full py-2 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            Append & Compute SHA-256 Chain
          </button>
        </form>

        {/* Right: Chronological Chain Timeline */}
        <div className="lg:col-span-8 rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-white">
              Sealed Custody Ledger ({visibleItems.length})
            </h2>
            <div className="flex items-center gap-2">
              <label htmlFor="vault-filter" className="text-xs text-slate-400">
                Case Filter
              </label>
              <select
                id="vault-filter"
                value={caseFilter}
                onChange={(e) => setCaseFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-white font-mono"
              >
                {uniqueCases.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <QueueControls label="Evidence" queue={evidenceQueue}/><div className="divide-y divide-slate-800/80">
            {evidenceQueue.rows.map((item) => {
              const isFailedRow =
                !verification.valid &&
                verification.failed_evidence_id === item.evidence_id;

              const tagStyle =
                item.evidence_tag === 'Verified Fact'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                  : item.evidence_tag === 'Documented Allegation'
                    ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                    : item.evidence_tag === 'Inference'
                      ? 'border-sky-500/40 bg-sky-950/40 text-sky-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300';

              return (
                <div
                  key={item.evidence_id}
                  className={`p-4 space-y-2 ${
                    isFailedRow ? 'bg-red-950/35' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-white">
                        {item.evidence_id}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="font-mono text-emerald-300">
                        {item.case_ref}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[13px] font-medium ${tagStyle}`}
                      >
                        {item.evidence_tag}
                      </span>
                    </div>
                    <span className="font-mono text-[13px] text-slate-400">
                      {item.created_at.replace('T', ' ').slice(0, 19)}Z
                    </span>
                  </div>

                  <div className="text-sm font-semibold text-slate-100">
                    {item.title}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {item.content_summary}
                  </p>

                  {isFailedRow && (
                    <div className="text-xs font-semibold text-red-300">
                      TAMPER ALERT: {verification.reason}
                    </div>
                  )}

                  <details className="rounded bg-slate-900 p-3 text-sm">
                    <summary className="cursor-pointer">Original provenance and custody history</summary>
                    <dl className="mt-3 space-y-2"><div><dt className="font-semibold">Uploaded by</dt><dd>{item.uploader_id} at {item.created_at}</dd></div><div><dt className="font-semibold">Access authority recorded</dt><dd>{item.access_authority || 'Not recorded. Human verification required.'}</dd></div><div><dt className="font-semibold">Original file SHA-256</dt><dd className="break-all">{item.attachment_meta?.binary_sha256 || 'No original file attached. Content-summary hash is not a file hash.'}</dd></div><div><dt className="font-semibold">Content-summary SHA-256</dt><dd className="break-all">{item.sha256_content}</dd></div><div><dt className="font-semibold">Chain SHA-256</dt><dd className="break-all">{item.chain_hash}</dd></div></dl>
                    <h3 className="font-semibold mt-4">Recorded custody events</h3><ol className="list-decimal pl-5 mt-2 space-y-2">{item.custody_log.map((event,index)=><li key={index}>{event.action} by {event.actor} at {event.ts}</li>)}</ol><p className="mt-3">Current chain check: {verification.valid?'stored chain valid':'chain check failed'}. This is not external source verification. Individual read-access history is not complete in this sample. Review source originals before relying on the evidence tag.</p>
                  </details>
                  <div className="pt-1 flex flex-wrap gap-x-6 gap-y-1 text-[13px] font-mono text-slate-400">
                    <span>Source: {item.source_adapter}</span>
                    {item.attachment_meta && (
                      <span>
                        File: {item.attachment_meta.filename} (
                        {shortHash(item.attachment_meta.binary_sha256)})
                      </span>
                    )}
                    <span>Content SHA-256: {shortHash(item.sha256_content)}</span>
                    <span>Prev: {shortHash(item.prev_chain_hash)}</span>
                    <span className="text-slate-200">
                      Chain: {shortHash(item.chain_hash)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
