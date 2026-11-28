import type { WorkedCase } from '../../lib/demo/workedCases';
import { fmtCents } from '../../lib/demo/workedCases';
import { big, lab } from './shared';

export function CaseHeader({ workedCase }: { workedCase: WorkedCase }) {
  const metric = (label: string, value: string) => (
    <div key={label} style={{ flex: '1 1 40%', minWidth: 120 }}>
      <div style={{ fontSize: 18, fontWeight: 800, textTransform: 'capitalize' }}>{value}</div>
      <div style={lab}>{label}</div>
    </div>
  );
  return (
    <section aria-label="Case summary">
      <div style={{ fontSize: 13, color: '#64748b' }}>{workedCase.insurer} - {workedCase.product} (sample)</div>
      <h1 style={{ fontSize: 20, margin: '4px 0' }}>{workedCase.title}</h1>
      <div style={{ fontSize: 13, color: '#475569' }}>Claim reference: {workedCase.claim_reference}</div>
      <span style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '2px 10px', background: workedCase.outcome === 'cleared' ? '#dcfce7' : '#fee2e2', color: workedCase.outcome === 'cleared' ? '#166534' : '#b91c1c' }}>{workedCase.outcome_label}</span>
      <div style={{ marginTop: 10 }}>
        <div style={big}>{fmtCents(workedCase.amount_claimed)}</div>
        <div style={lab}>Claim amount (sample)</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {metric('Fraud risk', workedCase.fraud_risk)}
        {metric('Duplicate risk', workedCase.duplicate_risk)}
        {metric('Evidence strength', workedCase.evidence_strength)}
        {metric('Revenue protected', fmtCents(workedCase.revenue_protected) + ' (sample)')}
      </div>
    </section>
  );
}
