// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = the decision being asked (right panel action block).
// SECONDARY = the evidence that supports it (centre). TERTIARY = the queue (left).
// One primary action: "Record reasoned decision". Decision buttons stay disabled
// until the five-step inspection sequence is complete (replaces the old 10-second
// countdown gate per the 28 Nov alignment review). Tokens: project scale only,
// two weights, three text colours; mobile stacks queue -> evidence -> decision.
import React from 'react';
import type { ClaimPreviewRecord, RoleId } from '../lib/engine/types';
import { evaluateClaimTimers } from '../lib/engine/timers';
import { apiFetch, formatZar, ROLE_LABELS } from '../utils/format';

const REFERENCE_NOW_ISO = '2026-11-25T12:00:00Z';
const DECIDING_ROLES: RoleId[] = ['head_of_forensics', 'legal_recoveries', 'underwriter'];

interface ReasonInfo {
  label: string;
  why: string;
  innocent: string;
  recommendation: string;
}

function reasonInfo(claim: ClaimPreviewRecord): ReasonInfo {
  if (claim.avs_r_status === 'MISMATCH')
    return {
      label: 'AVS-R mismatch',
      why: 'Bank account verification returned a mismatch for the beneficiary reference.',
      innocent: 'A recently changed bank account or a spelling variant can produce the same mismatch.',
      recommendation: 'Request a bank confirmation letter before any payout step.',
    };
  if (claim.agent_churn_flag)
    return {
      label: 'agent churn check',
      why: 'The writing agent shows an unusual movement pattern across this sample book.',
      innocent: 'Legitimate agents change employers; a single flag is not evidence of wrongdoing.',
      recommendation: 'Verify the agent mandate and policy servicing history.',
    };
  if (claim.living_person_signal)
    return {
      label: 'living-person signal',
      why: 'A sample signal suggests the insured person may still be alive.',
      innocent: 'Signals can be stale or matched to the wrong identity record.',
      recommendation: 'Corroborate death independently before any decision.',
    };
  if (claim.dha_office_outlier)
    return {
      label: 'DHA office outlier',
      why: 'The registering Home Affairs office is an outlier for this sample cluster.',
      innocent: 'Rural registration patterns can legitimately cluster by office.',
      recommendation: 'Confirm the registration record with the issuing office.',
    };
  return {
    label: 'review lead',
    why: 'A deterministic sample rule flagged this claim for human review.',
    innocent: 'Review leads are leads, not findings; many close as innocent.',
    recommendation: 'Work the evidence checklist, then record a reasoned decision.',
  };
}

const INSPECTION_STEPS = [
  'Open the original evidence for this claim',
  'Inspect the relevant findings',
  'Read the alternative innocent explanation',
  'Understand the proposed action and its consequences',
  'Confirm the decision and its reason are ready to record',
];

function priorityOf(claim: ClaimPreviewRecord): { label: string; tone: string } {
  const timer = evaluateClaimTimers(claim, REFERENCE_NOW_ISO);
  const remaining = timer.dispute_business_days_remaining ?? timer.initial_business_days_remaining ?? 99;
  if (remaining <= 0) return { label: 'Overdue', tone: 'bg-red-950 text-red-300 border-red-700' };
  if (remaining <= 2) return { label: 'Urgent', tone: 'bg-amber-950 text-amber-300 border-amber-700' };
  return { label: 'Normal', tone: 'bg-slate-800 text-slate-300 border-slate-600' };
}

