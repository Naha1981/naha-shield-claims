import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import { lintOutboundMessage } from '../src/lib/engine/lint';
import { CLAIM_AGENT_REGISTRY } from '../src/lib/engine/claimsAgents';

/**
 * Synthetic messaging transport (test inbox only).
 * - Channels: whatsapp_sim, email_sim, group_sim. All in-memory. No network I/O of any kind.
 * - Agent replies are DRAFTS. Nothing counts until a joined human approves the exact digest.
 * - "approved" means "approved inside the test inbox". It never means sent or delivered.
 */
export const SYNTH_LABEL = 'SYNTHETIC / FICTIONAL TEST DATA';
export type Channel = 'whatsapp_sim' | 'email_sim' | 'group_sim';
export type MsgState =
  | 'received_synthetic'
  | 'draft_pending_approval'
  | 'blocked_lint'
  | 'approved_in_test_inbox'
  | 'rejected'
  | 'human_posted';
export type HumanRole = 'head_of_forensics' | 'legal_recoveries' | 'underwriter' | 'compliance_dpo';
/** Read-only principals may GET only (e.g. CFO). Never approvers. */
export type Principal = { id: string; role: HumanRole | 'finance_cfo' };
const APPROVER_ROLES: HumanRole[] = ['head_of_forensics', 'legal_recoveries', 'underwriter', 'compliance_dpo'];

export interface SynthMessage {
  id: string;
  thread_id: string;
  seq: number;
  author_kind: 'synthetic_claimant' | 'agent' | 'human';
  author_id: string;
  subject?: string;
  text: string;
  digest: string;
  state: MsgState;
  lint_violations: string[];
  in_reply_to?: string;
  decided_by?: string;
  decided_at?: string;
  created_at: string;
  /** Fixed. Test inbox only. */
  delivery: { status: 'test_inbox_only'; external_sent: false };
}
export interface SynthThread {
  id: string;
  channel: Channel;
  case_id: string;
  claimant_handle: string;
  agent_ids: string[];
  humans: { id: string; role: HumanRole; joined_at: string }[];
  created_at: string;
}
export interface AuditRow { seq: number; at: string; action: string; object_id: string; details: Record<string, unknown>; previous_hash: string; hash: string }
export type Responder = (ctx: { thread: SynthThread; inbound: SynthMessage; agent_id: string }) => string | Promise<string>;
export type AuditSink = (e: { action: string; object_id: string; actor_id: string; details: Record<string, unknown> }) => Promise<unknown> | unknown;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);
const HANDLE_OK = /^(syn-[a-z0-9-]{1,40}|syn-[a-z0-9.-]{1,40}@test\.invalid)$/;
const ID_OK = /^[a-z0-9_-]{1,40}$/i;
const LIMITS: Record<Channel, number> = { whatsapp_sim: 1000, email_sim: 5000, group_sim: 1000 };

/** Deterministic free fallback: no model, no network. Integration may inject a free-model responder. */
export const defaultResponder: Responder = ({ agent_id }) => {
  const a = CLAIM_AGENT_REGISTRY.find((x) => x.id === agent_id);
  return `${SYNTH_LABEL}. [${a?.name ?? agent_id}] Draft: we have logged your message and a claims reviewer will respond after human review. No outcome has been decided.`;
};

export class SynthChat {
  threads = new Map<string, SynthThread>();
  messages = new Map<string, SynthMessage>();
  audit: AuditRow[] = [];
  private n = 0;
  constructor(private opts: { sink?: AuditSink; responder?: Responder; now?: () => Date } = {}) {}
  private now = () => (this.opts.now ? this.opts.now() : new Date()).toISOString();
  private id = (p: string) => `${p}-${++this.n}-${randomBytes(3).toString('hex')}`;

