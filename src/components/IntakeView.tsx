import React from 'react';
import {formatZar} from '../utils/format';
import {FileCheckCard} from './RetrospectiveLeakageView';
import type {IngestReport} from '../lib/engine/claimsFileIngest';
import type {NavRoute} from './LayoutShell';
import type {RoleId} from '../lib/engine/types';

// Insurer intake: one screen to bring claims in by file (CSV, Excel, PDF,
// scan), by API pull, or by webhook push, driven by connector profiles. Every
// result feeds the same leakage-to-recovery analysis. Status and errors are
// plain language; the intake log never carries personal data.

type ProfileCard={id:string;label:string;insurer:string;protocol:string;status:string;auth_type:string;paging:string;schedule:{enabled:boolean;interval_minutes:number};webhook_path:string;webhook_secret_configured:boolean;notes:string;custom:boolean};
type IntakeEvent={at:string;kind:string;source:string;status:string;claims:number;findings:number;flagged_zar:number;message:string};
type AnalysisResult={file_name:string;synthetic:boolean;format?:string;sheet_name?:string;pages_read?:number;ingest_report?:IngestReport;summary:{claims_analysed:number;total_paid_zar:number;findings_count:number;flagged_paid_zar:number};[k:string]:unknown};

const time=(iso:string)=>{try{return new Date(iso).toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'});}catch{return iso;}};

async function postJson(url:string,role:RoleId,body:unknown){
 let code='';try{code=localStorage.getItem('nahashield-access-code')??'';}catch{/* unavailable */}
 const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-nahashield-role':role,...(code?{'x-nahashield-access-code':code}:{})},body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error((data as {error?:string}).error||`Request failed (${res.status})`);
 return data;
}
async function getJson(url:string,role:RoleId){
 let code='';try{code=localStorage.getItem('nahashield-access-code')??'';}catch{/* unavailable */}
 const res=await fetch(url,{headers:{'x-nahashield-role':role,...(code?{'x-nahashield-access-code':code}:{})}});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error((data as {error?:string}).error||`Request failed (${res.status})`);
 return data;
}

export function IntakeView({onNavigate,activeRole}:{onNavigate?:(route:NavRoute)=>void;activeRole:RoleId}){
 const[loginOn,setLoginOn]=React.useState<boolean|null>(null);
 const[profiles,setProfiles]=React.useState<ProfileCard[]>([]);
 const[events,setEvents]=React.useState<IntakeEvent[]>([]);
 const[result,setResult]=React.useState<AnalysisResult|null>(null);
 const[error,setError]=React.useState('');
 const[busy,setBusy]=React.useState('');
 const[testResults,setTestResults]=React.useState<Record<string,string>>({});
 const[baseUrls,setBaseUrls]=React.useState<Record<string,string>>({});
 const[form,setForm]=React.useState({id:'',label:'',protocol:'rest_json',base_url:'',auth_type:'none',auth_header:'',auth_env:'',claims_path:'/claims',list_key:'',field_map:'',paging:'none'});

 const refresh=React.useCallback(async()=>{
  try{
   const[p,l,h]=await Promise.all([
    getJson('/api/intake/profiles',activeRole) as Promise<{profiles:ProfileCard[]}>,
    getJson('/api/intake/log',activeRole) as Promise<{events:IntakeEvent[]}>,
    getJson('/api/health',activeRole) as Promise<{login_on?:boolean}>,
   ]);
   setProfiles(p.profiles);setEvents(l.events);setLoginOn(Boolean(h.login_on));
   setBaseUrls(prev=>{const next={...prev};for(const pr of p.profiles)if(!next[pr.id])next[pr.id]=`${window.location.origin}/api/mock-insurer/${pr.id}`;return next;});
  }catch(e){setError((e as Error).message);}
 },[activeRole]);
 React.useEffect(()=>{void refresh();},[refresh]);

 const showResult=(r:AnalysisResult)=>{setResult(r);setError('');};
 const run=async(key:string,fn:()=>Promise<void>)=>{setBusy(key);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy('');void refresh();}};

 const onFile=(e:React.ChangeEvent<HTMLInputElement>)=>{
  const f=e.target.files?.[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=()=>void run('file',async()=>{
   const b64=String(reader.result||'').split(',')[1]||'';
   if(/\.(csv)$/i.test(f.name)){
    const text=atob(b64);
    showResult(await postJson('/api/leakage/analyse',activeRole,{csv:text,file_name:f.name}) as AnalysisResult);
   }else if(/\.(xlsx|xlsm)$/i.test(f.name)){
    showResult(await postJson('/api/leakage/analyse-file',activeRole,{file_name:f.name,content_base64:b64}) as AnalysisResult);
   }else{
    showResult(await postJson('/api/intake/file',activeRole,{file_name:f.name,content_base64:b64}) as AnalysisResult);
   }
  });
  reader.onerror=()=>setError('Could not read the file from this device.');
  reader.readAsDataURL(f);
 };

 const testConnection=(p:ProfileCard)=>void run('test-'+p.id,async()=>{
  const r=await postJson('/api/intake/test-connection',activeRole,{profile_id:p.id,base_url:baseUrls[p.id]||''}) as {ok:boolean;message:string};
  setTestResults(prev=>({...prev,[p.id]:(r.ok?'✓ ':'✗ ')+r.message}));
 });
 const pull=(p:ProfileCard)=>void run('pull-'+p.id,async()=>{
  showResult(await postJson('/api/intake/fetch',activeRole,{profile_id:p.id,base_url:baseUrls[p.id]||''}) as AnalysisResult);
 });
 const testPush=(p:ProfileCard)=>void run('push-'+p.id,async()=>{
  const feed=await getJson(baseUrls[p.id]+(p.id==='momentum'?'/claims?limit=3':'/claims?pageSize=3'),activeRole) as Record<string,unknown>;
  const list=(Array.isArray(feed)?feed:(feed.claims??feed.data??[])) as unknown[];
  showResult(await postJson(`/api/intake/webhook/${p.id}`,activeRole,list) as AnalysisResult);
 });

 const addConnector=()=>void run('add',async()=>{
  const field_map:Record<string,string>={};
  for(const line of form.field_map.split('\n')){
   const eq=line.indexOf('=');if(eq<1)continue;
   field_map[line.slice(0,eq).trim()]=line.slice(eq+1).trim();
  }
  const auth=form.auth_type==='none'?{type:'none'}:form.auth_type==='api_key_header'?{type:'api_key_header',header:form.auth_header,env_var:form.auth_env}:form.auth_type==='bearer'?{type:'bearer',env_var:form.auth_env}:{type:'basic',username_env:form.auth_env.split(':')[0]||'',password_env:form.auth_env.split(':')[1]||''};
  const paging=form.paging==='none'?{style:'none'}:form.paging==='page_param'?{style:'page_param',page_param:'page',size_param:'pageSize',page_size:500,max_pages:20}:{style:'offset_param',offset_param:'offset',limit_param:'limit',page_size:500,max_pages:20};
  await postJson('/api/intake/profiles',activeRole,{profile:{id:form.id,label:form.label,insurer:form.label,protocol:form.protocol,status:'config-only',auth,claims_path:form.claims_path,claims_list_key:form.list_key,field_map,paging,schedule:{enabled:false,interval_minutes:1440},webhook_secret_env:'',notes:'Added by configuration in the Intake screen.'}});
  if(form.base_url)setBaseUrls(prev=>({...prev,[form.id]:form.base_url}));
 });

 const openInLeakage=()=>{
  if(!result)return;
  try{localStorage.setItem('nahashield-intake-analysis',JSON.stringify(result));}catch{/* unavailable */}
  onNavigate?.('/leakage');
 };

 return <div className="network-page"><header><span className="network-kicker">INSURER INTAKE</span><h2>Bring claims in</h2><p className="network-sub">Files, APIs and webhooks. Every route feeds the <mark>leakage check</mark> and the <mark>recovery desk</mark>.</p>
 {loginOn===null?<p className="network-safety">Checking sign-in state...</p>:loginOn?<p className="network-safety">Sign-in is ON. Real insurer data may come in once Thabiso agrees.</p>:<p className="network-safety"><mark>Sign-in is OFF</mark> (one server switch turns it on). Real insurer data should only go in once sign-in is ON and Thabiso agrees.</p>}
 </header>

 <section className="network-box"><h3>Upload a file</h3><div className="network-controls"><label>CSV, Excel, PDF or scan<input aria-label="Upload claims file, PDF or scan" type="file" accept=".csv,.xlsx,.xlsm,.pdf,.png,.jpg,.jpeg,.webp,.tiff,.tif" onChange={onFile} disabled={busy==='file'}/></label></div><p className="network-muted">PDFs are read from their text layer; scans and photos are read with open-source OCR on this server. Files are analysed in memory and discarded.</p></section>

 <section className="network-box"><h3>Connectors</h3><p className="network-muted">A new insurer is configuration, not code: endpoint, sign-in type, field names, paging. Each connector has a test button with a plain answer.</p>
 {profiles.map(p=><article key={p.id} className="network-box"><h4>{p.label} <span className="network-badge">{p.status==='mock-proven'?'Proven on mock feed':'Config only'}</span></h4>
 <p className="network-muted">{p.insurer} · {p.protocol==='rest_json'?'pulls claims over REST':p.protocol==='file_url'?'pulls claim files over HTTPS':'receives webhook pushes'} · sign-in: {p.auth_type} · paging: {p.paging} · scheduled pulls: {p.schedule.enabled?`every ${p.schedule.interval_minutes} min`:'off'}</p>
 <label>Endpoint<input aria-label={`Endpoint for ${p.label}`} value={baseUrls[p.id]??''} onChange={e=>setBaseUrls(prev=>({...prev,[p.id]:e.target.value}))}/></label>
 <p><button type="button" className="network-cta" disabled={busy==='test-'+p.id} onClick={()=>testConnection(p)}>{busy==='test-'+p.id?'Testing...':'Test connection'}</button>{' '}<button type="button" disabled={busy==='pull-'+p.id} onClick={()=>pull(p)}>{busy==='pull-'+p.id?'Pulling...':'Pull claims'}</button>{' '}<button type="button" disabled={busy==='push-'+p.id} onClick={()=>testPush(p)}>{busy==='push-'+p.id?'Pushing...':'Test a webhook push'}</button></p>
 {testResults[p.id]&&<p role="status">{testResults[p.id]}</p>}
 <details className="network-info"><summary>Webhook and sign-in details</summary><p className="network-muted">Insurers push claims to <code>{p.webhook_path}</code>. {p.webhook_secret_configured?'A shared secret is configured; pushes without it are rejected.':'No shared secret is configured yet (demo mode).'} {p.notes}</p></details>
 </article>)}
 <details className="network-info"><summary>Add an insurer by configuration</summary>
 <div className="network-controls">
 <label>Short id (lowercase)<input aria-label="Connector id" value={form.id} onChange={e=>setForm({...form,id:e.target.value.toLowerCase()})} placeholder="acme-life"/></label>
 <label>Name<input aria-label="Connector name" value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="Acme Life"/></label>
 <label>Type<select aria-label="Protocol" value={form.protocol} onChange={e=>setForm({...form,protocol:e.target.value})}><option value="rest_json">REST pull (JSON)</option><option value="webhook">Webhook push</option><option value="file_url">File drop over HTTPS</option></select></label>
 <label>Endpoint<input aria-label="Endpoint" value={form.base_url} onChange={e=>setForm({...form,base_url:e.target.value})} placeholder="https://api.insurer.example/v1"/></label>
 <label>Sign-in<select aria-label="Auth type" value={form.auth_type} onChange={e=>setForm({...form,auth_type:e.target.value})}><option value="none">None</option><option value="api_key_header">API key header</option><option value="bearer">Bearer token</option><option value="basic">Basic</option></select></label>
 {form.auth_type==='api_key_header'&&<><label>Header name<input aria-label="Auth header" value={form.auth_header} onChange={e=>setForm({...form,auth_header:e.target.value})} placeholder="x-api-key"/></label><label>Server env var holding the key<input aria-label="Auth env var" value={form.auth_env} onChange={e=>setForm({...form,auth_env:e.target.value})} placeholder="ACME_API_KEY"/></label></>}
 {(form.auth_type==='bearer'||form.auth_type==='basic')&&<label>Server env var(s)<input aria-label="Auth env var" value={form.auth_env} onChange={e=>setForm({...form,auth_env:e.target.value})} placeholder={form.auth_type==='bearer'?'ACME_TOKEN':'ACME_USER:ACME_PASS'}/></label>}
 <label>Claims path<input aria-label="Claims path" value={form.claims_path} onChange={e=>setForm({...form,claims_path:e.target.value})} placeholder="/claims"/></label>
 <label>JSON list key<input aria-label="List key" value={form.list_key} onChange={e=>setForm({...form,list_key:e.target.value})} placeholder="claims (blank = payload is the list)"/></label>
 <label>Paging<select aria-label="Paging" value={form.paging} onChange={e=>setForm({...form,paging:e.target.value})}><option value="none">None</option><option value="page_param">page / pageSize</option><option value="offset_param">offset / limit</option></select></label>
 <label>Field mapping (one per line: theirs=ours)<textarea aria-label="Field mapping" rows={4} value={form.field_map} onChange={e=>setForm({...form,field_map:e.target.value})} placeholder={'claimNumber=claim_ref\npaidAmount=amount_zar\nlossDate=claim_date'}/></label>
 </div>
 <p><button type="button" className="network-cta" disabled={busy==='add'||!form.id||!form.label} onClick={addConnector}>{busy==='add'?'Adding...':'Add connector'}</button></p>
 <p className="network-muted">Field mapping is optional: the automatic column-name recogniser reads whatever the insurer sends. Keys and secrets live in server environment variables, never in the browser.</p>
 </details>
 </section>

 {error&&<p role="alert">{error}</p>}
 {result&&<>
 <section className="network-box"><h3>What came in</h3>
 <div className="network-stats"><span><b>{result.summary.claims_analysed}</b> claims</span><span><b>{formatZar(result.summary.total_paid_zar)}</b> paid</span><span><b>{result.summary.findings_count}</b> findings</span><span><b>{formatZar(result.summary.flagged_paid_zar)}</b> flagged</span></div>
 <p className="network-muted">{result.file_name}{result.synthetic?' (mock feed, synthetic)':''}{result.pages_read?` · ${result.pages_read} page(s) read`:''} · analysed in memory, nothing stored</p>
 <p><button type="button" className="network-cta" onClick={openInLeakage}>Open findings in Leakage check</button></p>
 </section>
 {result.ingest_report&&<FileCheckCard report={result.ingest_report} sheetName={result.sheet_name}/>}
 </>}

 <section className="network-box"><h3>Intake status</h3><p className="network-muted">Counts and rands only: no names, claim numbers or account details are logged.</p>
 {events.length===0?<p className="network-muted">Nothing has come in yet.</p>:<ul className="network-links">{events.slice(0,20).map((e,i)=><li key={i}>{time(e.at)} · {e.source} · {e.status==='ok'?'OK':'Error'} · {e.message}</li>)}</ul>}
 </section>
 </div>;
}
