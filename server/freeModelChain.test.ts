import test from 'node:test';
import assert from 'node:assert/strict';
import { runFreeModelChain } from './freeModelChain';

test('Groq is skipped unless its free plan is confirmed, OpenRouter is free-only', async () => {
  const env = { ...process.env };
  process.env.GROQ_API_KEY='synthetic-key';delete process.env.GROQ_FREE_TIER_CONFIRMED;
  process.env.OPENROUTER_API_KEY='synthetic-key';delete process.env.GEMINI_API_KEY;
  try {
    const r=await runFreeModelChain('synthetic test',async (url,init) => {
      assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
      const body=JSON.parse(init?.body as string);assert.equal(body.model,'google/gemma-4-31b-it:free');assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});
      return new Response(JSON.stringify({choices:[{message:{content:'test answer'}}],model:'test:free'}));
    });assert.equal(r.provider,'OpenRouter free');
  } finally { process.env=env; }
});
test('confirmed Groq failure moves to free OpenRouter without leaking error bodies', async () => {
  const env={...process.env};Object.assign(process.env,{GROQ_API_KEY:'synthetic-key',GROQ_FREE_TIER_CONFIRMED:'true',OPENROUTER_API_KEY:'synthetic-key'});delete process.env.GEMINI_API_KEY;
  let calls=0;
  try {
    const r=await runFreeModelChain('synthetic',async () => ++calls===1?new Response('secret-bearing body',{status:429}):new Response(JSON.stringify({choices:[{message:{content:'ok'}}]})));
    assert.equal(calls,2);assert.deepEqual(r.attempts,['Groq free: HTTP 429']);
  } finally { process.env=env; }
});
test('empty free providers fail closed rather than any paid service',async()=>{
 const env={...process.env};delete process.env.GROQ_API_KEY;delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;
 try {await assert.rejects(runFreeModelChain('test'),/No paid provider was used/);}finally{process.env=env;}
});

test('OpenRouter failure moves to Gemini and labels the actual answering model', async()=>{
 const env={...process.env};delete process.env.GROQ_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-key';process.env.GEMINI_API_KEY='synthetic-key';
 try {
  const r=await runFreeModelChain('test',async()=>new Response('quota',{status:429}),async()=> 'synthetic Gemini answer');
  assert.equal(r.provider,'Gemini free');assert.equal(r.model,'gemini-3.5-flash-lite');assert.deepEqual(r.attempts,['OpenRouter free: HTTP 429']);
 }finally{process.env=env;}
});
test('timeout or empty replies fail over and all-provider failures remain clear',async()=>{
 const env={...process.env};delete process.env.GROQ_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-key';process.env.GEMINI_API_KEY='synthetic-key';
 try {await assert.rejects(runFreeModelChain('test',async()=>{throw Error('network');},async()=>{throw Error('quota');}),/No paid provider was used/);}finally{process.env=env;}
});
