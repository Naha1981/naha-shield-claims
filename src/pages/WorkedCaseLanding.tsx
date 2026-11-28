import { useEffect, useState } from 'react';
import { WorkedCaseSelector } from '../components/worked-cases/WorkedCaseSelector';
import { ExecutiveValueBoard } from '../components/worked-cases/ExecutiveValueBoard';
import type { WorkedCaseSummary } from '../lib/demo/workedCases';
import { BOARD, FUTURE_PROTECTION, FEE_ROWS, ROI, ASISA, fmtR } from '../lib/demo/workedExample';
import { card, big, lab, badge } from '../components/worked-cases/shared';

// Landing for /see-worked-case-example. Opens without sign-in. Insurer name
// is a variable typed by the viewer. All sample data; nothing is sent.
export function WorkedCaseLanding({ onOpenCase, onSeed }: { onOpenCase: (caseId: string) => void; onSeed?: () => void }) {
  const [insurer, setInsurer] = useState('Sample Insurer');
  const [cases, setCases] = useState<WorkedCaseSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [seedNote, setSeedNote] = useState('');

  useEffect(() => {
    fetch('/api/v1/worked-cases')
      .then((r) => r.json())
      .then((p) => setCases(p.data ?? []))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, []);

  const seed = async () => {
    setSeedNote('Loading...');
    try {
      const res = await fetch('/api/v1/worked-example/seed', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'ten_demo', 'idempotency-key': `worked-example-seed-${Date.now()}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'seed failed');
      setSeedNote(`Loaded into the workspace. The real engine scored CLM-2026-00887 duplicate risk ${data.duplicate_check.duplicate_risk_score} (${data.duplicate_check.risk_level}) with ${data.duplicate_check.matches.length} match(es).`);
    } catch (e) {
      setSeedNote('Could not load the sample case. ' + (e as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 48px' }}>
      <h1 style={{ fontSize: 22, margin: '4px 0 2px' }}>See worked-out case example<span style={badge}>SAMPLE DATA</span></h1>
      <p className="ns-page-text" style={{ fontSize: 14, margin: '0 0 12px' }}>
        Explore how NahaShield protects revenue, prevents fraud, and pays valid claims quickly. Fictional sample data. Nothing is sent to anyone.
      </p>

      <label className="ns-page-note" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 4 }}>Insurer name (fills the example)</label>
      <input
        aria-label="Insurer name"
        value={insurer}
        onChange={(e) => setInsurer(e.target.value)}
        placeholder="Your insurer's name"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 16, padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', marginBottom: 16, background: '#fff', color: '#13283f' }}
      />

      <div style={card} className="ns-light-surface">
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Six months at {insurer}<span style={badge}>SAMPLE</span></div>
        <ExecutiveValueBoard
          protectedAmount={BOARD.protectedCents}
          savedAmount={BOARD.savedCents}
          foundAmount={BOARD.foundCents}
          recoveredAmount={BOARD.recoveredCents}
          flaggedAmount={BOARD.flaggedUnconfirmedCents}
          clearedAmount={BOARD.clearedLegitimateCents}
        />
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 13, fontWeight: 700, color: '#0f766e', cursor: 'pointer' }}>How the counts add up</summary>
          <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>
            {BOARD.claimsReviewed.toLocaleString('en-ZA')} reviewed; {BOARD.claimsPaid.toLocaleString('en-ZA')} paid. {BOARD.claimsFlagged} flagged, {BOARD.claimsHeld} held, {BOARD.clearedAfterHold} held then cleared, {BOARD.declinedOrReduced} declined or reduced. {BOARD.wrongfulPaymentsFound} wrongful payments found later; {BOARD.recoveredCases} recovered after bank reconciliation.
          </div>
        </details>
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 13, fontWeight: 700, color: '#0f766e', cursor: 'pointer' }}>Future protection</summary>
          <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
            {FUTURE_PROTECTION.map(([k, v]) => <li key={k}>{k}: <strong>{v}</strong></li>)}
          </ul>
        </details>
      </div>

      <WorkedCaseSelector cases={cases} isLoading={isLoading} onOpen={onOpenCase} />

      <div style={card} className="ns-light-surface">
        <button onClick={seed} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 700, width: '100%', cursor: 'pointer' }}>
          Load these cases into the live workspace
        </button>
        {seedNote ? <p style={{ fontSize: 13, color: '#0f766e', margin: '8px 0 0' }}>{seedNote}</p> : null}
        {seedNote.startsWith('Loaded') && onSeed ? (
          <button onClick={onSeed} style={{ marginTop: 8, width: '100%', background: '#f1f5f9', color: '#0f172a', border: 'none', borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Open the investigator queue
          </button>
        ) : null}
      </div>

      <div style={card} className="ns-light-surface">
        <div style={{ fontSize: 16, fontWeight: 800 }}>What it would cost<span style={badge}>SAMPLE PRICING - NOT AN OFFER</span></div>
        <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>NahaLabs earns only on value people have verified. Protected revenue is never billed.</p>
        {FEE_ROWS.map((f) => (
          <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ color: '#334155', paddingRight: 8 }}>{f.label}</span>
            <strong>{fmtR(f.feeCents)}</strong>
          </div>
        ))}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
          <div><div style={big}>{fmtR(ROI.feeCents)}</div><div style={lab}>Sample fee, six months</div></div>
          <div><div style={big}>{fmtR(ROI.netBenefitCents)}</div><div style={lab}>Net benefit</div></div>
        </div>
        <p style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 0' }}>{ROI.multiple} back on every rand of fee</p>
        <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
          Net benefit {fmtR(ROI.netBenefitCents)} / fee {fmtR(ROI.feeCents)} = {ROI.multiple}, the same as a {ROI.roiPct} return over the fee. Fee is {ROI.feePctOfValue} of verified value and {ROI.feePctOfClaimsPaid} of claims paid.
        </p>
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 13, fontWeight: 700, color: '#0f766e', cursor: 'pointer' }}>Market context (third party)</summary>
          <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>
            {ASISA.line} <a href={ASISA.url} target="_blank" rel="noreferrer" style={{ color: '#0f766e' }}>ASISA media release</a>. {ASISA.verified}
          </div>
        </details>
      </div>

      <p className="ns-page-note" style={{ fontSize: 12, textAlign: 'center' }}>
        All figures on this page are sample figures for demonstration. Recovered counts only after bank reconciliation. Nothing here is sent, billed, or owed.
      </p>
    </div>
  );
}
