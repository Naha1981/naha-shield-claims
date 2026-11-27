import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Durable scheduler for SYNTHETIC agent tasks.
 * - Only handlers registered in code can run. Jobs name a handler id; nothing else is executed.
 * - No URL, shell, script or cron-text params are accepted.
 * - Steps of kind 'external_write' never run unattended: the job stops in
 *   'awaiting_approval'. Even after approval, the write only executes when the
 *   scheduler was created with allowExternalWrites:true (default false).
 * - State is an append-only, hash-chained JSONL journal; restart = replay.
 * - Runs one step at a time (concurrency 1) so a shared single browser executor is never used in parallel.
 * - Spawns no browser and calls no model. Handlers get capabilities only through `deps`.
 */
export const SYNTHETIC_LABEL = 'SYNTHETIC / FICTIONAL TEST DATA';
export type JobStatus = 'queued' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
export type StepKind = 'read' | 'draft' | 'external_write';

export interface StepContext<D = any> {
  jobId: string; stepIndex: number; stepName: string; params: any;
  outputs: Record<string, unknown>; // outputs of earlier steps by step name
  deps: D; signal: AbortSignal; idempotencyKey: string; // stable per job+step, pass to downstream calls
}
export interface StepDef<D = any> { name: string; kind: StepKind; run: (ctx: StepContext<D>) => Promise<unknown> | unknown; timeoutMs?: number }
export interface HandlerDef<D = any> {
  id: string; version: string;
  validate: (params: any) => void; // throw on bad params
  steps: StepDef<D>[];
}
export interface Job {
  id: string; handler: string; handlerVersion: string; params: any; paramsHash: string; idempotencyKey: string;
  status: JobStatus; stepIndex: number; attempts: number; maxAttempts: number; notBefore: number;
  outputs: Record<string, unknown>; pendingProposal?: { step: string; hash: string };
  approvals: { step: string; by: string; at: string; executed: boolean }[];
  everyMs?: number; runsLeft?: number; error?: string; createdAt: string; updatedAt: string; pauseRequested?: boolean;
}
export interface AuditEvent { seq: number; ts: string; type: string; jobId: string; actor: string; data: any; prev: string; hash: string }

const FORBIDDEN_KEYS = /^(url|urls|uri|href|link|command|cmd|shell|exec|script|code|cron|crontab|schedule_text|eval|path|file|endpoint)$/i;
const URLISH = /\b(?:https?|ftp|file|javascript|data):\/\/|^\s*(?:javascript|data):/i;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function canonical(x: any): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
}
export function assertSafeParams(p: any, depth = 0): void {
  if (depth > 8) throw new Error('params too deep');
  if (typeof p === 'string') { if (URLISH.test(p)) throw new Error('URL-like values are not accepted in job params'); if (p.length > 20000) throw new Error('string too long'); return; }
  if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) { if (FORBIDDEN_KEYS.test(k)) throw new Error(`param key "${k}" is not allowed`); assertSafeParams(v, depth + 1); }
}

export interface SchedulerOptions<D> {
  journalPath: string; deps: D; now?: () => number; allowExternalWrites?: boolean;
  defaultStepTimeoutMs?: number; maxQueued?: number; onAudit?: (e: AuditEvent) => void | Promise<void>;
}
const MIN_EVERY_MS = 60_000;

export class Scheduler<D = any> {
  private handlers = new Map<string, HandlerDef<D>>();
  private jobs = new Map<string, Job>();
  private keys = new Map<string, string>();
  private audit: AuditEvent[] = [];
  private busy = false; private timer?: ReturnType<typeof setInterval>;
  private aborts = new Map<string, AbortController>();
  private now: () => number;
  constructor(private o: SchedulerOptions<D>) { this.now = o.now ?? Date.now; this.load(); }

  registerHandler(h: HandlerDef<D>) {
    if (!/^[a-z0-9_.]{3,64}$/.test(h.id) || !h.steps.length) throw new Error('bad handler');
    if (this.handlers.has(h.id)) throw new Error('handler already registered');
    this.handlers.set(h.id, h);
  }
  handlerIds() { return [...this.handlers.keys()]; }

