import { useEffect, useState } from 'react';
import { CaseHeader } from '../components/worked-cases/CaseHeader';
import { CaseTimeline } from '../components/worked-cases/CaseTimeline';
import { IndicatorPanel } from '../components/worked-cases/IndicatorPanel';
import { EvidencePanel } from '../components/worked-cases/EvidencePanel';
import { DecisionPanel } from '../components/worked-cases/DecisionPanel';
import { ValuePanel } from '../components/worked-cases/ValuePanel';
import { ShieldExplainer } from '../components/worked-cases/ShieldExplainer';
import type { WorkedCase } from '../lib/demo/workedCases';
import { card, badge } from '../components/worked-cases/shared';

// Detail page for /see-worked-case-example/:caseId. Fetches the real API.
export function WorkedCaseDetailPage({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [workedCase, setWorkedCase] = useState<WorkedCase | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setWorkedCase(null); setError('');
    fetch(`/api/v1/worked-cases/${encodeURIComponent(caseId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('not found');
        const p = await r.json();
        const d = p.data;
        setWorkedCase({ ...d, case_decision: d.case_decision } as WorkedCase);
      })
      .catch(() => setError('This worked case could not be loaded.'));
  }, [caseId]);

  if (error) return <div style={{ padding: 16 }}>{error} <button onClick={onBack}>Back</button></div>;
  if (!workedCase) return <div style={{ padding: 16 }}>Loading worked example...</div>;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 48px', color: '#0f172a' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#0f766e', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
        &larr; All worked examples
      </button>
      <span style={badge}>SAMPLE DATA</span>
      <div style={card}><CaseHeader workedCase={workedCase} /></div>
      <div style={card}><CaseTimeline steps={workedCase.timeline} /></div>
      {workedCase.indicators.length > 0 ? <div style={card}><IndicatorPanel indicators={workedCase.indicators} /></div> : null}
      <div style={card}><EvidencePanel evidence={workedCase.evidence} /></div>
      <div style={card}><DecisionPanel decision={workedCase.case_decision} /></div>
      <div style={card}><ValuePanel value={workedCase.value} /></div>
      <div style={card}><ShieldExplainer explanation={workedCase.shield_explanation} /></div>
      <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
        Fictional demo data. Sample rands. Nothing is sent to anyone.
      </p>
    </div>
  );
}
