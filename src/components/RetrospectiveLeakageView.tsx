import React from 'react';
import {formatZar} from '../utils/format';
import {analyseLeakage,analyseRows,demoCsv,parseCsv} from '../lib/engine/leakageEngine';
import {ingestCsvText} from '../lib/engine/claimsFileIngest';
import type {Finding} from '../../server/retrospectiveLeakage';
import type {IngestReport} from '../lib/engine/claimsFileIngest';
import type {RecoveryCaseInput, RoleId} from '../lib/engine/types';
import type {NavRoute} from './LayoutShell';

type Row=Record<string,string>;
type Candidate={subject:string;claims:string[];paid_zar:number;rules:string[];suggested_next_step:string};
type Checklist={step:string;detail:string;source:string;url:string;cost:string};
type Source={name:string;what:string;cost:string;url:string;use:string};
type Analysis={file_name:string;synthetic:boolean;format?:string;sheet_name?:string;ingest_report?:IngestReport;summary:{claims_analysed:number;paid_claims:number;total_paid_zar:number;flagged_claims:number;flagged_paid_zar:number;findings_count:number;by_rule:Record<string,number>};findings:Finding[];recovery_candidates:Candidate[];death_checklist:Checklist[];tracing_sources:Source[];limits:string[]};

const TEMPLATE='claim_ref,policy_ref,insured_id,insured_name,policyholder_id,claimant_name,beneficiary_name,bank_account,phone,document_hash,funeral_parlour,doctor,agent,amount_zar,claim_date,policy_inception_date,status,household\nEX-001,POL-001,ID-001,Example Person,HDR-001,Example Claimant,Example Beneficiary,ACC-001,PH-001,DOC-001,Example Parlour,Example Doctor,Example Agent,150000,2026-10-01,2024-01-15,paid,HH-001\n';

