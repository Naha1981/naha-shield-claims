import express from 'express';
import type { Scheduler } from './scheduler';

/** Mount with an `authorize` hook that returns a named human actor id, or null. Same-origin required for writes. */
export function schedulerRoutes(s: Scheduler<any>, authorize: (req: express.Request) => string | null) {
  const r = express.Router();
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Same-origin required' });
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  r.use((req, res, next) => { const a = authorize(req); if (!a) return res.status(401).json({ error: 'Sign in required' }); (req as any).actor = a; next(); });
  const wrap = (f: (req: express.Request) => unknown): express.RequestHandler => (req, res) => { try { res.json(f(req)); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Failed' }); } };
  const id = (req: express.Request) => String(req.params.id);
  const actor = (req: express.Request) => String((req as any).actor);
  r.get('/handlers', wrap(() => ({ handlers: s.handlerIds() })));
  r.get('/jobs', wrap(() => ({ jobs: s.list() })));
  r.get('/jobs/:id', wrap(req => { const j = s.get(id(req)); if (!j) throw new Error('unknown job'); return { job: j, audit: s.auditFor(j.id) }; }));
  r.get('/audit/verify', wrap(() => s.verifyAudit()));
  r.post('/jobs', wrap(req => ({ job: s.submit({ handler: req.body?.handler, params: req.body?.params, idempotencyKey: req.body?.idempotency_key, runAt: req.body?.run_at_ms, everyMs: req.body?.every_ms, maxRuns: req.body?.max_runs, maxAttempts: req.body?.max_attempts }, actor(req)) })));
  r.post('/jobs/:id/pause', wrap(req => ({ job: s.pause(id(req), actor(req)) })));
  r.post('/jobs/:id/resume', wrap(req => ({ job: s.resume(id(req), actor(req)) })));
  r.post('/jobs/:id/cancel', wrap(req => ({ job: s.cancel(id(req), actor(req)) })));
  r.post('/jobs/:id/retry', wrap(req => ({ job: s.retry(id(req), actor(req)) })));
  r.post('/jobs/:id/decision', wrap(req => ({ job: s.decide(id(req), actor(req), req.body?.approve === true, String(req.body?.proposal_hash || '')) })));
  return r;
}
