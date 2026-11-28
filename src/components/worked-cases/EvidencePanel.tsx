import type { CaseEvidence } from '../../lib/demo/workedCases';

export function EvidencePanel({ evidence }: { evidence: CaseEvidence[] }) {
  return (
    <details aria-label="Evidence" style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Evidence ({evidence.length})</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14 }}>
        {evidence.map((e) => (
          <li key={e.evidence_id} style={{ marginBottom: 6 }}>
            {e.description} <span style={{ fontSize: 12, color: '#64748b' }}>({e.class === 'verified_fact' ? 'verified fact' : 'documented allegation'}, {e.type.replace(/_/g, ' ')})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
