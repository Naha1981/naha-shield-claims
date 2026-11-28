// Kill switch + incident log, executing docs/false-flag-incident-response.md
// (Thabiso's spec 1 section 3). Sample data only. The kill switch disables
// a rule, model, agent or integration in memory; the incident log records the
// response workflow steps with hash-chained entries. Notifications are
// recorded, never sent (no external contact).

import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { accessOf, DEMO_ROLE_MAP, type Access, type SpecRole } from './rbacMatrix';
import { authUserOf } from './auth';

type Severity = 'S1' | 'S2' | 'S3' | 'S4';
type KillTargetType = 'rule' | 'model' | 'agent' | 'integration';
interface KillSwitch { target_type: KillTargetType; target_id: string; disabled: boolean; disabled_by?: string; reason?: string; incident_id?: string; disabled_at?: string; history: { at: string; by: string; action: 'disabled' | 're_enabled'; reason?: string }[] }
interface Incident {
  incident_id: string; tenant_id: string; severity: Severity; trigger: string; status: 'open' | 'mitigating' | 'resolved' | 'closed';
  affected_claim_ids: string[]; affected_target?: { type: KillTargetType; id: string };
  steps: { step: string; at: string; by: string; notes?: string }[];
  notifications: { to_role: string; at: string; dispatched: false }[];
  root_cause?: string; correction?: string; created_at: string; closed_at?: string;
}
interface AuditEntry { seq: number; at: string; actor: string; action: string; details: Record<string, unknown>; prev_hash: string; hash: string }

const switches = new Map<string, KillSwitch>(); // key `${target_type}:${target_id}`
const incidents = new Map<string, Incident>();
const auditLog: AuditEntry[] = [];
let seq = 0;
const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const SEVERITY_RESPONSE_HOURS: Record<Severity, number> = { S1: 1, S2: 4, S3: 24, S4: 72 };
export const WORKFLOW_STEPS = ['detect', 'classify_severity', 'freeze_automated_action', 'preserve_evidence', 'assess_claimant_impact', 'correct_claim_status', 'notify_claimant_if_affected', 'root_cause_analysis', 'correct_rule_model_or_data', 'test_fix', 'resume_workflow', 'report_and_close'];

function audit(actor: string, action: string, details: Record<string, unknown>) {
  const prev = auditLog[auditLog.length - 1];
  const prev_hash = prev ? prev.hash : 'GENESIS';
  const e: AuditEntry = { seq: auditLog.length + 1, at: now(), actor, action, details, prev_hash, hash: '' };
  e.hash = sha(JSON.stringify([prev_hash, e.seq, e.at, e.actor, e.action, e.details]));
  auditLog.push(e);
}

const KNOWN_ROLES: SpecRole[] = ['policyholder', 'beneficiary', 'agent', 'assessor', 'claims_manager', 'investigator', 'senior_investigator', 'head_of_recoveries', 'finance', 'compliance', 'legal', 'executive', 'insurer_admin', 'nahalabs_support'];
function subjectOf(req: express.Request): { role: SpecRole; tenant_id: string; user_id: string } {
  const auth = authUserOf(req);
  if (auth) return { role: auth.user.role as SpecRole, tenant_id: auth.user.tenant_id, user_id: auth.user.user_id };
  const demoHeader = String(req.headers['x-nahashield-demo-role'] ?? '');
  const role = (DEMO_ROLE_MAP[demoHeader] ?? demoHeader) as SpecRole;
  return { role: KNOWN_ROLES.includes(role) ? role : 'compliance', tenant_id: String(req.headers['x-tenant-id'] ?? 'ten_demo'), user_id: 'usr_demo' };
}

// The engine and APIs consult this before acting on a rule/model/integration.
export function isDisabled(target_type: KillTargetType, target_id: string): boolean {
  return switches.get(`${target_type}:${target_id}`)?.disabled === true;
}

