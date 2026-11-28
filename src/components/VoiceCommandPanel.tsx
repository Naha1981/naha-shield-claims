import React from 'react';
const destinations:Record<string,string>={documents:'/workforce#workforce-tools',vault:'/vault',claims:'/claims',consent:'/consent',recovery:'/recovery',agents:'/workforce#agent-chat'};
export function resolveVoiceCommand(input:string){const q=input.toLowerCase().trim().replace(/[.!?]/g,'');if(/\b(approve|reject|pay|send|delete|hold|transfer)\b/.test(q))return null;const m=q.match(/^(?:open|show|go to) (?:the )?(documents|vault|claims|consent|recovery|agents)$/);return m?{name:m[1],href:destinations[m[1]]}:null}
type SpeechRecognitionType={lang:string;interimResults:boolean;maxAlternatives:number;onresult:((e:any)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;abort:()=>void};
export function VoiceCommandPanel(){
 const[text,setText]=React.useState(''),[message,setMessage]=React.useState(''),[preview,setPreview]=React.useState<ReturnType<typeof resolveVoiceCommand>>(null),[listening,setListening]=React.useState(false);
 const[Recognizer]=React.useState<(()=>SpeechRecognitionType)|null>(()=>{
   if(typeof window==='undefined')return null;
   const w=window as unknown as {SpeechRecognition?:new()=>SpeechRecognitionType;webkitSpeechRecognition?:new()=>SpeechRecognitionType};
   const C=w.SpeechRecognition||w.webkitSpeechRecognition;
   return C?()=>new C():null;
 });
 function startListening(){
   if(!Recognizer){setMessage('Voice typing is not available in this browser. Type the command instead.');return}
   const r=Recognizer();
   r.lang='en-ZA';r.interimResults=false;r.maxAlternatives=1;
   setListening(true);setMessage('');
   r.onresult=(e)=>{const said=String(e.results?.[0]?.[0]?.transcript||'');setText(said);setPreview(null);setListening(false);if(said)setMessage('Heard it. Check the command, then open.')}
   r.onerror=()=>{setListening(false);setMessage('Voice typing did not work here. Type the command instead.')}
   r.onend=()=>setListening(false);
   try{r.start()}catch{setListening(false);setMessage('Voice typing did not start. Type the command instead.')}
 }
 return <section className="command-tool rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100"><h2 className="text-xl font-semibold">Open a tool</h2><p className="mt-2 text-slate-300">Speak or type a command. Check it, then open.</p><label className="block mt-5">Your command<input aria-label="Your command" className="block w-full rounded-xl border border-slate-600 bg-slate-800 p-3 mt-2" value={text} onChange={e=>{setText(e.target.value);setPreview(null);setMessage('')}} placeholder="open documents" autoComplete="off"/></label><div className="flex flex-wrap gap-2 mt-3"><button type="button" className="rounded-xl bg-emerald-800 px-4 py-2 text-sm disabled:opacity-40" onClick={startListening} disabled={listening}>{listening?'Listening...':'Speak the command'}</button>{['documents','agents','vault','claims','consent','recovery'].map(name=><button type="button" className="rounded-xl border border-slate-600 px-3 py-2 text-sm" key={name} onClick={()=>{setText('open '+name);setPreview(null);setMessage('')}}>{name==='agents'?'AI team':name.charAt(0).toUpperCase()+name.slice(1)}</button>)}</div><button className="bg-emerald-800 rounded-xl px-5 py-3 mt-5 disabled:opacity-40" disabled={!text.trim()} onClick={()=>{const v=resolveVoiceCommand(text);setPreview(v);setMessage(v?'':'Try "open documents". No action taken.')}}>Check command</button>{preview&&<div className="mt-4 rounded-xl border border-emerald-700 p-4"><p>Open {preview.name==='agents'?'AI team':preview.name}?</p><a className="inline-block bg-emerald-800 rounded-xl px-5 py-3 mt-3" href={preview.href}>Open {preview.name==='agents'?'AI team':preview.name}</a></div>}{message&&<p role="status" className="mt-3">{message}</p>}<details className="mt-5 text-sm"><summary>Speech & safeguards</summary><p className="mt-3">Voice typing uses your browser's built-in speech service and only fills in the command box. You still check and confirm. No paid speech service is used.</p><p className="mt-2">This tool only opens pages. It cannot approve, reject, pay, send or delete. Nothing runs until you confirm.</p></details></section>}
