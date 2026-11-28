import {useQueueView, QueueControls} from './QueueControls';
import React from 'react';
import { Clock, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { evaluateClaimTimers } from '../lib/engine/timers';
import { lintOutboundMessage } from '../lib/engine/lint';
import type { ClaimPreviewRecord, RoleId } from '../lib/engine/types';
import { apiFetch, formatZar } from '../utils/format';
import { ClaimsAgentSidebar } from './ClaimsAgentSidebar';

interface ClaimsPreviewViewProps {
  claims: ClaimPreviewRecord[];
  activeRole: RoleId;
  onRefresh: () => Promise<void>;
}

export const ClaimsPreviewView: React.FC<ClaimsPreviewViewProps> = ({
  claims,
  activeRole,
  onRefresh,
}) => {
  const claimQueue=useQueueView('claims',claims);
  React.useEffect(() => {
    // Command-bar handoff from the Today screen: seed the queue search once.
    try {
      const seeded = sessionStorage.getItem('nahashield-cmdq');
      if (seeded) {
        sessionStorage.removeItem('nahashield-cmdq');
        claimQueue.setConfig((c) => ({ ...c, query: seeded }));
      }
    } catch {
      /* storage may be unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const referenceNowIso = '2026-11-25T12:00:00Z';
  const [selectedClaimId, setSelectedClaimId] = React.useState(
    claims[0]?.claim_id ?? '',
  );
  const [noticeText, setNoticeText] = React.useState(
    'Your claim is under standard documentary review to verify death registration particulars. Expected investigation completion date: 15 December 2026.',
  );
  const [dispatchError, setDispatchError] = React.useState<string | null>(null);
  const [dispatchOk, setDispatchOk] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const lintResult = React.useMemo(
    () => lintOutboundMessage(noticeText),
    [noticeText],
  );

  const selectedClaim = React.useMemo(
    () => claims.find((c) => c.claim_id === selectedClaimId) ?? claims[0],
    [claims, selectedClaimId],
  );

  async function handleSendBasdeoNotice(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClaim) return;
    setDispatchError(null);
    setDispatchOk(null);
    setBusy(true);
    try {
      await apiFetch(
        `/api/claims/${selectedClaim.claim_id}/deferment-notice`,
        activeRole,
        {
          method: 'POST',
          body: JSON.stringify({ notice_text: noticeText }),
        },
      );
      setDispatchOk(
        `Sample neutral notice draft recorded for ${selectedClaim.claim_id}. 14-business-day SLA clock opened.`,
      );
      await onRefresh();
    } catch (err) {
      setDispatchError(
        err instanceof Error ? err.message : 'Failed to issue notice',
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
            Claims review queue
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Choose a claim to inspect its supporting documents, timing and simulated bank-check indicators.
          </p>
          <p className="text-xs text-slate-400 mt-1">Ranked by deadline, then rands.</p>
        </div>
        <span className="text-[13px] font-mono text-slate-400 shrink-0">
          SIMULATED ADAPTER (DHA / VerifyNow · AVS-R · XTND / Astute)
        </span>
      </div>

      <section aria-label="Claims portfolio metrics" className="claims-metrics grid sm:grid-cols-3 gap-4"><article><p className="context-label">Claims in review</p><p className="metric-value">{claims.length}</p><p className="text-sm text-slate-400">Sample queue · select a record below</p></article><article><p className="context-label">Selected exposure</p><p className="metric-value">{formatZar(selectedClaim?.claim_amount||0)}</p><p className="text-sm text-slate-400">Illustrative claim amount, not authorised</p></article><article><p className="context-label">Payments released</p><p className="metric-value">R 0</p><p className="text-sm text-slate-400">No live payment connector</p></article></section>
      <section className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-3" aria-label="Selected sample claim summary"><div className="flex flex-wrap gap-3 items-center justify-between"><h3 className="font-semibold">Case intelligence</h3><label className="text-sm">Claim<select aria-label="Choose sample claim" className="ml-2 bg-slate-800 rounded p-2" value={selectedClaimId} onChange={e=>setSelectedClaimId(e.target.value)}>{claims.map(c=><option key={c.claim_id}>{c.claim_id}</option>)}</select></label></div>{selectedClaim&&<><dl className="grid sm:grid-cols-3 gap-4 text-sm"><div><dt className="text-slate-400">Claim and policy</dt><dd className="font-semibold mt-1">{selectedClaim.claim_id} · {selectedClaim.policy_ref}</dd></div><div><dt className="text-slate-400">Claim state</dt><dd className="font-semibold mt-1">{selectedClaim.status}</dd></div><div><dt className="text-slate-400">Illustrative amount</dt><dd className="font-semibold mt-1">{formatZar(selectedClaim.claim_amount)}</dd></div><div><dt className="text-slate-400">Assigned human</dt><dd className="mt-1">Not assigned in this fixture</dd></div><div><dt className="text-slate-400">Timing reference</dt><dd className="mt-1">Fixed simulation at {referenceNowIso}. Not a live SLA.</dd></div><div><dt className="text-slate-400">Decision authority</dt><dd className="mt-1">Named human required. No payment connector.</dd></div></dl><p className="text-sm text-amber-200">All identity, bank and risk indicators below are sample. They do not prove fraud or establish payout eligibility.</p></>}</section>
      {/* Main Claims Workspace + Agent Interaction Sidebar */}
      <div className="grid grid-cols-1 min-[1600px]:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="space-y-6 min-w-0">
          {/* Claims Table */}
          <section className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto" data-testid="claims-table-container">
              <QueueControls label="Claims" queue={claimQueue}/>
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                    <th className="py-2.5 px-2.5 font-medium">Claim & Policy</th>
                    <th className="py-2.5 px-2.5 font-medium">PPR 2+14 Clock</th>
                    <th className="py-2.5 px-2.5 font-medium">Triangulation & Signals</th>
                    <th className="py-2.5 px-2.5 font-medium">AVS-R / Parlour (2A.10)</th>
                    <th className="py-2.5 px-2.5 font-medium text-right whitespace-nowrap">Amount</th>
                    <th className="py-2.5 px-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {claimQueue.rows.map((clm) => {
                    const timer = evaluateClaimTimers(clm, referenceNowIso);
                    const selected = selectedClaim?.claim_id === clm.claim_id;
                    return (
                      <tr
                        key={clm.claim_id}
                        onClick={() => setSelectedClaimId(clm.claim_id)}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-emerald-500/10' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-2.5 px-2.5 align-top max-w-[140px]">
                          <button
                            type="button"
                            onClick={() => setSelectedClaimId(clm.claim_id)}
                            className="font-mono font-semibold text-emerald-300 hover:underline whitespace-nowrap"
                          >
                            {clm.claim_id}
                          </button>
                          <div className="text-[13px] text-slate-300 leading-snug">
                            {clm.deceased_alias}
                          </div>
                          <div className="text-[13px] text-slate-500 font-mono">
                            {clm.policy_ref}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 align-top max-w-[165px]">
                          <div
                            className={`inline-flex items-start gap-1 font-mono font-medium leading-snug ${
                              timer.initial_breached || timer.dispute_breached
                                ? 'text-red-300'
                                : 'text-amber-300'
                            }`}
                          >
                            <Clock className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>{timer.clock_label}</span>
                          </div>
                          <div className="text-[13px] text-slate-400 font-mono mt-0.5 leading-snug">
                            2d: {timer.initial_deadline_iso}
                            {timer.dispute_deadline_iso
                              ? ` · 14d: ${timer.dispute_deadline_iso}`
                              : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 align-top max-w-[145px]">
                          <div className="flex flex-wrap gap-1 text-[13px]">
                            {clm.living_person_signal && (
                              <span className="px-1.5 py-0.5 rounded border border-red-500/50 bg-red-950/50 text-red-200 font-semibold whitespace-nowrap">
                                Living-Person
                              </span>
                            )}
                            {clm.bi1663_box24_word_of_mouth && (
                              <span className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-950/40 text-amber-200 whitespace-nowrap">
                                BI-1663 Box 2.4
                              </span>
                            )}
                            {clm.certifier_cluster_id && (
                              <span className="px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-950/40 text-sky-200 font-mono whitespace-nowrap">
                                {clm.certifier_cluster_id}
                              </span>
                            )}
                            {clm.agent_churn_flag && (
                              <span className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-950/40 text-amber-200 whitespace-nowrap">
                                AgentShield
                              </span>
                            )}
                            {!clm.living_person_signal &&
                              !clm.bi1663_box24_word_of_mouth &&
                              !clm.certifier_cluster_id &&
                              !clm.agent_churn_flag && (
                                <span className="text-slate-400">
                                  Reg lag: {clm.death_to_reg_days}d · Nominal
                                </span>
                              )}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 align-top max-w-[155px]">
                          <div
                            className={`font-mono text-[13px] font-semibold whitespace-nowrap ${
                              clm.avs_r_status === 'MATCHED'
                                ? 'text-emerald-400'
                                : clm.avs_r_status === 'MISMATCH'
                                  ? 'text-red-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            AVS-R: {clm.avs_r_status}
                          </div>
                          <div className="text-[13px] text-slate-400 mt-0.5 leading-snug">
                            {clm.parlour_name}{' '}
                            {clm.voluntary_parlour_elected
                              ? '· Vol 2A.10'
                              : '· Cash'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 align-top text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          {formatZar(clm.claim_amount)}
                        </td>
                        <td className="py-2.5 px-2.5 align-top text-slate-200 leading-snug max-w-[115px]">
                          {clm.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Basdeo-Compliant Neutral Deferment Notice Generator & Tipping-Off Linter */}
          <section className="rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Basdeo-Compliant Deferment Notice Generator (FIC s29(4)/s53 Lint-Guarded)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Active target: <span className="font-mono text-emerald-300">{selectedClaim?.claim_id}</span> · Blocks prohibited phrases (`STR`, `FIC`, `money laundering`, `murder suspect`, `police investigation`).
                </p>
              </div>
              <div
                className={`px-3 py-1 rounded border text-xs font-mono font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  lintResult.ok
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-red-500/60 bg-red-950/50 text-red-200'
                }`}
              >
                {lintResult.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5" />
                )}
                {lintResult.ok
                  ? 'Tipping-Off Linter: CLEAN'
                  : `BLOCKED: ${lintResult.violations.join(', ')}`}
              </div>
            </div>

            <form onSubmit={handleSendBasdeoNotice} className="space-y-3">
              <div>
                <label
                  htmlFor="basdeo-notice"
                  className="block text-xs text-slate-400 mb-1.5"
                >
                  Neutral Deferment Reason & Expected Completion Date (PPR Rule 2A.8.2)
                </label>
                <textarea
                  id="basdeo-notice"
                  rows={3}
                  value={noticeText}
                  onChange={(e) => setNoticeText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md p-3 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {!lintResult.ok && (
                <div
                  role="alert"
                  className="p-3 rounded bg-red-950/45 border border-red-600/60 text-xs text-red-200 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>
                    FIC Act s29(4) / s53 Tipping-Off Linter Violation: Remove banned term(s){' '}
                    <strong className="font-mono">{lintResult.violations.join(', ')}</strong>{' '}
                    before issuing claimant notice.
                  </span>
                </div>
              )}

              {dispatchError && (
                <div className="p-3 rounded bg-red-950/45 border border-red-600/60 text-xs text-red-200">
                  {dispatchError}
                </div>
              )}
              {dispatchOk && (
                <div className="p-3 rounded bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200">
                  {dispatchOk}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setNoticeText(
                      'Claim suspended due to suspicious transaction report (STR) filed with FIC for money laundering.',
                    )
                  }
                  className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Test Tipping-Off Violation
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Validate & Issue 14-Day Basdeo Notice
                </button>
              </div>
            </form>
          </section>
        </div>

        <div>
          <ClaimsAgentSidebar
            claim={selectedClaim}
            activeRole={activeRole}
            onCommittedChange={onRefresh}
          />
        </div>
      </div>
    </div>
  );
};
