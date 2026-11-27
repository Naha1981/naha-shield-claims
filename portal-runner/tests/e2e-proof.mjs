// End-to-end proof for the isolated synthetic portal runner.
// Spawns the real NahaShield server (dev middleware, loopback), drives the
// ported browser worker through positive and negative flows, proves the
// human-approval stop, proves reviewer approval gating, then seals the
// screenshots into the Evidence Vault and verifies the hash chain.
// Run: node tests/e2e-proof.mjs   (from portal-runner/, deps installed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyAudit } from '../audit.mjs';

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WORKER, '..');
const EVIDENCE = path.join(WORKER, 'evidence');
const DATA = path.join(WORKER, 'data');
const results = { started_at: new Date().toISOString(), checks: {} };
const fail = (msg) => {
  console.error('E2E_PROOF_FAILED:', msg);
  console.error(JSON.stringify(results, null, 2));
  process.exit(1);
};

// Clean runtime state (never committed).
for (const d of [EVIDENCE, DATA, path.join(WORKER, 'computer'), path.join(WORKER, 'skills')]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

// --- 1. NahaShield app server (dev middleware, loopback portal target) ------
const serverLog = fs.openSync(path.join(EVIDENCE, 'shield.log'), 'a');
const server = spawn(path.join(REPO, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
  cwd: REPO,
  env: { ...process.env, PORT: '4311', GEMINI_API_KEY: '', DATABASE_URL: '' },
  stdio: ['ignore', serverLog, serverLog],
});
async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
if (!(await waitFor('http://127.0.0.1:4311/api/health'))) fail('NahaShield server did not start');
results.checks.server_started = true;

const stateBefore = JSON.parse(
  fs.readFileSync(path.join(REPO, '.data', 'nahashield-state.json'), 'utf8'),
);
const evidenceBefore = stateBefore.evidence_items.length;
const decisionsBefore = stateBefore.decisions.length;

// --- 2. Drive the browser worker over stdio JSON-RPC ------------------------
const child = spawn(process.execPath, [path.join(WORKER, 'computer-mcp.mjs')], {
  cwd: WORKER,
  env: { ...process.env, WORKER_ROOT: WORKER },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let seq = 0;
const waiting = new Map();
let buffer = '';
child.stdout.on('data', (b) => {
  buffer += b;
  for (;;) {
    const i = buffer.indexOf('\n');
    if (i < 0) break;
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    waiting.get(j.id)?.(j.result);
    waiting.delete(j.id);
  }
});
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });

await new Promise((r) => setTimeout(r, 1500));

// Negative: real case ref denied before any browser opens.
const wrongCase = await call('open_case', { case_id: 'REAL-CLAIM' });
results.checks.wrong_case_denied = wrongCase.isError === true;
if (!wrongCase.isError) fail('open_case accepted a non-synthetic case');

// Positive: open the assigned synthetic case on the loopback portal.
const opened = await call('open_case', { case_id: 'SYN-RC-004' });
results.checks.opened_synthetic_case = !opened.isError;
if (opened.isError) fail('open_case SYN-RC-004 failed: ' + opened.content?.[0]?.text);

const page1 = await call('read_page');
results.checks.read_case_page = !page1.isError && page1.content[0].text.length > 200;

// Negative: unlisted button and unlisted field denied.
const forbiddenButton = await call('click_button', { name: 'Record Signed Human Decision' });
results.checks.forbidden_button_denied = forbiddenButton.isError === true;
if (!forbiddenButton.isError) fail('click_button allowed an unlisted button');
const forbiddenField = await call('fill_draft_field', { field: 'reviewer', value: 'Forged signer' });
results.checks.forbidden_field_denied = forbiddenField.isError === true;
if (!forbiddenField.isError) fail('fill_draft_field allowed an unlisted field');

// Positive: fill allowlisted draft fields, open the safe preview, screenshot.
const fill = await call('fill_draft_field', {
  field: 'decision-note',
  value: 'DRAFT ONLY - HUMAN REVIEW REQUIRED. Synthetic portal runner e2e proof.',
});
results.checks.draft_field_filled = !fill.isError;
const safeClick = await call('click_button', { name: 'Generate Attorney / AFU Handover Pack' });
results.checks.safe_preview_clicked = !safeClick.isError;
const shot = await call('capture_screenshot', { name: '01-case-opened.png' });
results.checks.screenshot_hashed = !shot.isError && /^[0-9a-f]{64}$/.test(JSON.parse(shot.content[0].text).sha256);

const checkpointRaw = await call('save_checkpoint');
if (checkpointRaw.isError) fail('save_checkpoint failed');
const checkpoint = JSON.parse(checkpointRaw.content[0].text);
results.checks.checkpoint_waiting_human = checkpoint.status === 'WAITING_HUMAN_APPROVAL';
results.checks.checkpoint_digest = /^[0-9a-f]{64}$/.test(checkpoint.digest);

const submission = await call('request_final_submission');
const submissionBody = JSON.parse(submission.content[0].text);
results.checks.final_submission_held =
  submissionBody.status === 'HUMAN_APPROVAL_REQUIRED' && submissionBody.submitted === false;
if (!results.checks.final_submission_held) fail('final submission was not held for human approval');

child.stdin.end();
await new Promise((r) => setTimeout(r, 800));
child.kill();

// --- 2b. Capture-mode worker: read-only map/address capture -----------------
let capBuffer = '';
const capWaiting = new Map();
let capSeq = 0;
const cap = spawn(process.execPath, [path.join(WORKER, 'computer-mcp.mjs')], {
  cwd: WORKER,
  env: { ...process.env, WORKER_ROOT: WORKER, PORTAL_RUNNER_MODE: 'capture' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
cap.stdout.on('data', (b) => {
  capBuffer += b;
  for (;;) {
    const i = capBuffer.indexOf('\n');
    if (i < 0) break;
    const line = capBuffer.slice(0, i);
    capBuffer = capBuffer.slice(i + 1);
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    capWaiting.get(j.id)?.(j.result);
    capWaiting.delete(j.id);
  }
});
const capCall = (name, args = {}) =>
  new Promise((resolve) => {
    const id = ++capSeq;
    capWaiting.set(id, resolve);
    cap.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
  });
await new Promise((r) => setTimeout(r, 1200));

const capFill = await capCall('fill_draft_field', { field: 'decision-note', value: 'x' });
results.checks.capture_mode_denies_fill = capFill.isError === true;
const capClick = await capCall('click_button', { name: 'Generate Attorney / AFU Handover Pack' });
results.checks.capture_mode_denies_click = capClick.isError === true;
const capSubmit = await capCall('request_final_submission');
results.checks.capture_mode_denies_submit = capSubmit.isError === true;
const capBad = await capCall('capture_url', { url: 'https://evil.example.org/x.png' });
results.checks.capture_url_requester_origin_denied =
  capBad.isError === true && capBad.content[0].text.includes('CAPTURE_ORIGIN_DENIED');

const capOk = await capCall('capture_url', {
  url: 'http://127.0.0.1:4311/recovery',
  name: 'map-preview.png',
  wait_ms: 2500,
});
results.checks.capture_url_allowlisted_ok = !capOk.isError;
if (capOk.isError) fail('capture_url on allowlisted loopback preview failed: ' + capOk.content?.[0]?.text);
const art = JSON.parse(capOk.content[0].text);
const png = fs.readFileSync(path.join(EVIDENCE, 'map-preview.png'));
results.checks.capture_screenshot_real_png =
  png.length > 10000 && png[0] === 0x89 && png[1] === 0x50;
const sidecar = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'map-preview.json'), 'utf8'));
results.checks.capture_sidecar_provenance =
  sidecar.source_url === 'http://127.0.0.1:4311/recovery' &&
  sidecar.watermark.includes('UNVERIFIED');
results.checks.capture_sha256_matches =
  art.sha256 === crypto.createHash('sha256').update(png).digest('hex');
cap.stdin.end();
await new Promise((r) => setTimeout(r, 600));
cap.kill();

// --- 2c. Record-and-replay skills -------------------------------------------
let recBuffer = '';
const recWaiting = new Map();
let recSeq = 0;
const rec = spawn(process.execPath, [path.join(WORKER, 'computer-mcp.mjs')], {
  cwd: WORKER,
  env: { ...process.env, WORKER_ROOT: WORKER },
  stdio: ['pipe', 'pipe', 'inherit'],
});
rec.stdout.on('data', (b) => {
  recBuffer += b;
  for (;;) {
    const i = recBuffer.indexOf('\n');
    if (i < 0) break;
    const line = recBuffer.slice(0, i);
    recBuffer = recBuffer.slice(i + 1);
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    recWaiting.get(j.id)?.(j.result);
    recWaiting.delete(j.id);
  }
});
const recCall = (name, args = {}) =>
  new Promise((resolve) => {
    const id = ++recSeq;
    recWaiting.set(id, resolve);
    rec.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
  });
await new Promise((r) => setTimeout(r, 1200));

// Record: demonstrate the FNOL flow once.
await recCall('open_case', { case_id: 'SYN-RC-004' });
await recCall('start_recording');
await recCall('fill_draft_field', {
  field: 'decision-note',
  value: 'FNOL demo: hail damage reported 2026-11-26. DRAFT ONLY - HUMAN REVIEW REQUIRED.',
});
await recCall('click_button', { name: 'Generate Attorney / AFU Handover Pack' });
const stopped = await recCall('stop_recording', { name: 'fnol-demo' });
results.checks.skill_recorded = !stopped.isError;
if (stopped.isError) fail('stop_recording failed: ' + stopped.content?.[0]?.text);
const recordedSkill = JSON.parse(stopped.content[0].text);
results.checks.skill_digest_format = /^[0-9a-f]{64}$/.test(recordedSkill.steps_digest);
const skillFile = JSON.parse(fs.readFileSync(path.join(WORKER, 'skills', 'fnol-demo.json'), 'utf8'));
results.checks.skill_has_recorded_steps =
  skillFile.steps.some((s) => s.action === 'fill' && s.selector === '#decision-note') &&
  skillFile.steps.some((s) => s.action === 'click_button');

// Auto-save: the successful workflow above checkpoints into an auto skill.
const cp2 = await recCall('save_checkpoint');
const cp2Body = JSON.parse(cp2.content[0].text);
results.checks.skill_autosaved =
  Boolean(cp2Body.auto_skill) && cp2Body.auto_skill.skill_id.startsWith('auto-syn-rc-004-');
const listed = await recCall('list_skills');
results.checks.skills_listed =
  !listed.isError && JSON.parse(listed.content[0].text).length >= 2;

// Replay gates: no approval -> denied; tampered digest -> denied.
const noApproval = await recCall('replay_skill', { skill_id: 'fnol-demo', approval_token: 'forged' });
results.checks.replay_without_approval_denied =
  noApproval.isError === true && noApproval.content[0].text.includes('SKILL_APPROVAL_REQUIRED');
const tamperedSkill = { ...skillFile, steps: skillFile.steps.map((s, i) => (i === 2 ? { ...s, value: 'altered after approval' } : s)) };
fs.writeFileSync(path.join(WORKER, 'skills', 'fnol-tampered.json'), JSON.stringify(tamperedSkill, null, 2));
const tampered = await recCall('replay_skill', { skill_id: 'fnol-tampered', approval_token: 'whatever' });
results.checks.tampered_skill_digest_denied =
  tampered.isError === true && tampered.content[0].text.includes('SKILL_DIGEST_MISMATCH');

// Hostile skill: submit step with a CORRECT digest — approval is not enough.
const canonicalJson = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? '[' + v.map(canonicalJson).join(',') + ']'
      : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
const hostileSteps = [
  { action: 'goto', path: '/recovery' },
  { action: 'click_text', text: 'SYN-RC-004' },
  { action: 'click_button', name: 'Record Signed Human Decision' },
];
fs.writeFileSync(
  path.join(WORKER, 'skills', 'fnol-hostile.json'),
  JSON.stringify(
    {
      ...skillFile,
      skill_id: 'fnol-hostile',
      name: 'fnol-hostile',
      steps: hostileSteps,
      steps_digest: crypto.createHash('sha256').update(canonicalJson(hostileSteps), 'utf8').digest('hex'),
    },
    null,
    2,
  ),
);


// --- 3. Prove nothing reached the app: no writes, no decisions, chain ok ----
const stateAfter = JSON.parse(
  fs.readFileSync(path.join(REPO, '.data', 'nahashield-state.json'), 'utf8'),
);
results.checks.decisions_unchanged = stateAfter.decisions.length === decisionsBefore;
results.checks.evidence_unchanged_by_runner = stateAfter.evidence_items.length === evidenceBefore;
const actionRows = fs
  .readFileSync(path.join(EVIDENCE, 'browser-actions.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
results.checks.zero_write_or_network_denials_needed =
  actionRows.filter((r) => r.event === 'write-denied').length === 0;
const auditRows = fs
  .readFileSync(path.join(EVIDENCE, 'worker-audit.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
results.checks.audit_chain_valid = verifyAudit(auditRows).valid;
if (!results.checks.decisions_unchanged) fail('runner mutated app decisions');

// --- 4. Reviewer approval gate: sealing without approval must refuse --------
const reportFile = path.join(EVIDENCE, 'portal-run-report.json');
fs.writeFileSync(
  reportFile,
  JSON.stringify({ case_ref: 'SYN-RC-004', checkpoint, generated_at: new Date().toISOString() }),
);
// Reviewer surface gets its own evidence dir so only true runner captures seal.
const REVIEW_EVIDENCE = path.join(EVIDENCE, 'reviewer');
fs.mkdirSync(REVIEW_EVIDENCE, { recursive: true });
const receipts = ['01-case-opened.png', 'draft-checkpoint.png']
  .filter((f) => fs.existsSync(path.join(EVIDENCE, f)))
  .map((f, i) => ({
    evidence_id: `RUN-SHOT-${String(i + 1).padStart(2, '0')}`,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(EVIDENCE, f))).digest('hex'),
  }));
for (const [i, r] of receipts.entries()) {
  fs.copyFileSync(
    path.join(EVIDENCE, ['01-case-opened.png', 'draft-checkpoint.png'][i]),
    path.join(REVIEW_EVIDENCE, r.evidence_id + '.png'),
  );
}
fs.writeFileSync(path.join(REVIEW_EVIDENCE, 'vault-receipts.json'), JSON.stringify(receipts));
fs.writeFileSync(path.join(REVIEW_EVIDENCE, 'address-evidence-report.json'), fs.readFileSync(reportFile));

let seal = spawnSync(
  process.execPath,
  [path.join(WORKER, 'seal-to-vault.mjs'), '--approval-token', 'forged-token', '--case', 'SYN-RC-004'],
  { env: { ...process.env, WORKER_ROOT: WORKER, REVIEWER_DATA_DIR: DATA }, encoding: 'utf8' },
);
results.checks.seal_without_approval_refused =
  seal.status === 1 && seal.stderr.includes('REVIEWER_APPROVAL_REQUIRED');
if (!results.checks.seal_without_approval_refused) fail('seal-to-vault did not refuse a forged token');

// Enroll a synthetic reviewer and run the real approval flow over HTTP.
const reviewerPassword = 'synthetic-e2e-reviewer-not-a-secret';
fs.writeFileSync(
  path.join(DATA, 'reviewer-credential.json'),
  JSON.stringify({
    username: 'e2e-reviewer',
    principal: 'synthetic-e2e-reviewer-NOT-HUMAN',
    role: 'reviewer',
    salt: 'e2e-salt',
    password_hash: crypto.scryptSync(reviewerPassword, 'e2e-salt', 64).toString('hex'),
  }),
);
const reviewer = spawn(process.execPath, [path.join(WORKER, 'staging-server.mjs')], {
  cwd: WORKER,
  env: {
    ...process.env,
    DATA_DIR: DATA,
    EVIDENCE_DIR: REVIEW_EVIDENCE,
    APP_ORIGIN: 'http://127.0.0.1:4320',
    PORT: '4320',
    REVIEW_ACTION_TYPES: 'INTERNAL_SYNTHETIC_REPORT_REVIEW,SKILL_REPLAY',
  },
  stdio: ['ignore', serverLog, serverLog],
});
if (!(await waitFor('http://127.0.0.1:4320/health', 30))) fail('reviewer server did not start');

const loginRes = await fetch('http://127.0.0.1:4320/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:4320' },
  body: JSON.stringify({ username: 'e2e-reviewer', password: reviewerPassword }),
});
if (!loginRes.ok) fail('reviewer login failed');
const cookie = loginRes.headers.get('set-cookie').split(';')[0];
const stateRes = await fetch('http://127.0.0.1:4320/api/state', { headers: { cookie } });
const reviewerState = await stateRes.json();
results.checks.session_role_from_credential = reviewerState.role === 'reviewer';
const approveRes = await fetch('http://127.0.0.1:4320/api/approve', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:4320',
    cookie,
    'x-csrf-token': reviewerState.csrf,
  },
  body: JSON.stringify({ digest: reviewerState.action.digest }),
});
if (!approveRes.ok) fail('approval token issue failed: ' + (await approveRes.text()));
const { token } = await approveRes.json();
const recordRes = await fetch('http://127.0.0.1:4320/api/record-review', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:4320',
    cookie,
    'x-csrf-token': reviewerState.csrf,
  },
  body: JSON.stringify({ token }),
});
const recorded = await recordRes.json();
results.checks.human_review_recorded = recorded.external_action === false;

