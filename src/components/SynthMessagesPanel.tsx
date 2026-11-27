import React from 'react';

const AGENTS = ['investigator_lead', 'claims_sla_coordinator', 'document_evidence_analyst', 'entity_geospatial_analyst', 'network_payout_analyst', 'tool_integration_auditor'];
const BADGE: Record<string, string> = {
  received_synthetic: 'bg-slate-700 text-slate-200',
  draft_pending_approval: 'bg-amber-700 text-amber-100',
  blocked_lint: 'bg-red-800 text-red-100',
  approved_in_test_inbox: 'bg-emerald-800 text-emerald-100',
  rejected: 'bg-slate-600 text-slate-300',
  human_posted: 'bg-sky-800 text-sky-100',
};
const LABEL: Record<string, string> = {
  received_synthetic: 'synthetic inbound',
  draft_pending_approval: 'AI Draft · Awaiting human review',
  blocked_lint: 'BLOCKED by lint',
  approved_in_test_inbox: 'Accepted for test handoff',
  rejected: 'Returned for revision',
  human_posted: 'human',
};

async function api(path: string, body?: unknown) {
  const r = await fetch('/api/workforce/chat/' + path, { method: body !== undefined ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(j.error || 'Request failed'), { status: r.status });
  return j;
}

export function SynthMessagesPanel() {
  const [me, setMe] = React.useState<{ id: string; role: string; read_only: boolean } | null>(null);
  const [needLogin, setNeedLogin] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [threads, setThreads] = React.useState<any[]>([]);
  const [sel, setSel] = React.useState<string>('');
  const [tr, setTr] = React.useState<any>(null);
  const [msg, setMsg] = React.useState('');
  const [note, setNote] = React.useState('');
  const [channel, setChannel] = React.useState('group_sim');
  const [caseId, setCaseId] = React.useState('SYN-MOTOR-02');
  const [handle, setHandle] = React.useState('syn-claimant-1');
  const [agents, setAgents] = React.useState<string[]>(['investigator_lead', 'document_evidence_analyst']);
  const [inText, setInText] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [humanText, setHumanText] = React.useState('');

  const loadThreads = React.useCallback(async () => { const j = await api('threads'); setThreads(j.threads); }, []);
  const loadThread = React.useCallback(async (id: string) => { setTr(await api('threads/' + id)); setThreads((await api('threads')).threads); }, []);
  const boot = React.useCallback(async () => {
    try { setMe(await api('me')); setNeedLogin(false);window.dispatchEvent(new Event('workspace-changed')); await loadThreads(); }
    catch (e: any) { if (e.status === 401) setNeedLogin(true); else setMsg(String(e.message)); }
  }, [loadThreads]);
  React.useEffect(() => { void boot(); }, [boot]);
  React.useEffect(() => { if (sel) void loadThread(sel); }, [sel, loadThread]);
  const run = async (f: () => Promise<unknown>) => { try { setMsg(''); await f(); } catch (e: any) { setMsg(String(e.message)); } };

  async function login(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await fetch('/api/workforce/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || 'Sign-in failed');
      setPassword(''); await boot();
    });
  }
  const cls = 'bg-slate-900 border border-slate-700 rounded-xl p-5 mb-5';
  const inp = 'bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100';
  const btn = 'px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-sm disabled:opacity-40';

  const banner = <p role="note" className="mb-4 rounded-lg bg-amber-950 border border-amber-700 text-amber-100 px-4 py-2 text-sm">TEST INBOX ONLY. Synthetic claimants and test handles. Nothing here is sent over WhatsApp or email, and acceptance is a human review of an AI draft, never a claim or payment decision. Nothing is delivered.</p>;
  if (needLogin) return <div>{banner}<form onSubmit={login} className={cls}><h2 className="font-semibold mb-2">Private reviewer sign-in</h2><p className="text-sm text-slate-300 mb-3">Same private reviewer session as the Documents tab.</p><input type="password" aria-label="Reviewer password" className={inp} value={password} onChange={(e) => setPassword(e.target.value)} /> <button className={btn}>Sign in</button>{msg && <p role="alert" className="mt-2 text-red-300 text-sm">{msg}</p>}</form></div>;
  if (!me) return <p className="text-slate-300">{msg || 'Loading...'}</p>;
  const ro = me.read_only;
  const t = tr?.thread;
  const joined = !!t?.humans?.some((h: any) => h.id === me.id);

  return <div>
    {banner}
    <p className="text-sm text-slate-300 mb-3">Signed in as {me.id} ({me.role}){ro ? ', read-only' : ''}.</p>
    {msg && <p role="alert" className="mb-3 text-red-300 text-sm">{msg}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div>
        <section className={cls} aria-label="New synthetic thread">
          <h2 className="font-semibold mb-3">New synthetic thread</h2>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-slate-400">Group chat (test inbox)</p>
            <label className="block">Case id <input className={inp} value={caseId} onChange={(e) => setCaseId(e.target.value)} /></label>
            <label className="block">Claimant handle <input className={inp} value={handle} onChange={(e) => setHandle(e.target.value)} /></label>
            <fieldset><legend>Agents</legend>{AGENTS.map((a) => <label key={a} className="block"><input type="checkbox" checked={agents.includes(a)} onChange={(e) => setAgents(e.target.checked ? [...agents, a] : agents.filter((x) => x !== a))} /> {a}</label>)}</fieldset>
            <button className={btn} disabled={ro} onClick={() => run(async () => { const th = await api('threads', { channel, case_id: caseId, claimant_handle: handle, agent_ids: agents }); await loadThreads(); setSel(th.id); })}>Create thread</button>
          </div>
        </section>
        <section className={cls} aria-label="Threads"><h2 className="font-semibold mb-2">Threads</h2>
          {threads.length === 0 && <p className="text-sm text-slate-400">None yet.</p>}
          <label className="block text-sm mb-2">Find claim<input aria-label="Find synthetic claim" className={inp+' w-full'} value={search} onChange={e=>setSearch(e.target.value)}/></label>
          {threads.filter(x=>x.case_id.toLowerCase().includes(search.toLowerCase())).map((x) => <button key={x.id} onClick={() => setSel(x.id)} className={`block w-full text-left text-sm rounded px-2 py-1 mb-1 ${sel === x.id ? 'bg-slate-700' : 'bg-slate-800'}`}>{x.channel} · {x.case_id} · {x.message_count} msgs</button>)}
        </section>
      </div>
      <section className={cls + ' lg:col-span-2'} aria-label="Conversation">
        {!t ? <p className="text-sm text-slate-400">Select or create a thread.</p> : <>
          <header className="rounded bg-slate-800 p-4 mb-4"><p className="text-xs text-amber-200">SYNTHETIC INVESTIGATION · NO CLAIM DECISION</p><h2 className="font-semibold my-2">{t.case_id}</h2><p className="text-sm">Human reviewer: {me.id} · {t.message_count || tr.messages.length} messages · Legal SLA: not established by this demo</p></header>
          <p className="text-xs text-slate-400 mb-3">Claimant {t.claimant_handle} · agents {t.agent_ids.join(', ')}{t.channel === 'group_sim' ? ` · humans ${t.humans.map((h: any) => h.id).join(', ') || 'none joined'}` : ''}</p>
          <div className="space-y-2 mb-4" data-testid="messages">
            {tr.messages.map((m: any) => <div key={m.id} className={`rounded-lg p-3 text-sm ${m.author_kind === 'synthetic_claimant' ? 'bg-slate-800' : m.author_kind === 'human' ? 'bg-sky-950' : 'bg-slate-950 border border-slate-700'}`}>
              <div className="flex justify-between gap-2 text-xs mb-1"><span className="text-slate-300">{m.author_kind}: {m.author_id}</span><span className={`px-2 rounded ${BADGE[m.state]}`}>{LABEL[m.state]}</span></div>
              {m.subject && <div className="font-medium">{m.subject}</div>}
              {m.author_kind==='agent'&&<p className="text-xs text-amber-200 my-2">AI finding, advisory only. Human decision and external delivery are separate.</p>}<h3 className="font-semibold text-sm">{m.author_kind==='agent'?'Finding / recommendation':'Message'}</h3><div className="mt-2">{m.text}</div><details className="mt-3 text-sm text-slate-300"><summary>Evidence provenance and review receipt</summary><p className="mt-2">Source: synthetic test inbox thread {t.case_id}. Not external claimant evidence.</p><p>Created: {m.created_at}. Agent: {m.author_id}.</p><p>Model/version: not recorded by this response. Confidence: not calibrated, no percentage asserted.</p><p className="break-all">Exact message SHA256: {m.digest}</p><p>Human reviewer: {m.decided_by||'Awaiting review'}. Decision time: {m.decided_at||'Not recorded'}.</p><p>External delivery: none. AI finding is not a claim approval.</p></details>
              {m.lint_violations.length > 0 && <div className="text-red-300 text-xs mt-1">Lint: {m.lint_violations.join(', ')}</div>}
              {m.state === 'draft_pending_approval' && <div className="mt-2 flex gap-2">
                <button className={btn} disabled={ro || (t.channel === 'group_sim' && !joined)} onClick={() => run(async () => { await api(`messages/${m.id}/decision`, { decision: 'approve', digest: m.digest }); await loadThread(t.id); })}>Accept for test handoff</button>
                <button className="px-3 py-1 rounded bg-slate-600 text-sm disabled:opacity-40" disabled={ro || (t.channel === 'group_sim' && !joined)} onClick={() => run(async () => { await api(`messages/${m.id}/decision`, { decision: 'reject', digest: m.digest }); await loadThread(t.id); })}>Return for revision</button>
                {t.channel === 'group_sim' && !joined && <span className="text-xs text-slate-400 self-center">Join the group to decide.</span>}
              </div>}
            </div>)}
          </div>
          <div className="space-y-2 text-sm">
            <h3 className="font-medium">Simulate a synthetic claimant message</h3>
            {t.channel === 'email_sim' && <input className={inp + ' w-full'} placeholder="Subject" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
            <textarea className={inp + ' w-full'} rows={2} aria-label="Claimant message" value={inText} onChange={(e) => setInText(e.target.value)} placeholder="SYNTHETIC / FICTIONAL TEST DATA message from the claimant" />
            <button className={btn} disabled={ro || !inText.trim()} onClick={() => run(async () => { await api(`threads/${t.id}/inbound`, { text: inText, subject: t.channel === 'email_sim' ? subject : undefined }); setInText(''); await loadThread(t.id); await loadThreads(); })}>Deliver to agents (test inbox)</button>
            {t.channel === 'group_sim' && <div className="pt-3 border-t border-slate-700">
              {!joined ? <button className={btn} disabled={ro} onClick={() => run(async () => { await api(`threads/${t.id}/join`, {}); await loadThread(t.id); })}>Join group as {me.id}</button>
                : <div className="flex gap-2"><input className={inp + ' flex-1'} aria-label="Human message" value={humanText} onChange={(e) => setHumanText(e.target.value)} placeholder="Message the group" /><button className={btn} disabled={!humanText.trim()} onClick={() => run(async () => { await api(`threads/${t.id}/human`, { text: humanText }); setHumanText(''); await loadThread(t.id); })}>Post</button></div>}
            </div>}
          </div>
          <p className="text-xs text-slate-400 mt-3">{tr.note} Counted so far: {tr.counted.length} of {tr.messages.length}.</p>
        </>}
      </section>
    </div>
  </div>;
}