  // ---- journal ----
  private load() {
    if (!existsSync(this.o.journalPath)) { mkdirSync(dirname(this.o.journalPath), { recursive: true }); return; }
    const lines = readFileSync(this.o.journalPath, 'utf8').split('\n').filter(Boolean);
    let prev = 'GENESIS';
    for (const [i, l] of lines.entries()) {
      let e: AuditEvent;
      try { e = JSON.parse(l); } catch { if (i === lines.length - 1) { writeFileSync(this.o.journalPath, lines.slice(0, i).map(x => x + '\n').join('')); break; } throw new Error('journal corrupt at line ' + (i + 1)); } // a torn final line from a crash is dropped
      if (e.prev !== prev || e.hash !== this.hashOf(e)) throw new Error('journal hash chain broken at seq ' + e.seq);
      prev = e.hash; this.audit.push(e); this.apply(e);
    }
    // restart recovery: anything left running was interrupted; its current step reruns with the same idempotency key
    for (const j of this.jobs.values()) if (j.status === 'running') { this.emitSync('job.recovered', j.id, 'system', { step_index: j.stepIndex }); }
  }
  private hashOf(e: Omit<AuditEvent, 'hash'> & { hash?: string }) { return sha(e.prev + canonical({ seq: e.seq, ts: e.ts, type: e.type, jobId: e.jobId, actor: e.actor, data: e.data })); }
  private emitSync(type: string, jobId: string, actor: string, data: any) {
    const prev = this.audit.length ? this.audit[this.audit.length - 1].hash : 'GENESIS';
    const e: AuditEvent = { seq: this.audit.length + 1, ts: new Date(this.now()).toISOString(), type, jobId, actor, data: JSON.parse(JSON.stringify(data ?? {})), prev, hash: '' };
    e.hash = this.hashOf(e);
    appendFileSync(this.o.journalPath, JSON.stringify(e) + '\n'); // written before state changes
    this.audit.push(e); this.apply(e);
    try { void Promise.resolve(this.o.onAudit?.(e)).catch(() => {}); } catch { /* audit hook must not break the queue */ }
    return e;
  }
  verifyAudit(): { valid: boolean; events: number; broken_at?: number } {
    let prev = 'GENESIS';
    for (const e of this.audit) if (e.prev !== prev || e.hash !== this.hashOf(e)) return { valid: false, events: this.audit.length, broken_at: e.seq }; else prev = e.hash;
    return { valid: true, events: this.audit.length };
  }
  auditFor(jobId?: string) { return this.audit.filter(e => !jobId || e.jobId === jobId); }

  // ---- state machine (pure replay of events) ----
  private apply(e: AuditEvent) {
    const j = this.jobs.get(e.jobId); const ts = e.ts; const d = e.data;
    switch (e.type) {
      case 'job.submitted': { const nj: Job = JSON.parse(JSON.stringify(d.job)); this.jobs.set(nj.id, nj); this.keys.set(nj.idempotencyKey, nj.id); break; }
      case 'job.started': if (j) { j.status = 'running'; j.attempts = d.attempt; j.error = undefined; } break;
      case 'step.completed': if (j) { j.outputs[d.step] = JSON.parse(JSON.stringify(d.output ?? null)); j.stepIndex = d.step_index + 1; } break;
      case 'step.failed': if (j) { j.error = d.error; } break;
      case 'job.requeued': if (j) { j.status = 'queued'; j.notBefore = d.not_before; } break;
      case 'job.failed': if (j) { j.status = 'failed'; j.error = d.error; } break;
      case 'job.completed': if (j) { j.status = 'completed'; } break;
      case 'job.awaiting_approval': if (j) { j.status = 'awaiting_approval'; j.pendingProposal = { step: d.step, hash: d.proposal_hash }; } break;
      case 'approval.granted': if (j) { j.approvals.push({ step: d.step, by: e.actor, at: ts, executed: d.executed }); j.pendingProposal = undefined; if (!d.executed) { /* stays recorded, not run */ } j.status = 'queued'; j.notBefore = 0; } break;
      case 'approval.rejected': if (j) { j.status = 'cancelled'; j.pendingProposal = undefined; } break;
      case 'job.pause_requested': if (j) j.pauseRequested = true; break;
      case 'job.paused': if (j) { j.status = 'paused'; j.pauseRequested = false; } break;
      case 'job.resumed': if (j) { j.status = 'queued'; j.notBefore = 0; } break;
      case 'job.cancelled': if (j) { j.status = 'cancelled'; j.pendingProposal = undefined; } break;
      case 'job.retried': if (j) { j.status = 'queued'; j.attempts = 0; j.error = undefined; j.notBefore = 0; } break;
      case 'job.recovered': if (j) { j.status = 'queued'; j.notBefore = 0; } break;
      case 'job.rescheduled': if (j) { j.runsLeft = d.runs_left; } break;
      case 'step.blocked_write_disabled': if (j) { j.stepIndex = d.step_index + 1; j.outputs[d.step] = { not_executed: true, reason: 'external writes disabled' }; } break;
    }
    if (j) j.updatedAt = ts;
  }