  private async log(action: string, object_id: string, actor_id: string, details: Record<string, unknown>) {
    const prev = this.audit.at(-1)?.hash ?? GENESIS;
    const rec = { seq: this.audit.length + 1, at: this.now(), action, object_id, details: { ...details, external_sent: false, synthetic_only: true }, previous_hash: prev };
    this.audit.push({ ...rec, hash: sha(JSON.stringify(rec)) });
    await this.opts.sink?.({ action, object_id, actor_id, details: rec.details });
  }
  verifyAudit() {
    let prev = GENESIS;
    for (let i = 0; i < this.audit.length; i++) {
      const { hash, ...rec } = this.audit[i];
      if (rec.seq !== i + 1 || rec.previous_hash !== prev || sha(JSON.stringify(rec)) !== hash) return { valid: false, failed: i + 1 };
      prev = hash;
    }
    return { valid: true, count: this.audit.length, head: prev };
  }
  listThreads() { return [...this.threads.values()].map((t) => ({ ...t, message_count: [...this.messages.values()].filter((m) => m.thread_id === t.id).length })); }
  private thread(id: string) { const t = this.threads.get(id); if (!t) throw Error('Unknown thread'); return t; }
  private nextSeq(thread_id: string) { return [...this.messages.values()].filter((m) => m.thread_id === thread_id).length + 1; }
  private mk(t: SynthThread, m: Pick<SynthMessage, 'author_kind' | 'author_id' | 'text' | 'state'> & Partial<SynthMessage>): SynthMessage {
    const full: SynthMessage = {
      id: this.id('MSG'), thread_id: t.id, seq: this.nextSeq(t.id), subject: m.subject, lint_violations: [], created_at: this.now(),
      ...m, digest: sha(`${t.id}|${m.author_id}|${m.subject ?? ''}|${m.text}`), delivery: { status: 'test_inbox_only', external_sent: false },
    } as SynthMessage;
    this.messages.set(full.id, full);
    return full;
  }
  private checkText(t: SynthThread, text: unknown, subject?: unknown) {
    if (typeof text !== 'string' || !text.trim()) throw Error('Text required');
    if (text.length > LIMITS[t.channel]) throw Error(`Text over ${LIMITS[t.channel]} chars for ${t.channel}`);
    if (t.channel === 'email_sim' && (typeof subject !== 'string' || !subject.trim() || subject.length > 200)) throw Error('email_sim needs a subject up to 200 chars');
  }

  async createThread(i: { channel: Channel; case_id: string; claimant_handle: string; agent_ids?: string[] }) {
    if (!['whatsapp_sim', 'email_sim', 'group_sim'].includes(i.channel)) throw Error('Unknown channel');
    if (!/^SYN-[A-Za-z0-9-]{1,40}$/.test(i.case_id)) throw Error('case_id must start with SYN-');
    if (!HANDLE_OK.test(i.claimant_handle)) throw Error('claimant_handle must be a syn- handle or syn-*@test.invalid; real numbers and addresses are refused');
    const known = new Set(CLAIM_AGENT_REGISTRY.map((a) => a.id));
    const agent_ids = i.agent_ids?.length ? i.agent_ids : ['investigator_lead'];
    if (agent_ids.length > 6 || agent_ids.some((a) => !known.has(a as never))) throw Error('Unknown agent id');
    const t: SynthThread = { id: this.id('THR'), channel: i.channel, case_id: i.case_id, claimant_handle: i.claimant_handle, agent_ids, humans: [], created_at: this.now() };
    this.threads.set(t.id, t);
    await this.log('SYNTH_THREAD_CREATED', t.id, 'system', { channel: t.channel, case_id: t.case_id, agent_ids });
    return t;
  }
  async join(thread_id: string, human: { id: string; role: HumanRole }) {
    const t = this.thread(thread_id);
    if (t.channel !== 'group_sim') throw Error('Humans join group_sim threads only');
    if (!ID_OK.test(human.id) || !APPROVER_ROLES.includes(human.role)) throw Error('Valid human id and approver role required');
    if (!t.humans.some((h) => h.id === human.id)) t.humans.push({ ...human, joined_at: this.now() });
    await this.log('SYNTH_HUMAN_JOINED', t.id, human.id, { role: human.role });
    return t;
  }
  /** A synthetic claimant message arrives; each agent on the thread drafts a reply (pending approval). */
  async inbound(thread_id: string, i: { text: string; subject?: string }) {
    const t = this.thread(thread_id);
    this.checkText(t, i.text, i.subject);
    const inb = this.mk(t, { author_kind: 'synthetic_claimant', author_id: t.claimant_handle, text: i.text, subject: i.subject, state: 'received_synthetic' });
    await this.log('SYNTH_INBOUND_RECEIVED', inb.id, t.claimant_handle, { thread_id, digest: inb.digest });
    const responder = this.opts.responder ?? defaultResponder;
    const drafts: SynthMessage[] = [];
    for (const agent_id of t.agent_ids) {
      let text = String(await responder({ thread: t, inbound: inb, agent_id })).slice(0, LIMITS[t.channel]);
      if (!text.includes(SYNTH_LABEL)) text = `${SYNTH_LABEL}. ${text}`.slice(0, LIMITS[t.channel]);
      const lint = lintOutboundMessage(text);
      const d = this.mk(t, { author_kind: 'agent', author_id: agent_id, text, subject: t.channel === 'email_sim' ? `Re: ${i.subject}` : undefined, in_reply_to: inb.id, state: lint.ok ? 'draft_pending_approval' : 'blocked_lint', lint_violations: lint.violations });
      drafts.push(d);
      await this.log('SYNTH_AGENT_DRAFTED', d.id, agent_id, { thread_id, state: d.state, digest: d.digest, lint_violations: d.lint_violations });
    }
    return { inbound: inb, drafts };
  }
  /** Human speaks in a group. Human-authored, still lint-checked, no approval step needed (the human is the approver). */
  async humanPost(thread_id: string, human_id: string, text: string) {
    const t = this.thread(thread_id);
    if (t.channel !== 'group_sim' || !t.humans.some((h) => h.id === human_id)) throw Error('Join the group first');
    this.checkText(t, text);
    const lint = lintOutboundMessage(text);
    if (!lint.ok) throw Error('Blocked by tipping-off lint: ' + lint.violations.join(', '));
    const m = this.mk(t, { author_kind: 'human', author_id: human_id, text, state: 'human_posted' });
    await this.log('SYNTH_HUMAN_POSTED', m.id, human_id, { thread_id, digest: m.digest });
    return m;
  }
  /** Approve/reject binds to the exact digest the human saw. Single use. Group drafts need a joined human. */
  async decide(message_id: string, human: { id: string; role: HumanRole }, decision: 'approve' | 'reject', digest: string) {
    const m = this.messages.get(message_id);
    if (!m) throw Error('Unknown message');
    const t = this.thread(m.thread_id);
    if (!APPROVER_ROLES.includes(human.role) || !ID_OK.test(human.id)) throw Error('Approver role required');
    if (t.channel === 'group_sim' && !t.humans.some((h) => h.id === human.id && h.role === human.role)) throw Error('Approver must have joined this group');
    if (m.author_kind !== 'agent') throw Error('Only agent drafts need a decision');
    if (m.state !== 'draft_pending_approval') throw Error(`Message is ${m.state}; not decidable`);
    if (digest !== m.digest) throw Error('Digest mismatch; re-read the message');
    if (decision === 'approve') {
      const lint = lintOutboundMessage(m.text);
      if (!lint.ok) throw Error('Blocked by tipping-off lint');
    }
    m.state = decision === 'approve' ? 'approved_in_test_inbox' : 'rejected';
    m.decided_by = human.id; m.decided_at = this.now();
    await this.log(decision === 'approve' ? 'SYNTH_DRAFT_APPROVED_TEST_INBOX' : 'SYNTH_DRAFT_REJECTED', m.id, human.id, { thread_id: t.id, role: human.role, digest: m.digest });
    return m;
  }
  /** Only approved agent messages and human posts count. Drafts, rejected and blocked never do. */
  transcript(thread_id: string) {
    const t = this.thread(thread_id);
    const all = [...this.messages.values()].filter((m) => m.thread_id === thread_id).sort((a, b) => a.seq - b.seq);
    return { thread: t, messages: all, counted: all.filter((m) => m.state === 'approved_in_test_inbox' || m.state === 'human_posted' || m.state === 'received_synthetic'), note: 'Test inbox only. Nothing here was sent over WhatsApp or email.' };
  }
}

