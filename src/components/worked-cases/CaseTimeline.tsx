import type { CaseStep } from '../../lib/demo/workedCases';

export function CaseTimeline({ steps }: { steps: CaseStep[] }) {
  return (
    <section aria-label="Case timeline">
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>What happened, step by step</h2>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {steps.map((s) => (
          <li key={s.step_id} style={{ marginBottom: 8, fontSize: 14 }}>
            <strong>{s.title}.</strong>{' '}
            <details style={{ display: 'inline' }}>
              <summary style={{ display: 'inline', color: '#0f766e', cursor: 'pointer', fontSize: 13 }}>detail</summary>
              <div style={{ color: '#475569', marginTop: 2 }}>{s.description} {s.logic} <em>{s.deliverable}</em></div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