  // ---- public controls ----
  submit(input: { handler: string; params: any; idempotencyKey: string; runAt?: number; everyMs?: number; maxRuns?: number; maxAttempts?: number }, actor: string): Job {
    const h = this.handlers.get(input.handler); if (!h) throw new Error('unknown handler (only registered handlers can run)');
    if (typeof input.idempotencyKey !== 'string' || !/^[\w:.-]{8,128}$/.test(input.idempotencyKey)) throw new Error('idempotencyKey required (8-128 chars)');
    const p = input.params;
    if (!p || p.dataset_label !== SYNTHETIC_LABEL) throw new Error('params.dataset_label must be the synthetic label');
    assertSafeParams(p); h.validate(p);
    const ph = sha(canonical({ handler: input.handler, params: p, everyMs: input.everyMs ?? null }));
    const existing = this.keys.get(input.idempotencyKey);
    if (existing) { const ej = this.jobs.get(existing)!; if (ej.paramsHash !== ph) throw new Error('idempotencyKey reused with different request'); return ej; }
    if (input.everyMs !== undefined && (!Number.isInteger(input.everyMs) || input.everyMs < MIN_EVERY_MS)) throw new Error('everyMs must be an integer >= 60000');
    if (input.runAt !== undefined && !Number.isFinite(input.runAt)) throw new Error('runAt must be epoch ms');
    if ([...this.jobs.values()].filter(j => j.status === 'queued' || j.status === 'running').length >= (this.o.maxQueued ?? 200)) throw new Error('queue full');
    const now = this.now();
    const job: Job = { id: 'job_' + randomUUID(), handler: h.id, handlerVersion: h.version, params: p, paramsHash: ph, idempotencyKey: input.idempotencyKey, status: 'queued', stepIndex: 0, attempts: 0, maxAttempts: Math.min(Math.max(input.maxAttempts ?? 3, 1), 5), notBefore: input.runAt ?? now, outputs: {}, approvals: [], everyMs: input.everyMs, runsLeft: input.everyMs ? Math.min(input.maxRuns ?? 1, 100) : undefined, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    this.emitSync('job.submitted', job.id, actor, { job });
    return this.jobs.get(job.id)!;
  }
  get(id: string) { return this.jobs.get(id); }
  list() { return [...this.jobs.values()]; }
  private must(id: string) { const j = this.jobs.get(id); if (!j) throw new Error('unknown job'); return j; }
  pause(id: string, actor: string) {
    const j = this.must(id);
    if (j.status === 'queued' || j.status === 'awaiting_approval') this.emitSync('job.paused', id, actor, {});
    else if (j.status === 'running') this.emitSync('job.pause_requested', id, actor, {}); // takes effect at next step boundary
    else throw new Error('cannot pause a ' + j.status + ' job');
    return j;
  }
  resume(id: string, actor: string) { const j = this.must(id); if (j.status !== 'paused') throw new Error('job not paused'); this.emitSync('job.resumed', id, actor, {}); return j; }
  cancel(id: string, actor: string) {
    const j = this.must(id); if (['completed', 'failed', 'cancelled'].includes(j.status)) throw new Error('job already ' + j.status);
    this.emitSync('job.cancelled', id, actor, { was: j.status }); this.aborts.get(id)?.abort(); return j;
  }
  retry(id: string, actor: string) { const j = this.must(id); if (j.status !== 'failed' && j.status !== 'cancelled') throw new Error('only failed or cancelled jobs can be retried'); this.emitSync('job.retried', id, actor, { from: j.status }); return j; }
  /** Human decision on a pending external-write proposal. proposalHash must match what was shown. */
  decide(id: string, actor: string, approve: boolean, proposalHash: string) {
    const j = this.must(id);
    if (j.status !== 'awaiting_approval' || !j.pendingProposal) throw new Error('no pending approval');
    if (!actor || actor === 'system' || actor.startsWith('scheduler')) throw new Error('a named human approver is required');
    if (proposalHash !== j.pendingProposal.hash) throw new Error('proposal hash mismatch; re-read the proposal');
    if (!approve) { this.emitSync('approval.rejected', id, actor, { step: j.pendingProposal.step }); return j; }
    this.emitSync('approval.granted', id, actor, { step: j.pendingProposal.step, proposal_hash: proposalHash, executed: false, will_execute: !!this.o.allowExternalWrites });
    return j;
  }
  private proposalFor(j: Job, step: StepDef<D>) { return sha(canonical({ job: j.id, step: step.name, idx: j.stepIndex, params: j.params, outputs: j.outputs })); }

  // ---- execution ----
  /** Run due jobs, one step at a time. Returns number of steps executed. */
  async tick(): Promise<number> {
    if (this.busy) return 0; this.busy = true; let n = 0;
    try {
      for (;;) {
        const t = this.now();
        const j = [...this.jobs.values()].filter(x => x.status === 'queued' && x.notBefore <= t).sort((a, b) => a.notBefore - b.notBefore || a.createdAt.localeCompare(b.createdAt))[0];
        if (!j) break;
        n += await this.runJob(j);
      }
    } finally { this.busy = false; }
    return n;
  }
  private async runJob(j: Job): Promise<number> {
    const h = this.handlers.get(j.handler);
    if (!h || h.version !== j.handlerVersion) { this.emitSync('job.failed', j.id, 'scheduler', { error: 'handler missing or version changed' }); return 0; }
    this.emitSync('job.started', j.id, 'scheduler', { attempt: j.attempts + 1 });
    let ran = 0;
    while (j.status === 'running') {
      if (j.pauseRequested) { this.emitSync('job.paused', j.id, 'scheduler', { at_step: j.stepIndex }); break; }
      if (j.stepIndex >= h.steps.length) { this.finish(j); break; }
      const step = h.steps[j.stepIndex];
      if (step.kind === 'external_write') {
        const approved = j.approvals.some(a => a.step === step.name);
        if (!approved) { this.emitSync('job.awaiting_approval', j.id, 'scheduler', { step: step.name, proposal_hash: this.proposalFor(j, step), reason: 'external write requires human approval' }); break; }
        if (!this.o.allowExternalWrites) { this.emitSync('step.blocked_write_disabled', j.id, 'scheduler', { step: step.name, step_index: j.stepIndex }); continue; }
      }
      const ac = new AbortController(); this.aborts.set(j.id, ac);
      const idem = sha(j.id + ':' + j.stepIndex + ':' + step.name);
      this.emitSync('step.started', j.id, 'scheduler', { step: step.name, step_index: j.stepIndex, kind: step.kind, idempotency_key: idem });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ms = step.timeoutMs ?? this.o.defaultStepTimeoutMs ?? 120_000;
        const out = await Promise.race([
          Promise.resolve(step.run({ jobId: j.id, stepIndex: j.stepIndex, stepName: step.name, params: j.params, outputs: { ...j.outputs }, deps: this.o.deps, signal: ac.signal, idempotencyKey: idem })),
          new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error('step timeout')); }, ms); }),
        ]);
        if (j.status !== 'running') break; // cancelled while the step was in flight: discard output
        const output = JSON.parse(JSON.stringify(out ?? null));
        this.emitSync('step.completed', j.id, 'scheduler', { step: step.name, step_index: j.stepIndex, output, output_sha256: sha(canonical(output)) });
        ran++;
      } catch (err) {
        if (j.status !== 'running') break;
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        this.emitSync('step.failed', j.id, 'scheduler', { step: step.name, step_index: j.stepIndex, error: msg, attempt: j.attempts });
        if (j.attempts < j.maxAttempts) this.emitSync('job.requeued', j.id, 'scheduler', { not_before: this.now() + 1000 * 2 ** j.attempts * 5, reason: 'retry after step failure' });
        else this.emitSync('job.failed', j.id, 'scheduler', { error: msg });
        break;
      } finally { if (timer) clearTimeout(timer); this.aborts.delete(j.id); }
    }
    return ran;
  }
  private finish(j: Job) {
    this.emitSync('job.completed', j.id, 'scheduler', { outputs_sha256: sha(canonical(j.outputs)) });
    if (j.everyMs && (j.runsLeft ?? 0) > 1) {
      // next occurrence is a new job with a deterministic key so a crash here cannot double-schedule
      const slot = (j.runsLeft ?? 0) - 1; const key = (j.idempotencyKey + ':run' + slot).slice(0, 128);
      if (!this.keys.has(key)) {
        const now = this.now();
        const nj: Job = { ...j, id: 'job_' + randomUUID(), idempotencyKey: key, status: 'queued', stepIndex: 0, attempts: 0, notBefore: now + j.everyMs, outputs: {}, approvals: [], pendingProposal: undefined, error: undefined, runsLeft: slot, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
        this.emitSync('job.submitted', nj.id, 'scheduler', { job: nj, recurrence_of: j.id });
      }
    }
  }
  start(intervalMs = 5000) { if (this.timer) return; this.timer = setInterval(() => { void this.tick().catch(() => {}); }, intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