export const NeedsOkView: React.FC<{ claims: ClaimPreviewRecord[]; activeRole: RoleId; onChanged?: () => void }> = ({ claims, activeRole, onChanged }) => {
  const queue = React.useMemo(
    () =>
      [...claims].sort((a, b) => {
        const ta = evaluateClaimTimers(a, REFERENCE_NOW_ISO);
        const tb = evaluateClaimTimers(b, REFERENCE_NOW_ISO);
        const ra = ta.dispute_business_days_remaining ?? ta.initial_business_days_remaining ?? 99;
        const rb = tb.dispute_business_days_remaining ?? tb.initial_business_days_remaining ?? 99;
        if (ra !== rb) return ra - rb;
        return b.claim_amount - a.claim_amount;
      }),
    [claims],
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(queue[0]?.claim_id ?? null);
  const selected = queue.find((c) => c.claim_id === selectedId) ?? queue[0];
  const [checked, setChecked] = React.useState<boolean[]>(INSPECTION_STEPS.map(() => false));
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [receipt, setReceipt] = React.useState('');

  React.useEffect(() => {
    setChecked(INSPECTION_STEPS.map(() => false));
    setReason('');
    setReceipt('');
    setMessage('');
  }, [selectedId]);

  if (!selected) {
    return (
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Needs Your OK</p>
        <h1 className="text-2xl font-semibold text-slate-100 mt-2">Nothing waiting</h1>
        <p className="text-sm text-slate-300 mt-2">No sample claims are waiting for a human decision in this workspace.</p>
      </section>
    );
  }

  const info = reasonInfo(selected);
  const allChecked = checked.every(Boolean);
  const canDecide = allChecked && reason.trim().length >= 10 && !busy;
  const timer = evaluateClaimTimers(selected, REFERENCE_NOW_ISO);
  const ageDays = Math.max(0, Math.round((Date.parse(REFERENCE_NOW_ISO) - Date.parse(selected.submitted_at)) / 86400000));

  const decide = async (action: string) => {
    setBusy(true);
    setMessage('');
    try {
      const j = await apiFetch<{ ok: boolean; decision: { decision_id?: string } }>('/api/decisions', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          target_type: 'claim_review',
          target_ref: selected.claim_id,
          selected_action: action,
          objective_reasons: [info.label, ...INSPECTION_STEPS.filter((_, i) => checked[i])],
          counsel_note: reason.trim(),
        }),
      });
      setReceipt(`Decision recorded in this sample workspace${j.decision?.decision_id ? ` · receipt ${j.decision.decision_id}` : ''}. Never a claim approval or payout.`);
      onChanged?.();
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Needs Your OK" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-slate-100">Needs Your OK</h1>
        <span className="inline-block rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">SAMPLE</span>
        <span className="text-sm text-slate-400">{queue.length} waiting · ranked by deadline, then rands</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: review queue */}
        <div className="space-y-2" aria-label="Review queue">
          {queue.map((c) => {
            const p = priorityOf(c);
            const active = c.claim_id === selected.claim_id;
            return (
              <button
                key={c.claim_id}
                type="button"
                onClick={() => setSelectedId(c.claim_id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  active ? 'border-emerald-600 border-2 bg-slate-800' : 'border-slate-700 bg-slate-900 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100 text-sm">{c.claim_id}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${p.tone}`}>{p.label}</span>
                </div>
                <p className="text-[13px] text-slate-400 mt-1">
                  {reasonInfo(c).label} · {formatZar(c.claim_amount)} · {ageDays}d old
                </p>
                <p className="text-[13px] text-slate-400">Reviewer: sample · Awaiting human decision</p>
              </button>
            );
          })}
        </div>

        {/* Centre: evidence */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4" aria-label="Evidence">
          <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Evidence</p>
          <div>
            <p className="text-sm font-semibold text-slate-100">What happened</p>
            <p className="text-sm text-slate-300 mt-1">Funeral claim {selected.claim_id} ({selected.parlour_name}) was flagged: {info.label}.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Why flagged</p>
            <p className="text-sm text-slate-300 mt-1">{info.why}</p>
            <ul className="mt-2 space-y-1 text-[13px] text-slate-400">
              <li>BI-1663 box 24 word of mouth: {selected.bi1663_box24_word_of_mouth ? 'yes' : 'no'}</li>
              <li>Living-person signal: {selected.living_person_signal ? 'yes' : 'no'}</li>
              <li>AVS-R: {selected.avs_r_status}</li>
              <li>DHA office outlier: {selected.dha_office_outlier ? 'yes' : 'no'}</li>
              <li>Agent churn flag: {selected.agent_churn_flag ? 'yes' : 'no'}</li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Financial exposure</p>
            <p className="text-xl font-semibold text-slate-100 mt-1">{formatZar(selected.claim_amount)}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Timeline</p>
            <p className="text-[13px] text-slate-400 mt-1">
              Submitted {new Date(selected.submitted_at).toLocaleDateString()} · death to registration {selected.death_to_reg_days}d · inception to death {selected.inception_to_death_days}d
              {timer.dispute_business_days_remaining != null && ` · ${timer.dispute_business_days_remaining} business days left on dispute clock`}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Source support</p>
            <p className="text-[13px] text-slate-400 mt-1">Sample claim record {selected.claim_id} · policy ref {selected.policy_ref}. Original documents live in Evidence; a lead is not proof.</p>
          </div>
        </div>

        {/* Right: decision panel */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4" aria-label="Decision panel">
          <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Decision</p>
          <div>
            <p className="text-sm font-semibold text-slate-100">Recommended next action</p>
            <p className="text-sm text-slate-300 mt-1">{info.recommendation}</p>
          </div>
          <div className="rounded-lg bg-slate-800 p-3">
            <p className="text-sm font-semibold text-slate-100">What could explain it innocently</p>
            <p className="text-sm text-slate-300 mt-1">{info.innocent}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Inspection sequence <span className="text-slate-400 font-normal">(replaces a timed wait)</span></p>
            <div className="mt-2 space-y-2">
              {INSPECTION_STEPS.map((step, i) => (
                <label key={step} className="flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked[i]}
                    onChange={(e) => setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                  />
                  {i + 1}. {step}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-slate-100">Reasoned decision (required)</span>
            <textarea
              aria-label="Reasoned decision"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 p-2 text-sm text-slate-100"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this decision, in your own words (min 10 characters)"
            />
          </label>
          <p className="text-[13px] text-slate-400">
            Who can decide: {DECIDING_ROLES.map((r) => ROLE_LABELS[r] ?? r).join(', ')}. Current sample view: {ROLE_LABELS[activeRole] ?? activeRole}. Consequential actions need two-person approval; the AI never repudiates, pays, freezes or litigates on its own.
          </p>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              disabled={!canDecide}
              onClick={() => void decide('cleared_innocent')}
              className="rounded-md bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-40"
            >
              Record: cleared as innocent
            </button>
            <button
              type="button"
              disabled={!canDecide}
              onClick={() => void decide('keep_investigating')}
              className="rounded-md border border-slate-500 px-4 py-3 font-semibold text-slate-100 disabled:opacity-40"
            >
              Record: keep investigating
            </button>
            <button
              type="button"
              disabled={!canDecide}
              onClick={() => void decide('escalate_second_approval')}
              className="rounded-md border border-amber-600 px-4 py-3 font-semibold text-amber-300 disabled:opacity-40"
            >
              Escalate for second approval
            </button>
          </div>
          {message && <p role="alert" className="text-sm text-amber-200">{message}</p>}
          {receipt && <p role="status" className="text-sm text-emerald-300">{receipt}</p>}
        </div>
      </div>
    </section>
  );
};