function download(name:string,text:string){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
function evidenceCsv(f:Finding){const cols=[...new Set(f.evidence_rows.flatMap(r=>Object.keys(r)))];const esc=(v:string)=>/[",\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;return ['finding_id,rule,status,'+cols.join(','),...f.evidence_rows.map(r=>[f.id,f.rule,f.status,...cols.map(c=>esc(r[c]??''))].join(','))].join('\n')+'\n';}
const costClass=(c:string)=>c==='Free'?'network-cost network-cost-free':'network-cost network-cost-fee';

const RECOVERY_PREFILL_KEY='nahashield-recovery-prefill';

function monthLabel(iso:string){return new Date(iso+'T00:00:00').toLocaleDateString('en-ZA',{month:'short',year:'numeric'});}

export function FileCheckCard({report,sheetName}:{report:IngestReport;sheetName?:string}){
 return <section className="network-box"><h3>File check</h3><p className="network-muted">What was understood from the uploaded file{sheetName?` (sheet: ${sheetName})`:''}.</p>
 <div className="network-stats">
  <span><b>{report.rows_used}</b> claims{report.rows_read!==report.rows_used?` (${report.rows_read} read)`:''}</span>
  <span><b>{report.months_covered?`${report.months_covered} months`:'No dates'}</b>{report.first_claim_date&&report.last_claim_date&&<><br/><small>{monthLabel(report.first_claim_date)} to {monthLabel(report.last_claim_date)}</small></>}</span>
 </div>
 <details className="network-info"><summary>What was understood</summary>
 {report.columns_mapped.length>0&&<p className="network-muted"><strong>Columns understood:</strong> {report.columns_mapped.map(m=>`${m.from} → ${m.to}`).join(' · ')}</p>}
 {report.columns_ignored.length>0&&<p className="network-muted"><strong>Columns not used:</strong> {report.columns_ignored.join(', ')}</p>}
 </details>
 {report.warnings.length>0?<ul className="network-links">{report.warnings.map(w=><li key={w}>{w}</li>)}</ul>:<p className="network-muted">No gaps or duplicates found.</p>}
 </section>;
}

export function RetrospectiveLeakageView({onNavigate,activeRole}:{onNavigate?:(route:NavRoute)=>void;activeRole?:RoleId}){
 const[data,setData]=React.useState<Analysis|null>(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[ruleFilter,setRuleFilter]=React.useState('all'),[sentCase,setSentCase]=React.useState('');
 const sample=()=>{setBusy(true);setError('');fetch('/api/leakage/demo').then(r=>{if(!r.ok)throw Error('api unavailable');return r.json()}).then(setData).catch(()=>{try{setData({file_name:'synthetic-6-month-claims-demo.csv',synthetic:true,...analyseLeakage(demoCsv())})}catch(e){setError((e as Error).message)}}).finally(()=>setBusy(false));};
 const onFile=(e:React.ChangeEvent<HTMLInputElement>)=>{
  const f=e.target.files?.[0];if(!f)return;
  setBusy(true);setError('');setSentCase('');
  const isExcel=/\.(xlsx|xlsm)$/i.test(f.name);
  if(isExcel){
   const reader=new FileReader();
   reader.onload=()=>{
    const b64=String(reader.result||'').split(',')[1]||'';
    fetch('/api/leakage/analyse-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_name:f.name,content_base64:b64})})
     .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error((body as {error?:string}).error||'api unavailable');return body as Analysis;})
     .then(setData)
     .catch(err=>setError('Could not analyse this workbook: '+(err as Error).message))
     .finally(()=>setBusy(false));
   };
   reader.onerror=()=>{setError('Could not read the file from this device.');setBusy(false);};
   reader.readAsDataURL(f);
   return;
  }
  f.text().then(csv=>{fetch('/api/leakage/analyse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv,file_name:f.name})}).then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error((body as {error?:string}).error||'api unavailable');return body as Analysis;}).then(setData).catch(err=>{try{const ingested=ingestCsvText(csv,f.name,parseCsv);setData({file_name:f.name,synthetic:false,format:'csv',ingest_report:ingested.report,...analyseRows(ingested.rows)})}catch(e2){setError('Could not read this file: '+(err as Error).message)}}).finally(()=>setBusy(false));});
 };
 React.useEffect(()=>{if(window.location.hash==='#sample')sample();},[]);
 // Handoff from the Intake screen: an analysis produced there opens here.
 const[intakeSource,setIntakeSource]=React.useState('');
 React.useEffect(()=>{
  try{
   const raw=localStorage.getItem('nahashield-intake-analysis');
   if(!raw)return;
   localStorage.removeItem('nahashield-intake-analysis');
   const payload=JSON.parse(raw) as Analysis;
   setIntakeSource(payload.file_name||'intake');
   setData(payload);
  }catch{/* ignore an unreadable handoff */}
 },[]);
 const groups=React.useMemo(()=>{const m=new Map<string,Finding[]>();for(const f of data?.findings??[])if(ruleFilter==='all'||f.rule===ruleFilter){if(!m.has(f.rule))m.set(f.rule,[]);m.get(f.rule)!.push(f);}return m;},[data,ruleFilter]);
 const totalToChase=React.useMemo(()=>(data?.recovery_candidates??[]).reduce((t,c)=>t+c.paid_zar,0),[data]);
 const sendToRecovery=(c:Candidate,i:number)=>{
  const prefill:Partial<RecoveryCaseInput>&{leakage_note:string}={
   case_id:`LEAK-${Date.now().toString(36).toUpperCase()}-${i+1}`,
   policy_ref:'LEAKAGE-FILE',
   claim_ref:c.claims.join('; '),
   defendant_alias:c.subject,
   original_payout:Math.round(c.paid_zar),
   fraud_basis:`Leakage review leads (${c.rules.join('; ')}). Leads, not proof: a human investigator confirms before any recovery step.`,
   title_type:'None',
   primary_residence:false,
   est_sale_proceeds:0,
   senior_bonds:0,
   municipal_arrears:0,
   legal_costs:0,
   ring_flag:false,
   leakage_note:'Prefilled from a Leakage review of an uploaded claims file. The file says nothing about assets, title or employment: the recoveries lead completes those before registering the case.',
  };
  try{localStorage.setItem(RECOVERY_PREFILL_KEY,JSON.stringify(prefill));}catch{/* storage unavailable */}
  setSentCase(c.subject);
  onNavigate?.('/recovery');
 };
 return <div className="network-page"><header><span className="network-kicker">PAST-CLAIMS LEAKAGE CHECK</span><h2>Ingest past claims, find the leakage</h2><p className="network-sub">Upload six months of claims. See what to <mark>investigate first</mark> and what to <mark>recover</mark>.</p><p className="network-safety">Read-only · leads, not proof · files analysed in memory and discarded</p><details className="network-info"><summary>ⓘ How it works</summary><p>Upload a claims export as it comes: CSV or Excel, your own column names, gaps and duplicates included. The file check below shows exactly what was understood before any finding is trusted.</p><p>It marks the claims a human investigator should open first, with the evidence rows attached. Uploaded files are analysed in memory and discarded. No claim, payment or recovery action is taken.</p><p>Built for the retrospective assignment: <strong>find leakage in past claims, prove it, then recover.</strong> Duplicates, shared accounts, reused documents, repeat beneficiaries, early claims and originator concentration are flagged with their amounts. Post-payment findings become ranked recovery candidates with a rand value and a next step. Every amount comes from the supplied file only.</p></details></header>
 <section className="network-box"><div className="network-controls"><label>Upload claims file (CSV or Excel)<input aria-label="Upload claims file" type="file" accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} disabled={busy}/></label><label>Or try the sample<button type="button" className="network-cta" onClick={sample} disabled={busy}>{busy?'Analysing...':'Load sample file'}</button><small>38 fictional claims · 6 months</small></label></div><details className="network-info"><summary>Columns and template</summary><p className="network-muted">Your own column names are fine: "Claim No", "Amount Paid", "Date of Loss" and similar are recognised automatically, and the file check shows what each column was read as. Only a claim reference column is required. The fullest template: {`claim_ref, policy_ref, insured_id, insured_name, policyholder_id, claimant_name, beneficiary_name, bank_account, phone, document_hash, funeral_parlour, doctor, agent, amount_zar, claim_date, policy_inception_date, status, household`}. Dates can be YYYY-MM-DD, DD/MM/YYYY or Excel dates; amounts in rand. Only rows with status other than declined count as paid.</p><button type="button" onClick={()=>download('nahashield-claims-template.csv',TEMPLATE)}>Download template CSV</button></details>{error&&<p role="alert">{error}</p>}</section>
 {intakeSource&&<p className="network-safety">From Intake: {intakeSource} · analysed in memory, nothing stored</p>}
 {data&&<>
 <div className="network-stats"><span><b>{data.summary.claims_analysed}</b> claims</span><span><b>{formatZar(data.summary.total_paid_zar)}</b> paid</span><span><b>{data.summary.findings_count}</b> findings</span><span><b>{formatZar(data.summary.flagged_paid_zar)}</b> flagged</span></div>
 {data.ingest_report&&<FileCheckCard report={data.ingest_report} sheetName={data.sheet_name}/>}
 <section className="network-box"><h3>Findings</h3><label>Rule<select aria-label="Filter findings by rule" value={ruleFilter} onChange={e=>setRuleFilter(e.target.value)}><option value="all">All rules</option>{Object.keys(data.summary.by_rule).map(r=><option key={r}>{r} ({data.summary.by_rule[r]})</option>)}</select></label><p className="network-muted">{data.findings.length} findings · {data.summary.flagged_claims} paid claims · {data.file_name}{data.synthetic?' (sample)':''}</p><div className="network-flags">{[...groups.entries()].map(([rule,fs])=>fs.map(f=><article key={f.id}><span className="network-badge">Review</span><h4>{rule}</h4><p><strong>{f.subject}</strong> · {f.claim_refs.length} claim(s) · <mark>{formatZar(f.amount_flagged_zar)}</mark></p><details><summary>Evidence & next check</summary><p>{f.reason}</p><p><strong>Claims:</strong> {f.claim_refs.join(', ')}</p><p><strong>Possible innocent explanation:</strong> {f.innocent_explanation}</p><p><strong>Next check:</strong> {f.next_check}</p><div className="network-table-wrap"><table className="network-table"><thead><tr>{Object.keys(f.evidence_rows[0]).slice(0,7).map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{f.evidence_rows.slice(0,12).map((r,i)=><tr key={i}>{Object.keys(f.evidence_rows[0]).slice(0,7).map(c=><td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>{f.evidence_rows.length>12&&<p className="network-muted">Showing 12 of {f.evidence_rows.length} evidence rows; the pack below has all.</p>}<p><button type="button" onClick={()=>download(f.id+'-evidence-pack.csv',evidenceCsv(f))}>Download evidence pack (CSV)</button>{f.death_checklist&&<> Run the <a href="#death-checklist">death check</a>.</>}{f.tracing&&<> Trace with the <a href="#tracing-sources">free sources</a>.</>}</p></details></article>))}</div>{data.findings.length===0&&<p>No findings in this file.</p>}</section>
 <section className="network-box"><h3>Money to recover</h3><p className="network-muted">{data.recovery_candidates.length?<>Up to <mark>{formatZar(totalToChase)}</mark> to chase across {data.recovery_candidates.length} {data.recovery_candidates.length===1?'person':'people'} · ranked by amount at stake. This is why the review exists: every finding ends in a recovery action with a rand value.</>:<>No paid claims inside findings, so nothing to recover from this file.</>}</p>
 {data.recovery_candidates.length>0&&<div className="network-flags">{data.recovery_candidates.map((c,i)=><article key={c.subject}><span className="network-badge">Recover</span><h4>Recover up to {formatZar(c.paid_zar)}</h4><p><strong>{c.subject}</strong> · {c.claims.length} claim(s): {c.claims.join(', ')}</p><p><strong>Why:</strong> {c.rules.join('; ')}.</p><details><summary>Recovery plan, step by step</summary><ol className="network-links"><li>Trace free first with the <a href="#tracing-sources">tracing sources</a> below: confirm who received the money and where they are.</li><li>Confirm the finding with the evidence pack: match the claim rows to the payment runs before anyone is accused of anything.</li><li>Send the case to the Recovery Desk. The recoveries lead adds asset and employment details, and the desk works out the net recoverable value and the cheapest route.</li><li>A human makes every decision. Nothing here contacts anyone, stops a payment or starts legal action on its own.</li></ol><p><button type="button" className="network-cta" onClick={()=>sendToRecovery(c,i)}>Send to Recovery Desk</button> <small>Opens the Recovery Desk with this case prefilled. Registering a case needs the Forensics lead or Legal / Recoveries view.</small></p></details></article>)}</div>}
 {sentCase&&<p className="network-muted">Prefilled for the Recovery Desk: {sentCase}. Complete the asset fields there and register.</p>}
 </section>
 <section className="network-box" id="death-checklist"><h3>Verify a death</h3><p className="network-safety">Free checks first · Home Affairs decides</p><ol className="network-links">{data.death_checklist.map(s=><li key={s.step}><details><summary>{s.step}<span className={costClass(s.cost)}>{s.cost}</span></summary><p>{s.detail}</p><small>{s.source}{s.url?<> · <a href={s.url} target="_blank" rel="noreferrer">open source</a></>:null}</small></details></li>)}</ol></section>
 <section className="network-box" id="tracing-sources"><h3>Tracing sources</h3><p className="network-safety"><mark>Free first</mark> · fee sources marked</p><ol className="network-links">{data.tracing_sources.map(s=><li key={s.name}><details><summary>{s.name}<span className={costClass(s.cost)}>{s.cost}</span></summary><p><a href={s.url} target="_blank" rel="noreferrer">{s.url.replace('https://','')}</a></p><p>{s.what}</p><p className="network-muted">{s.use}</p></details></li>)}</ol></section>
 <details className="network-box"><summary>Limits</summary><ul>{data.limits.map(x=><li key={x}>{x}</li>)}</ul></details>
 </>}
 {!data&&!busy&&!error&&<p className="network-muted">Load the sample or upload a claims file to see findings.</p>}
 {busy&&<p role="status">Analysing claims file...</p>}
 </div>;
}