// Skill replay approvals (bound to the recomputed digest of each skill file).
async function approveSkill(skillId) {
  const r1 = await fetch('http://127.0.0.1:4320/api/approve-skill', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:4320',
      cookie,
      'x-csrf-token': reviewerState.csrf,
    },
    body: JSON.stringify({ skill_id: skillId }),
  });
  if (!r1.ok) return { error: (await r1.json()).error };
  const { token: t } = await r1.json();
  const r2 = await fetch('http://127.0.0.1:4320/api/record-skill-review', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:4320',
      cookie,
      'x-csrf-token': reviewerState.csrf,
    },
    body: JSON.stringify({ token: t, skill_id: skillId }),
  });
  if (!r2.ok) return { error: (await r2.json()).error };
  return { token: t };
}
const fnolApproval = await approveSkill('fnol-demo');
results.checks.skill_approval_issued = typeof fnolApproval.token === 'string';
const hostileApproval = await approveSkill('fnol-hostile');
results.checks.hostile_skill_approval_issued = typeof hostileApproval.token === 'string';
const tamperedApproval = await approveSkill('fnol-tampered');
results.checks.tampered_skill_approval_refused = tamperedApproval.error === 'SKILL_DIGEST_MISMATCH';

// Replay the approved skills in the recording worker.
const replayed = await recCall('replay_skill', {
  skill_id: 'fnol-demo',
  approval_token: fnolApproval.token,
});
results.checks.skill_replay_completed =
  !replayed.isError && JSON.parse(replayed.content[0].text).status === 'REPLAY_COMPLETED';
