import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore plain ESM module with runtime tests
import { ApprovalSecurity } from '../portal-runner/approval-security.mjs';
export type Reviewer = {principal:string;role:'investigator'|'reviewer'|'admin'|'CFO';csrf:string;expires:number};
export const reviewerSecret=(req:express.Request)=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('reviewer='))?.slice(9)||'';
export function executionAuth(root:string){
 const security=new ApprovalSecurity(path.join(root,'sessions.json'),{allowedActionTypes:['SEAL_EXECUTION_EVIDENCE'],allowedClaimRefs:['SYN-RC-004','SYN-CLM-001']});
 const attempts=new Map<string,{at:number;n:number}>();
 const router=express.Router();
 const origin=(req:express.Request)=>process.env.APP_ORIGIN||`${req.protocol}://${req.get('host')}`;
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method!=='GET'&&req.headers.origin!==origin(req))return res.status(403).json({error:'SAME_ORIGIN_REQUIRED'});next()});
 router.post('/login',(req,res)=>{try{
  const ip=req.ip||'local',now=Date.now();for(const[k,v]of attempts)if(now-v.at>900000)attempts.delete(k);
  const a=attempts.get(ip)||{at:now,n:0};if(a.n>=5)return res.status(429).json({error:'LOGIN_RATE_LIMIT'});a.n++;attempts.set(ip,a);
  const file=process.env.REVIEWER_CREDENTIAL_FILE||path.join(root,'reviewer-credential.json');
  const credential=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  const s=security.login(String(req.body?.username||''),String(req.body?.password||''),credential);
  attempts.delete(ip);res.cookie('reviewer',s.secret,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/',maxAge:1800000});res.json({principal:s.principal,role:s.role,csrf:s.csrf});
 }catch(e){res.status(401).json({error:e instanceof Error?e.message:'AUTH_FAILED'})}});
 const guard:express.RequestHandler=(req,res,next)=>{try{const s=security.session(reviewerSecret(req)) as Reviewer;(req as any).reviewer=s;if(req.method!=='GET'&&(s.role==='CFO'||req.header('x-csrf-token')!==s.csrf))return res.status(403).json({error:s.role==='CFO'?'READ_ONLY_ROLE':'CSRF_DENIED'});next()}catch{res.status(401).json({error:'AUTH_REQUIRED'})}};
 router.use(guard);router.get('/session',(req,res)=>res.json((req as any).reviewer));
 return{router,guard,security};
}
