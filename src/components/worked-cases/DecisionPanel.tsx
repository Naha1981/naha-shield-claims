import type { CaseDecision } from '../../lib/demo/workedCases';

export function DecisionPanel({ decision }: { decision: CaseDecision }) {
  return (
    <section aria-label="Human decision" style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}>
      <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Human decision</h2>
      <div style={{ fontSize: 20, fontWeight: 800, textTransform: 'capitalize' }}>{decision.decision}</div>
      <div style={{ fontSize: 14, color: '#334155', marginTop: 4 }}>{decision.reason}</div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        Decided by {decision.approver} on {new Date(decision.approved_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}. The claimant can appeal.
      </div>
    </section>
  );
}
