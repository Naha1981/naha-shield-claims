import React from 'react';
import type {
  ClaimPreviewRecord,
  VaultVerificationResult,
} from '../lib/engine/types';
import { evaluateClaimTimers } from '../lib/engine/timers';
import { formatZar, formatZarCompact } from '../utils/format';

interface TodayHeroProps {
  exposure: number;
  protectedLive: number;
  savedAvoided: number;
  recoveredCash: number;
  caseCount: number;
  claims: ClaimPreviewRecord[];
  awaitingSignoffCount: number;
  vaultVerification: VaultVerificationResult;
  evidenceCount: number;
  onNavigate?: (route: '/claims') => void;
  onOpenApprovals?: () => void;
}

const REFERENCE_NOW_ISO = '2026-11-25T12:00:00Z';

function claimReason(claim: ClaimPreviewRecord): string {
  if (claim.avs_r_status === 'MISMATCH') return 'AVS-R mismatch';
  if (claim.agent_churn_flag) return 'agent churn check';
  if (claim.living_person_signal) return 'living-person signal';
  if (claim.dha_office_outlier) return 'DHA office outlier';
  return 'review lead';
}

export const TodayHero: React.FC<TodayHeroProps> = ({
  exposure,
  protectedLive,
  savedAvoided,
  recoveredCash,
  caseCount,
  claims,
  awaitingSignoffCount,
  vaultVerification,
  evidenceCount,
  onNavigate,
  onOpenApprovals,
}) => {
  const [command, setCommand] = React.useState('');

  const needsYou = React.useMemo(() => {
    return claims
      .map((claim) => {
        const timer = evaluateClaimTimers(claim, REFERENCE_NOW_ISO);
        const remaining =
          timer.dispute_business_days_remaining ??
          timer.initial_business_days_remaining;
        return { claim, remaining };
      })
      .sort((a, b) => {
        if (a.remaining !== b.remaining) return a.remaining - b.remaining;
        return b.claim.claim_amount - a.claim.claim_amount;
      })
      .slice(0, 3);
  }, [claims]);

  const recoveredPct =
    exposure > 0 ? Math.min(100, Math.round((recoveredCash / exposure) * 100)) : 0;

  const todayLabel = new Date().toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  });

  function handleCommandSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem('nahashield-cmdq', command.trim());
    } catch {
      /* storage may be unavailable */
    }
    onNavigate?.('/claims');
  }

  return (
    <section aria-label="Today" className="today-hero">
      <div className="today-hero-top">
        <div>
          <h2 className="today-title">Today</h2>
          <p className="today-sub">Claims manager view · {todayLabel}</p>
        </div>
        <span className="today-rule-pill">Confirmed amounts only</span>
      </div>

      <div className="today-kpis">
        <div className="today-kpi">
          <div className="today-kpi-lbl" data-tone="blue">
            <i aria-hidden="true" />
            Protected
          </div>
          <div className="today-kpi-num" data-tone="blue">
            {formatZar(protectedLive)}
          </div>
          <div className="today-kpi-one">held while people check them</div>
        </div>
        <div className="today-kpi">
          <div className="today-kpi-lbl" data-tone="green">
            <i aria-hidden="true" />
            Saved
          </div>
          <div className="today-kpi-num" data-tone="green">
            {formatZar(savedAvoided)}
          </div>
          <div className="today-kpi-one">spend stopped before it happened</div>
        </div>
        <div className="today-kpi">
          <div className="today-kpi-lbl" data-tone="purple">
            <i aria-hidden="true" />
            Recovered
          </div>
          <div className="today-kpi-num" data-tone="purple">
            {formatZar(recoveredCash)}
          </div>
          <div className="today-kpi-one">cash reconciled, dual-signed</div>
          <div className="today-kpi-bar">
            <i style={{ width: `${Math.max(recoveredPct, 4)}%` }} />
          </div>
        </div>
      </div>

      <p className="today-foot">
        Exposure {formatZar(exposure)} across {caseCount} cases ·{' '}
        <a href="#savings-detail">How are these calculated?</a>
      </p>

      <div className="today-plain">
        <h3>In plain words</h3>
        <p>
          {caseCount} loss cases worth {formatZarCompact(exposure)} are being
          worked. {formatZar(recoveredCash)} is already back, signed off by two
          people. {formatZar(protectedLive)} more is protected while people
          check it.
        </p>
      </div>

      {needsYou.length > 0 && (
        <>
          <h3 className="today-sec">Needs you</h3>
          <p className="today-secsub">Ranked by deadline, then rands</p>
          <div className="today-list">
            {needsYou.map(({ claim, remaining }) => (
              <div className="today-item" key={claim.claim_id}>
                <div className="today-item-main">
                  <div className="today-item-t">
                    Funeral claim · {claimReason(claim)}
                  </div>
                  <div className="today-item-s">
                    {claim.claim_id} · {claim.parlour_name}
                  </div>
                  <span
                    className={`today-chip ${
                      remaining <= 2 ? 'red' : 'amber'
                    }`}
                  >
                    {remaining} business day{remaining === 1 ? '' : 's'} left
                  </span>
                </div>
                <div className="today-item-side">
                  <div className="today-item-amt">
                    {formatZar(claim.claim_amount)}
                  </div>
                  <button
                    type="button"
                    className="today-btn"
                    onClick={() => {
                      try {
                        sessionStorage.setItem(
                          'nahashield-cmdq',
                          claim.claim_id,
                        );
                      } catch {
                        /* storage may be unavailable */
                      }
                      onNavigate?.('/claims');
                    }}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="today-ok">
        <div className="today-ok-label">Needs your OK</div>
        <div className="today-ok-n">{awaitingSignoffCount}</div>
        <p>
          {awaitingSignoffCount === 0
            ? 'Nothing is waiting for a signature.'
            : `${awaitingSignoffCount} ledger ${
                awaitingSignoffCount === 1 ? 'entry is' : 'entries are'
              } waiting for dual sign-off.`}
        </p>
        {awaitingSignoffCount > 0 && onOpenApprovals && (
          <button type="button" className="today-btn" onClick={onOpenApprovals}>
            Open the tray
          </button>
        )}
      </div>

      <div className="today-vault" aria-label="Evidence Vault status">
        <div className="today-vault-ring" aria-hidden="true" />
        <div>
          <div className="today-vault-t">
            Evidence Vault · {vaultVerification.valid ? 'CHAIN VALID' : 'CHECK NEEDED'}
          </div>
          <div className="today-vault-s">
            {vaultVerification.checked_count}/
            {vaultVerification.checked_count} SHA-256 links intact ·{' '}
            {evidenceCount} evidence items
          </div>
        </div>
      </div>

      <form className="today-cmd" onSubmit={handleCommandSubmit}>
        <input
          aria-label="Ask Shield anything"
          placeholder="Ask Shield anything…"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          maxLength={200}
        />
      </form>
    </section>
  );
};
