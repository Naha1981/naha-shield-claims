// A human-approved, fixed synthetic workflow. Never interprets free-text commands.
import fs from'node:fs';import path from'node:path';import{spawn}from'node:child_process';
const root=process.cwd(),repo=path.resolve('..'),request=process.env.SYNTHETIC_REQUEST_ID,kind=process.env.SYNTHETIC_BATCH_KIND;
if(!/^[a-f0-9-]{36}$/.test(request||'')||!['portal_draft','public_map'].includes(kind))throw Error('BATCH_INPUT_DENIED');
const output=path.join(root,'evidence');fs.mkdirSync(output,{recursive:true});
const log=fs.openSync(path.join(output,'batch-local.log'),'a');const app=spawn(path.join(repo,'node_modules/.bin/tsx'),['server.ts'],{cwd:repo,env:{...process.env,PORT:'4311',NODE_ENV:'production',GEMINI_API_KEY:''},stdio:['ignore',log,log]});
let child;try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:4311/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!ready)throw Error('SYNTHETIC_APP_UNAVAILABLE');
 child=spawn(process.execPath,['computer-mcp.mjs'],{cwd:root,env:{...process.env,WORKER_ROOT:root,PORTAL_RUNNER_MODE:kind==='public_map'?'capture':'portal',PORTAL_ORIGIN:'http://127.0.0.1:4311',PORTAL_RUNNER_CAPTURE_ORIGINS:'http://127.0.0.1:4311,https://tiles.openfreemap.org',PORTAL_RUNNER_CHROME:'/nonexistent/use-playwright'},stdio:['pipe','pipe','inherit']});let seq=0,buf='';const pending=new Map();child.stdout.on('data',b=>{buf+=b;for(;;){const i=buf.indexOf('\n');if(i<0)break;const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const j=JSON.parse(line);pending.get(j.id)?.(j);pending.delete(j.id)}});
 const tool=(name,args={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error('BROWSER_TIMEOUT')),60000);pending.set(id,j=>{clearTimeout(t);const r=j.result;if(r?.isError)reject(Error(r.content?.[0]?.text||'BROWSER_FAILED'));else resolve({name,result:r.content?.[0]?.text})});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n')});
 const steps=[];
 if(kind==='portal_draft'){
  steps.push(await tool('open_case',{case_id:'SYN-RC-004'}));steps.push(await tool('click_button',{name:'Generate Attorney / AFU Handover Pack'}));steps.push(await tool('fill_draft_field',{field:'decision-action',value:'DRAFT ONLY: request missing evidence'}));steps.push(await tool('fill_draft_field',{field:'decision-reasons',value:'SYNTHETIC / FICTIONAL TEST DATA. Human review required. No fraud finding.'}));steps.push(await tool('fill_draft_field',{field:'decision-note',value:'Human approved this synthetic draft run. Do not submit.'}));steps.push(await tool('save_checkpoint'));steps.push(await tool('request_final_submission'));
 }else{
  for(const [label,zoom]of[['wide',13],['close',17]])steps.push(await tool('capture_url',{url:'http://127.0.0.1:4311/map-preview?lat=-26.1885859&lon=28.0425438&zoom='+zoom,name:'map-'+label+'.png',wait_ms:5000}));
 }
 fs.writeFileSync(path.join(output,'batch-result.json'),JSON.stringify({request_id:request,kind,status:'awaiting_human_review',synthetic_case:'SYN-RC-004',human_approved_dispatch:true,test_driver_approvals:false,submitted:false,external_sent:false,claim_status_changed:false,steps,completed_at:new Date().toISOString()},null,2));console.log('SYNTHETIC_BATCH_COMPLETE',request,kind,'submitted:false');
}finally{child?.kill();app.kill()}
