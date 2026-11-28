import React from 'react';
import {formatZar, formatZarCompact} from '../utils/format';
import type {RoleId} from '../lib/engine/types';

// Investigator home + case workspace from Thabiso's spec 2 section 9.
// Synthetic data only. Phone rule: big numbers, one line per note, details
// behind toggles. The screen never takes an adverse action by itself: hold,
// document requests and call-backs are proposals or drafts a human approves.

type ClaimRow={claim_id:string;policy_id:string;status:string;amount_claimed_cents:number;amount_approved_cents:number;fraud_risk_score:number|null;duplicate_risk_score:number|null;evidence_strength_score:number|null;clock_status:string;clock_due_at:string;owner_id:string|null;agent_id:string|null;indicators:{indicator_id:string;rule_id:string;severity:string;status:string;summary:string}[];next_action:string|null;submitted_at:string};
type Signal={duplicate_signal_id:string;match_type:string;match_confidence:number;recommended_action:string;status:string};
type Evidence={evidence_id:string;evidence_type:string;source:string;evidence_class?:string;strength?:{evidence_strength_score:number;label:string}};

const riskBand=(s:number|null)=>'high'/*placeholder*/;
const band=(s:number|null)=>s==null?'-':s>=85?'HIGH':s>=70?'MED':'LOW';
const bandClass=(s:number|null)=>s==null?'':s>=85?'text-red-600':s>=70?'text-amber-600':'text-emerald-600';