if (replayed.isError) fail('approved replay failed: ' + replayed.content?.[0]?.text);
const replayBody = JSON.parse(replayed.content[0].text);
results.checks.replay_not_submitted = replayBody.submitted === false;
results.checks.replay_screenshots = replayBody.screenshots.length >= 1;

// One-execution claim: the same approval token can never replay twice.
const reuseReplay = await recCall('replay_skill', {
  skill_id: 'fnol-demo',
  approval_token: fnolApproval.token,
});
results.checks.replay_token_reuse_denied =
  reuseReplay.isError === true && reuseReplay.content[0].text.includes('SKILL_REPLAY_TOKEN_SPENT');

// Concurrent claims: two worker processes race one fresh approval token;
// exactly one replay wins, the other is denied.
const raceApproval = await approveSkill('fnol-demo');
results.checks.skill_reapproval_issued = typeof raceApproval.token === 'string';
const WORKER2 = path.join(WORKER, 'computer', 'worker2-root');
fs.mkdirSync(WORKER2, { recursive: true });
let w2Buffer = '';
const w2Waiting = new Map();
let w2Seq = 0;
const worker2 = spawn(process.execPath, [path.join(WORKER, 'computer-mcp.mjs')], {
  cwd: WORKER,
  env: {
    ...process.env,
    WORKER_ROOT: WORKER2,
    EVIDENCE_DIR: path.join(WORKER2, 'evidence'),
    SKILLS_DIR: path.join(WORKER, 'skills'),
    REVIEWER_DATA_DIR: DATA,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
worker2.stdout.on('data', (b) => {
  w2Buffer += b;
  for (;;) {
    const i = w2Buffer.indexOf('\n');
    if (i < 0) break;
    const line = w2Buffer.slice(0, i);
    w2Buffer = w2Buffer.slice(i + 1);
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    w2Waiting.get(j.id)?.(j.result);
    w2Waiting.delete(j.id);
  }
});
const w2Call = (name, args = {}) =>
  new Promise((resolve) => {
    const id = ++w2Seq;
    w2Waiting.set(id, resolve);
    worker2.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
  });
await new Promise((r) => setTimeout(r, 1200));
const w2Open = await w2Call('open_case', { case_id: 'SYN-RC-004' });
if (w2Open.isError) fail('worker2 open_case failed: ' + w2Open.content?.[0]?.text);
const [raceA, raceB] = await Promise.all([
  recCall('replay_skill', { skill_id: 'fnol-demo', approval_token: raceApproval.token }),
  w2Call('replay_skill', { skill_id: 'fnol-demo', approval_token: raceApproval.token }),
]);
const raceWins = [raceA, raceB].filter(
  (r) => !r.isError && JSON.parse(r.content[0].text).status === 'REPLAY_COMPLETED',
);
const raceDenials = [raceA, raceB].filter(
  (r) => r.isError && /SKILL_REPLAY_TOKEN_SPENT|SKILL_CLAIM_CONTESTED/.test(r.content[0].text),
);
results.checks.concurrent_claim_single_winner = raceWins.length === 1 && raceDenials.length === 1;
results.race_debug = [raceA, raceB].map((r) =>
  r.isError ? 'ERR: ' + r.content[0].text : 'OK: ' + r.content[0].text.slice(0, 120),
);
worker2.stdin.end();
await new Promise((r) => setTimeout(r, 600));
worker2.kill();

const hostileReplay = await recCall('replay_skill', {
  skill_id: 'fnol-hostile',
  approval_token: hostileApproval.token,
});
results.checks.hostile_replay_step_denied =
  hostileReplay.isError === true && hostileReplay.content[0].text.includes('SKILL_STEP_DENIED');

// Allowlist gates: fills outside the registered draft fields and navigation
// outside the synthetic recovery page are denied even with a correct digest
// and a valid approval — and a statically denied skill never spends its token.
const craftSkill = (skillId, steps) => {
  fs.writeFileSync(
    path.join(WORKER, 'skills', skillId + '.json'),
    JSON.stringify(
      {
        ...skillFile,
        skill_id: skillId,
        name: skillId,
        steps,
        steps_digest: crypto.createHash('sha256').update(canonicalJson(steps), 'utf8').digest('hex'),
      },
      null,
      2,
    ),
  );
};
craftSkill('fnol-badfield', [
  { action: 'goto', path: '/recovery' },
  { action: 'click_text', text: 'SYN-RC-004' },
  { action: 'fill', selector: '#reviewer', value: 'Forged signer' },
]);
craftSkill('fnol-badnav', [
  { action: 'goto', path: '/admin' },
  { action: 'click_text', text: 'SYN-RC-004' },
]);
const badFieldApproval = await approveSkill('fnol-badfield');
results.checks.badfield_skill_approval_issued = typeof badFieldApproval.token === 'string';
const badFieldReplay = await recCall('replay_skill', {
  skill_id: 'fnol-badfield',
  approval_token: badFieldApproval.token,
});
results.checks.replay_field_not_allowlisted_denied =
  badFieldReplay.isError === true && badFieldReplay.content[0].text.includes('SKILL_STEP_DENIED');
const badNavApproval = await approveSkill('fnol-badnav');
const badNavReplay = await recCall('replay_skill', {
  skill_id: 'fnol-badnav',
  approval_token: badNavApproval.token,
});
results.checks.replay_navigation_outside_recovery_denied =
  badNavReplay.isError === true && badNavReplay.content[0].text.includes('SKILL_STEP_DENIED');
const claimsStore = JSON.parse(fs.readFileSync(path.join(DATA, 'skill-claims.json'), 'utf8'));
const claimKeyOf = (t) => crypto.createHash('sha256').update(t).digest('hex');
results.checks.static_denial_does_not_spend_token =
  Boolean(claimsStore[claimKeyOf(fnolApproval.token)]) &&
  !claimsStore[claimKeyOf(badFieldApproval.token)] &&
  !claimsStore[claimKeyOf(badNavApproval.token)] &&
  !claimsStore[claimKeyOf(hostileApproval.token)];

const stateAfterReplay = JSON.parse(
  fs.readFileSync(path.join(REPO, '.data', 'nahashield-state.json'), 'utf8'),
);
results.checks.decisions_unchanged_after_replay =
  stateAfterReplay.decisions.length === decisionsBefore;



// --- 5. Seal into the Evidence Vault with the consumed approval -------------
seal = spawnSync(
  process.execPath,
  [path.join(WORKER, 'seal-to-vault.mjs'), '--approval-token', token, '--case', 'SYN-RC-004'],
  { env: { ...process.env, WORKER_ROOT: WORKER, REVIEWER_DATA_DIR: DATA }, encoding: 'utf8' },
);
if (seal.status !== 0) fail('seal-to-vault failed after approval: ' + seal.stderr);
const sealOut = JSON.parse(seal.stdout);
results.checks.vault_sealed_count = sealOut.sealed_count;
results.checks.vault_chain_valid = sealOut.chain_valid === true;
results.checks.vault_bytes_match = sealOut.all_bytes_match === true;

const finalVerify = await fetch('http://127.0.0.1:4311/api/vault/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
const verifyBody = await finalVerify.json();
results.checks.live_vault_chain_valid = verifyBody.verification.valid === true;
results.checks.live_vault_item_growth = verifyBody.verification.checked_count - evidenceBefore;

reviewer.kill();
server.kill();
rec.kill();

results.finished_at = new Date().toISOString();
results.verdict = Object.values(results.checks).every((v) => v === true || (typeof v === 'number' && v >= 0))
  ? 'E2E_PROOF_PASSED'
  : 'E2E_PROOF_FAILED';
fs.writeFileSync(path.join(EVIDENCE, 'e2e-proof-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(results.verdict === 'E2E_PROOF_PASSED' ? 0 : 1);
