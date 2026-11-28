import type { CaseIndicator } from '../../lib/demo/workedCases';
import { summaryStyle } from './shared';

export function IndicatorPanel({ indicators }: { indicators: CaseIndicator[] }) {
  return (
    <section aria-label="Risk indicators">
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Indicators ({indicators.length})</h2>
      <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', borderRadius: 8, padding: '8px 10px', margin: '0 0 8px' }}>
        An indicator is not a finding of fraud. Every indicator carries its innocent explanation, and a human decides.
      </p>
      {indicators.map((i) => (
        <details key={i.indicator_id} style={{ borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
          <summary style={summaryStyle}>
            <span style={{ color: i.severity === 'high' ? '#b91c1c' : '#b45309' }}>{i.severity === 'high' ? 'HIGH' : 'MED'}</span> - {i.title}
          </summary>
          <div style={{ fontSize: 13, color: '#334155', padding: '4px 0 8px' }}>
            {i.description}
            <div style={{ color: '#64748b', marginTop: 2 }}>Innocent side: {i.innocent_explanation}</div>
          </div>
        </details>
      ))}
    </section>
  );
}
