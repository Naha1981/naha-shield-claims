import type { CaseValue } from '../../lib/demo/workedCases';
import { fmtCents } from '../../lib/demo/workedCases';
import { big, lab } from './shared';

export function ValuePanel({ value }: { value: CaseValue }) {
  const row = (label: string, cents: number) => (
    <div key={label} style={{ flex: '1 1 30%', minWidth: 100 }}>
      <div style={{ ...big, fontSize: 22 }}>{fmtCents(cents)}</div>
      <div style={lab}>{label} (sample)</div>
    </div>
  );
  return (
    <section aria-label="Value">
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>What it was worth</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {row('Protected', value.revenue_protected)}
        {row('Saved', value.revenue_saved)}
        {row('Recovered', value.revenue_recovered)}
      </div>
      <div style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
        Claimant experience: {value.claimant_experience}. Compliance: {value.compliance_outcome}.
      </div>
    </section>
  );
}
