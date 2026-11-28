import { big, lab } from './shared';
import { fmtCents } from '../../lib/demo/workedCases';

// Six-month sample board. Four money terms strictly separate, all sample.
export function ExecutiveValueBoard(props: { protectedAmount: number; savedAmount: number; recoveredAmount: number; foundAmount: number; flaggedAmount: number; clearedAmount: number }) {
  const items: [string, number][] = [
    ['Protected', props.protectedAmount],
    ['Saved', props.savedAmount],
    ['Found', props.foundAmount],
    ['Recovered', props.recoveredAmount],
  ];
  return (
    <section aria-label="Six-month sample board">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {items.map(([k, v]) => (
          <div key={k} style={{ flex: '1 1 42%', minWidth: 140 }}>
            <div style={{ ...big, fontSize: 23 }}>{fmtCents(v)}</div>
            <div style={lab}>{k} (sample)</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 13, color: '#475569' }}>
        <span>Flagged, unconfirmed: {fmtCents(props.flaggedAmount)}</span>
        <span>Cleared as legitimate: {fmtCents(props.clearedAmount)}</span>
      </div>
    </section>
  );
}