/**
 * Router. Fails closed: `authorize` must return the human principal or null (401).
 * Same-origin required for writes. Mount, e.g.: app.use('/api/workforce/chat', synthChatRoutes(engine, {authorize}))
 */
export function synthChatRoutes(engine: SynthChat, opts: { authorize: (req: express.Request) => Principal | null }) {
  const r = express.Router();
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Same-origin required' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  r.use((req, res, next) => { const p = opts.authorize(req); if (!p) return res.status(401).json({ error: 'Sign in required' }); if (p.role === 'finance_cfo' && req.method !== 'GET') return res.status(403).json({ error: 'Read-only role' }); (req as any).principal = p; next(); });
  const wrap = (f: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try { res.json(await f(req)); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Failed' }); }
  };
  const who = (req: express.Request) => (req as any).principal as { id: string; role: HumanRole };
  r.get('/me', (q, res) => { const p = (q as any).principal as Principal; res.json({ ...p, read_only: p.role === 'finance_cfo' }); });
  r.get('/threads', wrap(async () => ({ threads: engine.listThreads() })));
  r.post('/threads', wrap((q) => { if (q.body?.channel !== 'group_sim') throw Error('Release candidate is group-only: channel must be group_sim'); return engine.createThread(q.body); }));
  r.post('/threads/:id/join', wrap((q) => engine.join(String(q.params.id), who(q))));
  r.post('/threads/:id/inbound', wrap((q) => engine.inbound(String(q.params.id), q.body)));
  r.post('/threads/:id/human', wrap((q) => engine.humanPost(String(q.params.id), who(q).id, q.body?.text)));
  r.get('/threads/:id', wrap(async (q) => engine.transcript(String(q.params.id))));
  r.post('/messages/:id/decision', wrap((q) => engine.decide(String(q.params.id), who(q), q.body?.decision, q.body?.digest)));
  r.get('/audit', wrap(async () => ({ rows: engine.audit, verification: engine.verifyAudit() })));
  return r;
}