export function incidentControlRoutes(): express.Router {
  const r = express.Router();
  r.use((req, res, next) => { res.setHeader('x-request-id', String(req.headers['x-request-id'] ?? `req_${randomUUID()}`)); next(); });

  const needKillSwitchRight = (req: express.Request, res: express.Response): { role: SpecRole; tenant_id: string; user_id: string } | null => {
    const s = subjectOf(req);
    if (accessOf(s.role, 'kill_switch') === 'no') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only compliance or an insurer administrator can operate the kill switch.' } }); return null; }
    return s;
  };

  // Disable a rule, model, agent or integration immediately (S1 first action).
  r.post('/kill-switch/:type/:id/disable', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    const type = String(req.params.type) as KillTargetType;
    if (!['rule', 'model', 'agent', 'integration'].includes(type)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'type must be rule, model, agent or integration.' } });
    const key = `${type}:${req.params.id}`;
    const ks = switches.get(key) ?? { target_type: type, target_id: String(req.params.id), disabled: false, history: [] };
    ks.disabled = true;
    ks.disabled_by = s.user_id;
    ks.reason = req.body?.reason;
    ks.incident_id = req.body?.incident_id;
    ks.disabled_at = now();
    ks.history.push({ at: ks.disabled_at, by: s.user_id, action: 'disabled', reason: ks.reason });
    switches.set(key, ks);
    audit(s.user_id, 'kill_switch.disabled', { target_type: type, target_id: ks.target_id, reason: ks.reason ?? null, incident_id: ks.incident_id ?? null });
    res.json({ ...ks, message: `${type} ${ks.target_id} is disabled. No automated action from it will run until a human re-enables it.` });
  });

  // Re-enable only after the incident workflow records test_fix + resume_workflow.
  r.post('/kill-switch/:type/:id/enable', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    const key = `${req.params.type}:${req.params.id}`;
    const ks = switches.get(key);
    if (!ks || !ks.disabled) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No disabled target found under that id.' } });
    if (ks.incident_id) {
      const inc = incidents.get(ks.incident_id);
      const done = new Set(inc?.steps.map((st) => st.step) ?? []);
      if (!done.has('test_fix') || !done.has('resume_workflow')) {
        return res.status(422).json({ error: { code: 'BUSINESS_RULE_VIOLATION', message: 'The linked incident must record test_fix and resume_workflow before re-enabling. The response plan requires a tested fix first.' } });
      }
    }
    ks.disabled = false;
    ks.history.push({ at: now(), by: s.user_id, action: 're_enabled', reason: req.body?.reason });
    audit(s.user_id, 'kill_switch.re_enabled', { target_type: ks.target_type, target_id: ks.target_id });
    res.json(ks);
  });

  r.get('/kill-switch', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    res.json({ items: [...switches.values()] });
  });

  // Open an incident: classify severity, freeze the affected automation, start the workflow.
  r.post('/incidents', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    const b = req.body ?? {};
    if (!b.severity || !['S1', 'S2', 'S3', 'S4'].includes(b.severity)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'severity must be S1, S2, S3 or S4.' } });
    if (!b.trigger) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'trigger is required.' } });
    const inc: Incident = {
      incident_id: `inc_${(++seq).toString(36).padStart(8, '0')}`, tenant_id: s.tenant_id, severity: b.severity, trigger: String(b.trigger), status: 'open',
      affected_claim_ids: b.affected_claim_ids ?? [], affected_target: b.affected_target,
      steps: [
        { step: 'detect', at: now(), by: s.user_id, notes: b.trigger },
        { step: 'classify_severity', at: now(), by: s.user_id, notes: `${b.severity}: respond within ${SEVERITY_RESPONSE_HOURS[b.severity as Severity]} hour(s)` },
      ],
      notifications: [
        { to_role: 'incident_commander', at: now(), dispatched: false },
        { to_role: 'claims_owner', at: now(), dispatched: false },
      ],
      created_at: now(),
    };
    incidents.set(inc.incident_id, inc);
    audit(s.user_id, 'incident.opened', { incident_id: inc.incident_id, severity: inc.severity, trigger: inc.trigger });
    // Freeze the affected automated action (response workflow step 3).
    if (b.affected_target?.type && b.affected_target?.id) {
      const key = `${b.affected_target.type}:${b.affected_target.id}`;
      const ks = switches.get(key) ?? { target_type: b.affected_target.type as KillTargetType, target_id: String(b.affected_target.id), disabled: false, history: [] };
      ks.disabled = true;
      ks.disabled_by = s.user_id;
      ks.incident_id = inc.incident_id;
      ks.disabled_at = now();
      ks.history.push({ at: ks.disabled_at, by: s.user_id, action: 'disabled', reason: `incident ${inc.incident_id}` });
      switches.set(key, ks);
      inc.steps.push({ step: 'freeze_automated_action', at: now(), by: s.user_id, notes: `${b.affected_target.type} ${b.affected_target.id} disabled` });
      audit(s.user_id, 'kill_switch.disabled', { target_type: b.affected_target.type, target_id: b.affected_target.id, incident_id: inc.incident_id });
    }
    res.status(201).json({ ...inc, response_due_within_hours: SEVERITY_RESPONSE_HOURS[inc.severity], note: 'Notifications are recorded for the on-call process; ClaimTrace never sends messages itself.' });
  });

  // Record a workflow step (preserve evidence, assess impact, correct, test, resume...).
  r.post('/incidents/:id/steps', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    const inc = incidents.get(String(req.params.id));
    if (!inc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Incident not found.' } });
    if (inc.tenant_id !== s.tenant_id) return res.status(403).json({ error: { code: 'TENANT_ACCESS_DENIED', message: 'This record belongs to another organisation.' } });
    const b = req.body ?? {};
    if (!b.step || !WORKFLOW_STEPS.includes(b.step)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `step must be one of: ${WORKFLOW_STEPS.join(', ')}` } });
    inc.steps.push({ step: String(b.step), at: now(), by: s.user_id, notes: b.notes });
    if (b.step === 'root_cause_analysis') inc.root_cause = b.notes;
    if (b.step === 'correct_rule_model_or_data') inc.correction = b.notes;
    if (b.step === 'report_and_close') { inc.status = 'closed'; inc.closed_at = now(); }
    else if (inc.status === 'open') inc.status = 'mitigating';
    audit(s.user_id, 'incident.step', { incident_id: inc.incident_id, step: b.step });
    res.json(inc);
  });

  r.get('/incidents', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    res.json({ items: [...incidents.values()].filter((i) => i.tenant_id === s.tenant_id) });
  });

  r.get('/incidents/:id', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    const inc = incidents.get(String(req.params.id));
    if (!inc || inc.tenant_id !== s.tenant_id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Incident not found.' } });
    res.json(inc);
  });

  // Hash-chained incident + kill-switch audit trail.
  r.get('/incident-audit', (req, res) => {
    const s = needKillSwitchRight(req, res); if (!s) return;
    let prev = 'GENESIS';
    let valid = true;
    for (const e of auditLog) {
      if (e.prev_hash !== prev || e.hash !== sha(JSON.stringify([e.prev_hash, e.seq, e.at, e.actor, e.action, e.details]))) { valid = false; break; }
      prev = e.hash;
    }
    res.json({ chain_valid: valid, entries: auditLog });
  });

  return r;
}

export function resetIncidentStore() { switches.clear(); incidents.clear(); auditLog.length = 0; seq = 0; }
