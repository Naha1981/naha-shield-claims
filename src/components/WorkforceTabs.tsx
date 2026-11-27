import {PublicMapPreview} from './PublicMapPreview';
import {GovernanceReadiness} from './GovernanceReadiness';
import {VoiceCommandPanel} from './VoiceCommandPanel';
import {WorkforceIntroduction} from './WorkforceIntroduction';
import{TelecomRiskPanel}from'./TelecomRiskPanel';
import React from 'react';
import {Bot, FileText, Mail, Globe, MapPin, Smartphone, Mic, ChevronLeft, MessageCircle, ShieldCheck, Fingerprint, FolderLock} from 'lucide-react';
import{HostedExecutionPanel}from'./HostedExecutionPanel';
import { WorkforceView } from './WorkforceView';
import { SynthMessagesPanel } from './SynthMessagesPanel';

/** Sub-tabs. The Documents tab renders the existing WorkforceView unchanged (PDF/Excel flows untouched). */
export function WorkforceTabs({ onRecorded, activeRole }: { onRecorded: () => void; activeRole: string }) {
  const [tab, setTab] = React.useState<'docs' | 'messages' | 'browser' | 'maps' | 'telecom' | 'voice' | 'home' | 'chat'>('home');
  const b = (on: boolean) => `px-4 py-2 rounded-t-lg text-sm ${on ? 'bg-slate-900 text-white border border-b-0 border-slate-700' : 'text-slate-400 hover:text-slate-200'}`;
  const tasks = [
    ['docs','Read a file','Read fictional PDFs & spreadsheets',FileText,'#e2f2ff'],
    ['chat','Ask the team','Ask 12 specialist agents',MessageCircle,'#eee8ff'],
    ['maps','Check an address','Inspect public maps & images',MapPin,'#dcf5ec'],
    ['messages','Review messages','Review supplied test messages',Mail,'#fff0d9'],
    ['browser','Run a browser task','Run approved synthetic tasks',Globe,'#e1f1ff'],
    ['telecom','Check a SIM','Inspect synthetic SIM / RICA signals',Smartphone,'#ffe7ec'],
    ['voice','Use your voice','Commands & samples',Mic,'#eeeaff'],
  ] as const;
  return <div className="visual-workspace">
    {tab === 'home' ? <>
      <section className="visual-welcome" aria-label="Choose a task">
        <div><span className="visual-eyebrow">YOUR AI WORKSPACE · DESIGN PREVIEW</span><h2>Coordinate claims intelligence.</h2><p>Focused checks. Evidence for your team to review.</p><span className="visual-safety">Synthetic examples only · Human review</span></div>
        <div className="intelligence-diagram" aria-label="Identity, address, policy and evidence checks require human review"><span><Fingerprint/>Identity</span><span><MapPin/>Address</span><ShieldCheck className="diagram-shield"/><span><FileText/>Policy</span><span><FolderLock/>Evidence</span></div>
      </section>
      <h3 className="specialist-title">Choose a specialist</h3><div className="visual-task-grid">{tasks.map(([id,title,hint,Icon,color])=><button key={id} className="visual-task" onClick={()=>setTab(id)}><span className="visual-task-icon" style={{background:color}}><Icon size={34} strokeWidth={1.8}/></span><strong>{title}</strong><small>{hint}</small><span className="visual-task-arrow" aria-hidden="true">↗</span></button>)}</div>
      <div className="visual-footer"><a href="/review">Try the guided demo ↗</a><details><summary>How it works & safeguards</summary><WorkforceIntroduction/><GovernanceReadiness/></details></div>
    </> : <>
      <button className="visual-back" onClick={()=>setTab('home')}><ChevronLeft size={18}/> All tasks</button>
      <div role="tablist" aria-label="Work tools" className="flex flex-wrap gap-1 mb-4">{tasks.map(([id,title,,Icon])=><button key={id} role="tab" aria-selected={tab===id} className={b(tab===id)} onClick={()=>setTab(id)}><Icon className="inline-block mr-2" size={16}/>{title}</button>)}</div>
    {tab === 'chat'? <WorkforceIntroduction/> : tab === 'maps'?<><PublicMapPreview embedded/></>:tab === 'voice' ? <VoiceCommandPanel/> : tab === 'telecom' ? <TelecomRiskPanel activeRole={activeRole}/> : tab === 'browser' ? activeRole==='finance_cfo'?<p className="p-5 text-amber-200">Browser actions disabled in CFO demo view.</p>:<HostedExecutionPanel key="browser"/> : tab === 'docs' ? <WorkforceView onRecorded={onRecorded} /> : <div className="text-slate-100">{activeRole==='finance_cfo'?<p role="note" className="p-5 rounded border border-amber-600">Messages are disabled in the CFO demo view. The private reviewer sign-in is the named owner account, not a CFO identity. This role selector is a demo filter, not account authentication.</p>:<SynthMessagesPanel />}</div>}
    <details className="mt-6 rounded-lg border p-4"><summary>How it works & safeguards</summary><GovernanceReadiness/></details></>}
  </div>;
}