async function api(role:RoleId,method:string,url:string,body?:unknown){
 let code='';try{code=localStorage.getItem('nahashield-access-code')??'';}catch{/* unavailable */}
 const headers:Record<string,string>={'x-nahashield-role':role,'x-nahashield-demo-role':role,...(code?{'x-nahashield-access-code':code}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=crypto.randomUUID();}
 const res=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error((data as {error?:{message?:string}}).error?.message||`Request failed (${res.status})`);
 return data;
}

export function InvestigatorView({activeRole,onOpenExample}:{activeRole:RoleId;onOpenExample?:()=>void}){
 const[claims,setClaims]=React.useState<ClaimRow[]>([]);
 const[selected,setSelected]=React.useState<ClaimRow|null>(null);
 const[signals,setSignals]=React.useState<Signal[]>([]);
 const[evidence,setEvidence]=React.useState<Evidence[]>([]);
 const[filters,setFilters]=React.useState({risk_level:'',status:'',clock_status:'',min_amount_cents:''});
 const[sort,setSort]=React.useState<'amount_claimed_cents'|'duplicate_risk_score'|'clock_due_at'>('amount_claimed_cents');
 const[error,setError]=React.useState('');
 const[busy,setBusy]=React.useState('');
 const[notice,setNotice]=React.useState('');
 const[draft,setDraft]=React.useState<{body:string;status:string}|null>(null);
 const[insurerName,setInsurerName]=React.useState('');

 const load=React.useCallback(async()=>{
  try{
   const q=new URLSearchParams();
   if(filters.status)q.set('status',filters.status);
   if(filters.risk_level)q.set('risk_level',filters.risk_level);
   if(filters.clock_status)q.set('clock_status',filters.clock_status);
   if(filters.min_amount_cents)q.set('min_amount_cents',String(Number(filters.min_amount_cents)*100));
   q.set('sort',sort);q.set('order','desc');q.set('page_size','100');
   const data=await api(activeRole,'GET',`/api/v1/claims?${q}`) as {items:ClaimRow[]};
   setClaims(data.items);setError('');
  }catch(e){setError((e as Error).message);}
 },[activeRole,filters,sort]);
 React.useEffect(()=>{void load();},[load]);

 const openCase=async(c:ClaimRow)=>{
  setSelected(c);setDraft(null);setNotice('');setSignals([]);setEvidence([]);
  try{
   const detail=await api(activeRole,'GET',`/api/v1/claims/${c.claim_id}`) as ClaimRow;
   setSelected(detail);
   // Duplicate signals for this claim live behind its checks; evidence list is per claim.
   const ev=await api(activeRole,'GET',`/api/v1/claims?claim_id=${c.claim_id}`).catch(()=>null);
   void ev;
  }catch(e){setError((e as Error).message);}
 };

 const act=async(key:string,fn:()=>Promise<string>)=>{setBusy(key);setError('');setNotice('');try{setNotice(await fn());await load();}catch(e){setError((e as Error).message);}finally{setBusy('');}};

 const kpis=React.useMemo(()=>{
  const open=claims.filter(c=>!['closed','paid','declined'].includes(c.status));
  const high=open.filter(c=>(c.duplicate_risk_score??0)>=70);
  const overdue=open.filter(c=>c.clock_status==='overdue'||(c.clock_due_at&&c.clock_due_at<new Date().toISOString()));
  const atStake=open.reduce((s,c)=>s+c.amount_claimed_cents,0);
  return{open:open.length,high:high.length,overdue:overdue.length,atStake};
 },[claims]);

 const holdClaim=()=>act('hold',async()=>{
  const a=await api(activeRole,'POST','/api/v1/adverse-actions',{claim_id:selected!.claim_id,action_type:'hold',reason_code:'duplicate_claim_detected',reason_text:'A potential duplicate claim requires review before payment.',proposed_by:'usr_demo'}) as {adverse_action_id:string;status:string};
  return `Hold proposed (${a.adverse_action_id}). Nothing changed yet: a claims manager must approve it.`;
 });
 const requestDocs=()=>act('docs',async()=>{
  if(!insurerName.trim())throw new Error('Type the insurer name first. It is always a variable, never hardcoded.');
  const n=await api(activeRole,'POST','/api/v1/notifications',{claim_id:selected!.claim_id,recipient_id:'claimant',channel:'sms',template_id:'claim_documents_required_v1',variables:{insurer_name:insurerName.trim(),claim_reference:selected!.claim_id,document_type:'a required document',due_date:'the date in our letter'}}) as {rendered_body:string;status:string};
  setDraft({body:n.rendered_body,status:n.status});
  return 'Draft created. Nothing was sent: a person sends approved wording from the insurer\'s own system.';
 });
 const requestCallback=()=>act('callback',async()=>{
  if(!insurerName.trim())throw new Error('Type the insurer name first. It is always a variable, never hardcoded.');
  const n=await api(activeRole,'POST','/api/v1/notifications',{claim_id:selected!.claim_id,recipient_id:'claimant',channel:'sms',template_id:'claim_callback_required_v1',variables:{insurer_name:insurerName.trim(),claim_reference:selected!.claim_id}}) as {rendered_body:string;status:string};
  setDraft({body:n.rendered_body,status:n.status});
  return 'Call-back draft created. Nothing was sent.';
 });
 const escalate=()=>act('escalate',async()=>{
  await api(activeRole,'POST',`/api/v1/claims/${selected!.claim_id}/assignment`,{assignee_id:'usr_claims_manager',assignment_reason:'escalation'});
  return 'Escalated to the claims manager queue.';
 });
 const closeLegit=()=>act('close',async()=>{
  await api(activeRole,'POST',`/api/v1/claims/${selected!.claim_id}/notes`,{note_type:'investigator_note',content:'Closed as legitimate after review. No duplicate cover found.',visibility:'internal'});
  return 'Marked legitimate in the case notes. The claim keeps its normal course.';
 });

 const kpiCard=(label:string,value:string,tone:string='')=>(
  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
   <div className={`text-3xl font-bold ${tone}`}>{value}</div>
   <div className="text-xs text-slate-500 mt-1">{label}</div>
  </div>
 );

 if(selected){
  const c=selected;
  return(
   <div className="space-y-4 p-4">
    <button className="text-sm underline" onClick={()=>{setSelected(null);setDraft(null);}}>Back to queue</button>
    {/* ClaimHeader */}
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
     <div className="flex items-baseline justify-between">
      <div className="text-2xl font-bold">{formatZar(c.amount_claimed_cents/100)}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{c.status.replace(/_/g,' ')}</div>
     </div>
     <div className="text-xs text-slate-500 mt-1">{c.claim_id} · clock {c.clock_status}</div>
     <div className="text-xs text-slate-500">{c.owner_id?`Owner: ${c.owner_id}`:'Unassigned'}</div>
    </div>
    {/* RiskSummaryCard: three big numbers */}
    <div className="grid grid-cols-3 gap-2">
     <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center"><div className={`text-2xl font-bold ${bandClass(c.fraud_risk_score)}`}>{c.fraud_risk_score??'-'}</div><div className="text-[11px] text-slate-500">Fraud</div></div>
     <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center"><div className={`text-2xl font-bold ${bandClass(c.duplicate_risk_score)}`}>{c.duplicate_risk_score??'-'}</div><div className="text-[11px] text-slate-500">Duplicate</div></div>
     <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center"><div className={`text-2xl font-bold ${bandClass(c.evidence_strength_score)}`}>{c.evidence_strength_score??'-'}</div><div className="text-[11px] text-slate-500">Evidence</div></div>
    </div>
    {/* IndicatorList: one card per indicator, spec 9.3 */}
    {c.indicators.filter(i=>i.status==='open').map(i=>(
     <div key={i.indicator_id} className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-baseline justify-between">
       <div className="font-semibold">Possible duplicate signal</div>
       <div className={`text-xs font-bold ${i.severity==='high'?'text-red-600':'text-amber-600'}`}>{i.severity.toUpperCase()}</div>
      </div>
      <div className="text-sm mt-1">{i.summary}</div>
      <div className="text-sm mt-2">Amount at stake: <b>{formatZar(c.amount_claimed_cents/100)}</b></div>
      <details className="mt-2 text-sm"><summary className="cursor-pointer">Innocent explanations</summary>
       <ul className="list-disc ml-5 mt-1 text-slate-600">
        <li>Possible duplicate policy held by the same family.</li>
        <li>Possible data-entry error.</li>
       </ul>
      </details>
      <div className="text-xs text-slate-500 mt-2">No action has been taken on this claim. A person decides.</div>
     </div>
    ))}
    {/* ShieldPanel: plain-language answer, spec 9.4 */}
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
     <div className="font-semibold">Why is this claim flagged?</div>
     {c.indicators.some(i=>i.status==='open')?(
      <div className="text-sm mt-2 space-y-1">
       <p>Bottom line: a possible duplicate is linked to this claim. {formatZar(c.amount_claimed_cents/100)} is at stake.</p>
       <details className="text-sm"><summary className="cursor-pointer">Why</summary>
        <ul className="list-disc ml-5 mt-1 text-slate-600"><li>The same person, account or document appears on another claim.</li></ul>
       </details>
       <details className="text-sm"><summary className="cursor-pointer">Innocent explanations</summary>
        <ul className="list-disc ml-5 mt-1 text-slate-600"><li>Shared family account.</li><li>Data-entry error.</li></ul>
       </details>
      </div>
     ):<p className="text-sm mt-2 text-slate-600">No open flags on this claim.</p>}
    </div>
    {/* Evidence + documents behind a toggle */}
    <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
     <summary className="cursor-pointer font-semibold">Documents and evidence</summary>
     <DocumentsPanel role={activeRole} claim={c}/>
    </details>
    {/* DecisionPanel, spec 9.5 */}
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
     <div className="font-semibold">Decision</div>
     <div className="text-xs text-slate-500 mt-1">Recommended: {c.next_action==='review_duplicate_signal'?'Hold and investigate':'Normal review'} · Approval required: claims manager</div>
     <input className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Insurer name (required for drafts)" value={insurerName} onChange={e=>setInsurerName(e.target.value)}/>
     <div className="grid grid-cols-2 gap-2 mt-2">
      <button disabled={busy!==''} onClick={holdClaim} className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Hold claim</button>
      <button disabled={busy!==''} onClick={requestDocs} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white">Request documents</button>
      <button disabled={busy!==''} onClick={requestCallback} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white">Request call-back</button>
      <button disabled={busy!==''} onClick={escalate} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white">Escalate</button>
      <button disabled={busy!==''} onClick={closeLegit} className="col-span-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">Close as legitimate</button>
     </div>
     {notice&&<p className="text-sm text-emerald-700 mt-2">{notice}</p>}
     {draft&&(
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
       <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Draft ({draft.status.replace(/_/g,' ')})</div>
       <p className="mt-1">{draft.body}</p>
       <p className="mt-1 text-xs text-slate-500">Nothing was sent. A person sends approved wording from the insurer's own system.</p>
      </div>
     )}
    </div>
    {error&&<p className="text-sm text-red-600">{error}</p>}
   </div>
  );
 }

 // Investigator home: KPI bar + filters + queue
 return(
  <div className="space-y-4 p-4">
   {onOpenExample?(
    <button onClick={onOpenExample} className="w-full rounded-xl border border-teal-600 bg-teal-50 p-3 text-sm font-bold text-teal-800">
     See worked-out case example (sample data)
    </button>
   ):null}
   <div className="grid grid-cols-4 gap-2">
    {kpiCard('Open cases',String(kpis.open))}
    {kpiCard('High risk',String(kpis.high),'text-red-600')}
    {kpiCard('Overdue',String(kpis.overdue),'text-amber-600')}
    {kpiCard('At stake',formatZarCompact(kpis.atStake/100))}
   </div>
   {/* FilterPanel */}
   <div className="flex flex-wrap gap-2 text-sm">
    <select className="rounded-lg border border-slate-300 p-2" value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))}>
     <option value="">All statuses</option><option value="received">Received</option><option value="under_review">Under review</option><option value="on_hold">On hold</option><option value="approved">Approved</option>
    </select>
    <select className="rounded-lg border border-slate-300 p-2" value={filters.risk_level} onChange={e=>setFilters(f=>({...f,risk_level:e.target.value}))}>
     <option value="">Any risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
    </select>
    <select className="rounded-lg border border-slate-300 p-2" value={filters.clock_status} onChange={e=>setFilters(f=>({...f,clock_status:e.target.value}))}>
     <option value="">Any clock</option><option value="running">Running</option><option value="due_soon">Due soon</option><option value="overdue">Overdue</option>
    </select>
    <input className="w-28 rounded-lg border border-slate-300 p-2" placeholder="Min R" value={filters.min_amount_cents} onChange={e=>setFilters(f=>({...f,min_amount_cents:e.target.value}))}/>
    <select className="rounded-lg border border-slate-300 p-2" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}>
     <option value="amount_claimed_cents">Rands</option><option value="duplicate_risk_score">Risk</option><option value="clock_due_at">Clock</option>
    </select>
   </div>
   {/* CaseQueueTable */}
   {claims.length===0?<p className="text-sm text-slate-500 p-2">No claims in the workspace yet. Bring claims in through Intake, or create one through the claims API.</p>:(
    <div className="space-y-2">
     {claims.map(c=>(
      <button key={c.claim_id} onClick={()=>void openCase(c)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left">
       <div className="flex items-baseline justify-between">
        <span className="text-xl font-bold">{formatZar(c.amount_claimed_cents/100)}</span>
        <span className={`text-xs font-bold ${bandClass(c.duplicate_risk_score)}`}>{band(c.duplicate_risk_score)}</span>
       </div>
       <div className="text-xs text-slate-500 mt-1">{c.status.replace(/_/g,' ')} · clock {c.clock_status}{c.indicators.some(i=>i.status==='open')?' · flag open':''}</div>
      </button>
     ))}
    </div>
   )}
   {error&&<p className="text-sm text-red-600">{error}</p>}
  </div>
 );
}

function DocumentsPanel({role,claim}:{role:RoleId;claim:ClaimRow}){
 const[docs,setDocs]=React.useState<{document_id:string;document_type:string;sha256_hash?:string}[]>([]);
 React.useEffect(()=>{void api(role,'GET',`/api/v1/claims/${claim.claim_id}`).then((d)=>setDocs((d as ClaimRow&{documents:{document_id:string;document_type:string;sha256_hash?:string}[]}).documents??[])).catch(()=>{});},[role,claim.claim_id]);
 if(docs.length===0)return <p className="mt-2 text-slate-500">No documents on this claim.</p>;
 return(
  <ul className="mt-2 space-y-1">
   {docs.map(d=><li key={d.document_id} className="text-slate-600">{d.document_type.replace(/_/g,' ')}{d.sha256_hash?' · hash on file':''}</li>)}
  </ul>
 );
}
