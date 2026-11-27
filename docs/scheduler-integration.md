# Scheduler integration contract (synthetic tasks only)

Files: `server/scheduler.ts` (engine), `server/schedulerRoutes.ts` (HTTP), `server/scheduler.test.ts`.

## Wiring (NOT applied in this patch, owner to do)
```ts
const scheduler = new Scheduler({ journalPath: 'data/scheduler.jsonl', deps: { portal, synthChat },
  onAudit: e => store.logAudit({ actor_role:'head_of_forensics', actor_id:'scheduler', action:'SCHEDULER_'+e.type, object_type:'claim', object_id:e.jobId, details:{seq:e.seq,hash:e.hash} }) });
scheduler.registerHandler(portalHandler); scheduler.registerHandler(synthChatHandler); scheduler.start();
app.use('/api/scheduler', schedulerRoutes(scheduler, req => /* named human from a REAL session, e.g. workforce localSession */));
```
Do not authorize with `x-nahashield-role`: it is a client-set header, not authentication. `allowExternalWrites` stays false.

## Handler contract
`HandlerDef { id, version, validate(params), steps:[{name, kind:'read'|'draft'|'external_write', run(ctx), timeoutMs?}] }`.
- `ctx.deps` is whatever the integration passes: the SAME shared capture executor (portal-runner) and synthChat instance. The scheduler imports no browser and no model client, and runs one step at a time, so the single Chromium is never used in parallel by it.
- `ctx.idempotencyKey` is stable per job+step; pass it downstream. After a crash, the in-flight step reruns (at-least-once), so steps must be idempotent. Completed steps are never rerun.
- `ctx.signal` aborts on timeout/cancel; handlers must honour it (the scheduler discards late output but cannot kill foreign work).
- Step outputs must be JSON; they are stored in the journal. Never put secrets or real data in outputs.
- Any step that sends, submits, files or commits must be `kind:'external_write'`: the job stops in `awaiting_approval`; a named human posts the shown `proposal_hash` to `/jobs/:id/decision`. Even then it is skipped (recorded `not_executed`) unless the scheduler is built with `allowExternalWrites:true`.
- Params must carry `dataset_label: 'SYNTHETIC / FICTIONAL TEST DATA'`; keys like url/command/cron/path/script and URL-like strings are rejected, so handlers should take ids/refs resolved server-side from their own allowlist.

## API
GET /handlers, GET /jobs, GET /jobs/:id (with audit), GET /audit/verify; POST /jobs {handler, params, idempotency_key, run_at_ms?, every_ms(>=60000)?, max_runs?, max_attempts?}; POST /jobs/:id/{pause,resume,cancel,retry,decision}. Writes need same-origin plus the authorize hook.

## Limits (unproven / by design)
Single process, single journal file (no multi-instance locking). Not exercised against the real portal-runner or synthChat. Journal is tamper-evident, not tamper-proof (an attacker rewriting the whole file consistently is not detected; anchor the head hash in the Evidence Vault if needed). Timer `start()` untested beyond tick().
