import express from 'express';
import path from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync}from'node:fs';
import {createHash,randomUUID}from'node:crypto';
import {executionAuth,reviewerSecret}from'./executionAuth';
import {Scheduler,SYNTHETIC_LABEL,canonical}from'./scheduler';
import {schedulerRoutes}from'./schedulerRoutes';
import {SynthChat,synthChatRoutes}from'./synthChat';
import {AddressEvidence,ADDRESS_CATALOG,ADDRESS_DISCLAIMER}from'./addressEvidence';
import {CLAIM_AGENT_REGISTRY,buildDeterministicClaimAnalysis,NON_NEGOTIABLE_AGENT_RULES}from'../src/lib/engine/claimsAgents';
import {ADAPTER_INVENTORY}from'../src/lib/adapters';
import {verifyEvidenceChain}from'../src/lib/engine/vault';
import type{NahaShieldStore}from'./store';
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
export function executionRoutes(store:NahaShieldStore){
 const root=process.env.EXECUTION_DATA_DIR||path.resolve('.data/execution');mkdirSync(root,{recursive:true});
 const auth=executionAuth(root),r=express.Router(),address=new AddressEvidence(path.join(root,'address'));
 const chatFile=path.join(root,'chat.json');
 const chat=new SynthChat({sink:async e=>{writeFileSync(chatFile+'.tmp',JSON.stringify({threads:[...chat.threads],messages:[...chat.messages],audit:chat.audit}));const{renameSync}=await import('node:fs');renameSync(chatFile+'.tmp',chatFile);await store.logAudit({actor_role:'head_of_forensics',actor_id:e.actor_id,action:e.action,object_type:'claim',object_id:e.object_id,details:e.details})}});
 if(existsSync(chatFile)){const saved=JSON.parse(readFileSync(chatFile,'utf8'));chat.threads=new Map(saved.threads);chat.messages=new Map(saved.messages);chat.audit=saved.audit;if(!chat.verifyAudit().valid)throw Error('CHAT_AUDIT_INVALID');}

 const scheduler=new Scheduler({journalPath:path.join(root,'scheduler.jsonl'),deps:{chat,address},allowExternalWrites:false,onAudit:async e=>{await store.logAudit({actor_role:'head_of_forensics',actor_id:e.actor,action:'EXECUTION_'+e.type,object_type:'claim',object_id:e.jobId,details:{seq:e.seq,hash:e.hash}})}});
 const approver=(req:express.Request)=>{const s=(req as any).reviewer;return s?.role==='CFO'?null:s?{id:s.principal,role:'head_of_forensics' as const}:null};
 async function memo(id:string,fn:()=>Promise<any>){const f=path.join(root,'step-'+id+'.json');if(existsSync(f))return JSON.parse(readFileSync(f,'utf8'));const x=await fn();writeFileSync(f+'.tmp',JSON.stringify(x));const{renameSync}=await import('node:fs');renameSync(f+'.tmp',f);return x}
 const validation=(p:any)=>{if(!/^SYN-[A-Z0-9-]+$/.test(p.case_ref)||typeof p.outcome!=='string'||p.outcome.length>4000)throw Error('Synthetic claim and outcome required');if(!['full','portal','address','review','communications'].includes(p.mode))throw Error('MODE_DENIED');if(!ADDRESS_CATALOG.some(x=>x.id===p.landmark_id))throw Error('LANDMARK_DENIED')};
 scheduler.registerHandler({id:'claims.investigation',version:'1.0',validate:validation,steps:[
 {name:'specialists',kind:'read',run:async c=>memo(c.idempotencyKey,async()=>{
  const snapshot=store.getSnapshot();const claim=snapshot.claims_preview.find(x=>x.claim_id===c.params.case_ref);if(!claim)return{status:'UNKNOWN',reason:'No authorised synthetic claim record with that exact ID',findings:[],completed:false};
  const results=CLAIM_AGENT_REGISTRY.map(a=>{const x=buildDeterministicClaimAnalysis({claim,agentId:a.id,userPrompt:c.params.outcome,relatedEvidence:snapshot.evidence_items.filter(e=>e.case_ref===claim.claim_id),relatedPolicies:snapshot.consent_policies,relatedRecoveryCases:snapshot.recovery_cases,adapters:ADAPTER_INVENTORY,referenceNowIso:new Date().toISOString()});return{agent:a.name,id:a.id,provider:'deterministic source/rule analysis, not LLM research',brief:x.brief,proposals:x.proposals}});
  return{status:'DERIVED',case_ref:claim.claim_id,results,unavailable:['Authoritative death registry verification','Insurer policy portal','Live banking verification'],human_review_required:true};
 })},
 {name:'group',kind:'draft',run:async c=>memo(c.idempotencyKey,async()=>{const t=await chat.createThread({channel:'group_sim',case_id:c.params.case_ref,claimant_handle:'syn-investigator',agent_ids:CLAIM_AGENT_REGISTRY.map(a=>a.id)});const inbound=await chat.inbound(t.id,{text:(SYNTHETIC_LABEL+'. '+c.params.outcome).slice(0,1000)});return{thread:t,drafts:inbound.drafts,note:'Synthetic group, human reviewer must join. Drafts do not count as approved findings.'}})},
 {name:'public_address',kind:'read',run:async c=>c.params.mode==='address'||c.params.mode==='full'?memo(c.idempotencyKey,()=>address.lookup(c.params.case_ref,c.params.landmark_id)):{status:'not_requested'}},
 {name:'visual_captures',kind:'read',timeoutMs:90000,run:async c=>{
  const report=c.outputs.public_address as any;if(!report?.id)return{status:'not_requested'};
  return memo(c.idempotencyKey,async()=>{
   const endpoint=process.env.CAPTURE_EXECUTOR_URL||'http://127.0.0.1:4330';const u=new URL(endpoint);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('LOOPBACK_EXECUTOR_REQUIRED');
   const appOrigin=process.env.PORTAL_ORIGIN||'http://127.0.0.1:4311';const origin=new URL(appOrigin);if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('LOOPBACK_MAP_REQUIRED');
   const targets=[{label:'surrounding-area',url:appOrigin+'/map-preview?lat='+report.place.lat+'&lon='+report.place.lon+'&zoom=13'},{label:'close-map',url:appOrigin+'/map-preview?lat='+report.place.lat+'&lon='+report.place.lon+'&zoom=17'},...report.photos.filter((p:any)=>p.binary_sha256).slice(0,1).map((p:any)=>({label:'street-image',url:p.source_url,photo:p}))];
   try{const response=await fetch(endpoint+'/jobs',{method:'POST',headers:{'content-type':'application/json'},signal:c.signal,body:JSON.stringify({actions:targets.map((t:any)=>({tool:'capture_url',arguments:{url:t.url,name:t.label+'.png',wait_ms:4000}}))})});if(!response.ok)throw Error('CAPTURE_HTTP_'+response.status);const out=await response.json()as any;const captures=[];
    for(const [index,step]of out.steps.entries()){if(step.isError)continue;let shot;try{shot=JSON.parse(step.text)}catch{continue}if(!shot.filename||!shot.sha256)continue;const raw=await fetch(endpoint+'/jobs/'+out.job_id+'/artifacts/'+encodeURIComponent(shot.filename),{signal:c.signal});if(!raw.ok)throw Error('ARTIFACT_DOWNLOAD_FAILED');const bytes=Buffer.from(await raw.arrayBuffer());if(sha(bytes)!==shot.sha256)throw Error('ARTIFACT_HASH_MISMATCH');const filename=shot.sha256+'.png';writeFileSync(path.join(root,'address',filename),bytes);captures.push({...shot,filename,label:targets[index].label,original_provider_metadata:targets[index].photo||null,attribution:targets[index].photo?.attribution||'OpenFreeMap © OpenMapTiles. Data from OpenStreetMap',licence:targets[index].photo?.licence||'OpenStreetMap data ODbL, style MIT',exact_address_match:'UNKNOWN'});}
    report.captures=captures;writeFileSync(path.join(root,'address',report.id+'.json'),JSON.stringify(report,null,2));return{status:captures.length?'captured_unverified':'UNKNOWN',report_id:report.id,captures,errors:out.steps.filter((x:any)=>x.isError),submitted:false};
   }catch(e){return{status:'UNKNOWN',completed:false,reason:String(e),submitted:false}}
  });
 }},
 {name:'portal_draft',kind:'draft',run:async c=>{
  if(!['full','portal'].includes(c.params.mode))return{status:'not_requested'};
  return memo(c.idempotencyKey,async()=>{
   const endpoint=process.env.CAPTURE_EXECUTOR_URL||'http://127.0.0.1:4330';const u=new URL(endpoint);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('LOOPBACK_EXECUTOR_REQUIRED');
   try{const out=await fetch(endpoint+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actions:[{tool:'open_case',arguments:{case_id:'SYN-RC-004'}},{tool:'click_button',arguments:{name:'Generate Attorney / AFU Handover Pack'}},{tool:'fill_draft_field',arguments:{field:'decision-action',value:'DRAFT ONLY: request missing evidence'}},{tool:'fill_draft_field',arguments:{field:'decision-reasons',value:'SYNTHETIC / FICTIONAL TEST DATA. Review original sources. No fraud or claim decision.'}},{tool:'fill_draft_field',arguments:{field:'decision-note',value:'DRAFT ONLY. Human review required.'}},{tool:'save_checkpoint',arguments:{}},{tool:'request_final_submission',arguments:{}}]}),signal:c.signal});if(!out.ok)throw Error('EXECUTOR_HTTP_'+out.status);const j=await out.json()as any;return{...j,status:j.steps?.some((x:any)=>x.isError)?'blocked':'awaiting_human_approval',synthetic_portal_case:'SYN-RC-004',not_claim_portal_for:c.params.case_ref,submitted:false}}
   catch(e){return{status:'UNKNOWN',completed:false,submitted:false,reason:'Synthetic browser executor unavailable: '+String(e)}}
  })}},
 {name:'consolidated_report',kind:'draft',run:c=>({status:'ADVISORY_DRAFT',case_ref:c.params.case_ref,sections:c.outputs,labels:['VERIFIED','DERIVED','INFERRED','DISPUTED','UNKNOWN'],rules:NON_NEGOTIABLE_AGENT_RULES,external_sent:false,claim_status_changed:false,cash_recovered:0,needs_human_review:true})},
 {name:'human_approval_centre',kind:'external_write',run:()=>({not_executed:true})}
 ]});scheduler.start(1000);
 r.use(auth.router); // login is public; every later route has the one session guard.
 r.get('/catalog',(_q,res)=>res.json({claims:store.getSnapshot().claims_preview.map(c=>({id:c.claim_id})),landmarks:ADDRESS_CATALOG,agents:CLAIM_AGENT_REGISTRY,modes:['full','portal','address','review','communications'],synthetic_only:true,external_connectors:false,role_headers_authorize:false}));
 r.use('/scheduler',schedulerRoutes(scheduler,q=>(q as any).reviewer?.principal||null));
 r.use('/chat',synthChatRoutes(chat,{authorize:approver}));
 r.get('/state',(_q,res)=>res.json({jobs:scheduler.list(),audit:scheduler.verifyAudit(),threads:[...chat.threads.values()],chat_audit:chat.verifyAudit(),runner:'loopback-only; per-job status is source of truth'}));
 const wrap=(fn:(q:express.Request)=>Promise<any>|any):express.RequestHandler=>async(q,res)=>{try{res.json(await fn(q))}catch(e){res.status(400).json({error:e instanceof Error?e.message:'REQUEST_FAILED'})}};
 r.post('/command',wrap(q=>{
  const p=q.body||{};const outcome=String(p.outcome||'').trim();if(!outcome)throw Error('OUTCOME_REQUIRED');if(outcome.length>4000)throw Error('OUTCOME_TOO_LONG');
  // Catalogue routing only. A displayed mode is explicit; unsupported live effects remain disabled.
  const mode=p.mode||(/map|address|street|geospatial/i.test(outcome)?'address':/portal|browser|form/i.test(outcome)?'portal':'full');
  const params={dataset_label:SYNTHETIC_LABEL,case_ref:p.case_ref,outcome,mode,landmark_id:p.landmark_id||'constitution-hill'};validation(params);
  if(/every|daily|morning|friday|06:00/i.test(outcome)&&!p.run_at_ms&&!p.every_ms)throw Error('SCHEDULE_NEEDS_EXPLICIT_TIME: choose a date/time and interval before scheduling; natural-language time is not silently guessed');
  const job=scheduler.submit({handler:'claims.investigation',params,idempotencyKey:String(p.idempotency_key||randomUUID()),runAt:p.run_at_ms,everyMs:p.every_ms,maxRuns:p.max_runs},(q as any).reviewer.principal);void scheduler.tick();return{job,routing:{mode,agents:CLAIM_AGENT_REGISTRY.map(a=>a.name),method:'bounded catalogue routing; deterministic specialists, not a general autonomous computer'},external_sent:false,claim_status_changed:false};
 }));
 async function executor(actions:any[]){const endpoint=process.env.CAPTURE_EXECUTOR_URL||'http://127.0.0.1:4330';const u=new URL(endpoint);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('LOOPBACK_EXECUTOR_REQUIRED');const response=await fetch(endpoint+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actions}),signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('EXECUTOR_HTTP_'+response.status);return response.json()as Promise<any>}
 r.get('/skills',wrap(async()=>{const out=await executor([{tool:'list_skills',arguments:{}}]);if(out.steps[0]?.isError)throw Error(out.steps[0].text);return{skills:JSON.parse(out.steps[0].text),external_action:false}}));
 r.post('/skills/:id/approve-replay',wrap(async q=>{
  const out=await executor([{tool:'list_skills',arguments:{}}]);const skills=JSON.parse(out.steps[0].text);const skill=skills.find((s:any)=>s.skill_id===q.params.id);if(!skill||skill.steps_digest!==q.body?.digest)throw Error('SKILL_DIGEST_MISMATCH');const action={type:'SKILL_REPLAY',claim_ref:'SYN-RC-004',digest:skill.steps_digest};const token=auth.security.approve(reviewerSecret(q),q.header('x-csrf-token'),action);auth.security.consume(token,action);const result=await executor([{tool:'replay_skill',arguments:{skill_id:skill.skill_id,approval_token:token}}]);return{...result,submitted:false,external_sent:false};
 }));
 r.post('/address',wrap(q=>address.lookup(q.body?.case_ref,q.body?.landmark_id)));
 r.get('/address/:id',wrap(q=>address.get(String(q.params.id))));
 r.get('/address/:id/original/:hash',(q,res)=>{try{const x=address.original(String(q.params.id),String(q.params.hash));res.type('image/jpeg').send(x.bytes)}catch(e){res.status(404).json({error:String(e)})}});
 r.post('/address/:id/approve-seal',wrap(async q=>{
  const report=address.get(String(q.params.id)),digest=sha(canonical(report));if(q.body?.digest!==digest)throw Error('REPORT_DIGEST_MISMATCH');
  const action={type:'SEAL_EXECUTION_EVIDENCE',claim_ref:report.case_ref,digest};const token=auth.security.approve(reviewerSecret(q),q.header('x-csrf-token'),action);const approval=auth.security.consume(token,action);
  const title='Public visual context '+report.id;const prior=store.getSnapshot().evidence_items.find(e=>e.title===title);if(prior)return{item:prior,already_recorded:true};
  const originals=report.photos.filter((p:any)=>p.binary_sha256).map((p:any)=>({sha256:p.binary_sha256,url:'/api/execution/address/'+report.id+'/original/'+p.binary_sha256}));
  const item=await store.appendEvidence({case_ref:report.case_ref,title,content_summary:JSON.stringify({report,originals,approval,disclaimer:ADDRESS_DISCLAIMER}),evidence_tag:'Documented Allegation',source_adapter:'Photon/OpenStreetMap + KartaView; exact address unverified',uploader_id:(q as any).reviewer.principal,actor_role:'head_of_forensics',access_authority:'Owner-authorised public fictional landmark test only; human reviewed internal record'});
  return{item,originals,verification:verifyEvidenceChain(store.getSnapshot().evidence_items),cash_recovered:0};
 }));
 r.get('/address/:id/capture/:hash',(q,res)=>{try{const report=address.get(String(q.params.id));const shot=report.captures?.find((x:any)=>x.sha256===q.params.hash);if(!shot)throw Error('CAPTURE_NOT_FOUND');const bytes=readFileSync(path.join(root,'address',shot.filename));if(sha(bytes)!==shot.sha256)throw Error('CAPTURE_HASH_MISMATCH');res.type('image/png').send(bytes)}catch(e){res.status(404).json({error:String(e)})}});
 r.get('/address/:id/digest',wrap(q=>({digest:sha(canonical(address.get(String(q.params.id))))})));
 return r;
}
