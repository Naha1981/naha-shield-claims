import { fmtCents, type WorkedCaseSummary } from '../../lib/demo/workedCases';
import { card, lab } from './shared';

type Props = { cases: WorkedCaseSummary[]; isLoading: boolean; onOpen: (caseId: string) => void };

export function WorkedCaseSelector({ cases, isLoading, onOpen }: Props) {
  if (isLoading) return <div style={{ padding: 12 }}>Loading worked examples...</div>;
  return (
    <section aria-label="Choose a case to explore" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>Choose a case to explore</h2>
      {cases.map((workedCase) => (
        <button
          key={workedCase.case_id}
          onClick={() => onOpen(workedCase.case_id)}
          className="ns-light-surface" style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ ...lab, color: '#40556a', background: '#f1f5f9', borderRadius: 999, padding: '2px 10px' }}>{workedCase.case_type === 'no_fraud' ? 'Clean claim' : 'Fraud pattern'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 10px', background: workedCase.outcome === 'cleared' ? '#dcfce7' : '#fee2e2', color: workedCase.outcome === 'cleared' ? '#166534' : '#b91c1c' }}>{workedCase.outcome_label}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>{workedCase.title}</div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>{workedCase.summary}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>{fmtCents(workedCase.amount_claimed)}</div><div style={lab}>Claimed (sample)</div></div>
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>{fmtCents(workedCase.revenue_protected)}</div><div style={lab}>Protected (sample)</div></div>
          </div>
        </button>
      ))}
    </section>
  );
}
