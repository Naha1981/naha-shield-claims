import type { ShieldExplanation } from '../../lib/demo/workedCases';

export function ShieldExplainer({ explanation }: { explanation: ShieldExplanation }) {
  return (
    <details aria-label="Why ClaimTrace said this" style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Why ClaimTrace said this</summary>
      <div style={{ fontSize: 14, color: '#334155', marginTop: 6 }}>
        <p style={{ margin: '0 0 6px' }}><strong>{explanation.bottom_line}</strong></p>
        <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          {explanation.why.map((w) => <li key={w}>{w}</li>)}
        </ul>
        {explanation.innocent_explanations.length > 0 ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>Innocent explanations considered:</div>
            <ul style={{ margin: '2px 0 6px', paddingLeft: 18, color: '#64748b' }}>
              {explanation.innocent_explanations.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </>
        ) : null}
        <div style={{ fontSize: 14 }}>Next step: <strong>{explanation.next_step}</strong></div>
      </div>
    </details>
  );
}
