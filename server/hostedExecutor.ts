import express from'express';
import{createHash,randomUUID}from'node:crypto';
import{mkdirSync,readFileSync,writeFileSync,existsSync}from'node:fs';
import path from'node:path';
// Hosted synthetic acceptance jobs, not a general remote browser proxy.
const REPO='Naha1981/naha-shield-claims',WORKFLOW='synthetic-executor-proof.yml';
export function hostedExecutorRoutes(authorize:(q:express.Request)=>{id:string;role:string}|null){
 const r=express.Router(),root=path.resolve('.data/hosted-executor');mkdirSync(root,{recursive:true});
 const token=()=>{const t=process.env.GITHUB_ACTIONS_TOKEN;if(!t)throw Error('HOSTED_EXECUTOR_NEEDS_SETUP');return t};
 const ref=()=>{const v=process.env.HOSTED_EXECUTOR_APPROVED_REF;if(!v||!/^review\/[a-z0-9-]+$/.test(v))throw Error('APPROVED_REVIEW_REF_NEEDS_SETUP');return v};
 async function github(p:string,body?:unknown){const response=await fetch('https://api.github.com/repos/'+REPO+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token(),accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('GITHUB_HTTP_'+response.status);return response.status===204?null:response.json()as Promise<any>}
 r.use((q,res,next)=>{res.setHeader('Cache-Control','no-store');const p=authorize(q);if(!p)return res.status(401).json({error:'AUTH_REQUIRED'});if(q.method!=='GET'&&(p.role==='finance_cfo'||q.headers.origin!==`${q.protocol}://${q.get('host')}`))return res.status(403).json({error:'READ_ONLY_OR_SAME_ORIGIN_REQUIRED'});(q as any).principal=p;next()});
 const wrap=(f:(q:express.Request)=>Promise<any>):express.RequestHandler=>async(q,res)=>{try{res.json(await f(q))}catch(e){res.status(400).json({error:e instanceof Error?e.message:'HOSTED_EXECUTOR_FAILED'})}};
 r.get('/status',wrap(async()=>({configured:Boolean(process.env.GITHUB_ACTIONS_TOKEN&&process.env.HOSTED_EXECUTOR_APPROVED_REF),mode:'on_demand_synthetic_acceptance_only',not_a_live_insurer_connector:true,real_human_workflow:false,workflow:WORKFLOW})));
 r.post('/approve-test',wrap(async q=>{
  if(q.body?.approve!==true||q.body?.acknowledge_synthetic_test_driver!==true)throw Error('EXPLICIT_SYNTHETIC_TEST_APPROVAL_REQUIRED');
  const branch=ref();const branchState=await github('/git/ref/heads/'+branch);if(q.body?.review_sha!==branchState.object.sha)throw Error('APPROVED_COMMIT_CHANGED');const current=await github('');if(current.visibility!=='public')throw Error('FREE_PUBLIC_REPO_REQUIRED');
  const workflow=await github('/actions/workflows/'+WORKFLOW);if(workflow.state!=='active')throw Error('WORKFLOW_NOT_ACTIVE');const id=randomUUID(),at=new Date().toISOString();
  const record={id,principal:(q as any).principal.id,at,ref:branch,sha:branchState.object.sha,status:'dispatching',synthetic_only:true,test_driver_approvals:true,external_sent:false,submitted:false};const f=path.join(root,id+'.json');writeFileSync(f,JSON.stringify(record));
  await github('/actions/workflows/'+WORKFLOW+'/dispatches',{ref:branch});record.status='dispatched';writeFileSync(f,JSON.stringify(record));return record;
 }));
 r.get('/runs/:id',wrap(async q=>{const id=String(q.params.id);if(!/^[a-f0-9-]{36}$/.test(id))throw Error('RUN_ID_DENIED');const f=path.join(root,id+'.json');if(!existsSync(f))throw Error('RUN_NOT_FOUND');const rec=JSON.parse(readFileSync(f,'utf8'));const rows=await github('/actions/workflows/'+WORKFLOW+'/runs?event=workflow_dispatch&per_page=30');const matches=rows.workflow_runs.filter((x:any)=>x.head_sha===rec.sha&&x.created_at>=rec.at);return{record:rec,possible_runs:matches.map((x:any)=>({id:x.id,status:x.status,conclusion:x.conclusion,url:x.html_url,sha:x.head_sha})),note:'Matching is provisional until a unique run is confirmed. Test-driver approvals are not human claim approvals.'}}));
 return r;
}
