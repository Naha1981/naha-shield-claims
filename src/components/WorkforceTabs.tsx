import{TelecomRiskPanel}from'./TelecomRiskPanel';
import React from 'react';
import{HostedExecutionPanel}from'./HostedExecutionPanel';
import { WorkforceView } from './WorkforceView';
import { SynthMessagesPanel } from './SynthMessagesPanel';

/** Sub-tabs. The Documents tab renders the existing WorkforceView unchanged (PDF/Excel flows untouched). */
export function WorkforceTabs({ onRecorded, activeRole }: { onRecorded: () => void; activeRole: string }) {
  const [tab, setTab] = React.useState<'docs' | 'messages' | 'browser' | 'telecom'>('docs');
  const b = (on: boolean) => `px-4 py-2 rounded-t-lg text-sm ${on ? 'bg-slate-900 text-white border border-b-0 border-slate-700' : 'text-slate-400 hover:text-slate-200'}`;
  return <div>
    <div role="tablist" className="flex flex-wrap gap-1 mb-4">
      <button role="tab" aria-selected={tab === 'docs'} className={b(tab === 'docs')} onClick={() => setTab('docs')}>Documents</button>
      <button role="tab" aria-selected={tab === 'messages'} className={b(tab === 'messages')} onClick={() => setTab('messages')}>Messages (test inbox)</button>
      <button role="tab" aria-selected={tab === 'browser'} className={b(tab === 'browser')} onClick={() => setTab('browser')}>Browser tasks</button>
      <button role="tab" aria-selected={tab === 'telecom'} className={b(tab === 'telecom')} onClick={() => setTab('telecom')}>SIM / RICA</button>
    </div>
    {tab === 'telecom' ? <TelecomRiskPanel activeRole={activeRole}/> : tab === 'browser' ? activeRole==='finance_cfo'?<p className="p-5 text-amber-200">Browser actions disabled in CFO demo view.</p>:<HostedExecutionPanel/> : tab === 'docs' ? <WorkforceView onRecorded={onRecorded} /> : <div className="text-slate-100">{activeRole==='finance_cfo'?<p role="note" className="p-5 rounded border border-amber-600">Messages are disabled in the CFO demo view. The private reviewer sign-in is the named owner account, not a CFO identity. This role selector is a demo filter, not account authentication.</p>:<SynthMessagesPanel />}</div>}
  </div>;
}
