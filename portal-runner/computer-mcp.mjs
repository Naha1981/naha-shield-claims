// Ported from the isolated morning build (claims-worker-step1/computer-mcp.mjs).
// Changes from original: portal origin, assigned cases, draft fields, safe
// buttons and Chrome path are env-driven (defaults preserve the original
// behavior exactly); a loopback boot guard and a screenshot/capture tool were
// added for the shared capture-executor contract. Network-denial, write-denial,
// field/button allowlists, checkpoint digest and the HUMAN_APPROVAL_REQUIRED
// stop are unchanged in behavior.
//
// Transport: newline-delimited JSON-RPC over stdio (initialize, tools/list,
// tools/call), same as the original. executor-http.mjs wraps this over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { appendAudit, auditHeadHash } from './audit.mjs';

const ROOT = process.env.WORKER_ROOT || process.cwd();
const HOME = path.join(ROOT, 'computer');
const EVIDENCE = process.env.EVIDENCE_DIR || path.join(ROOT, 'evidence');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

const PORTAL_ORIGIN = process.env.PORTAL_ORIGIN || 'http://127.0.0.1:4311';

// "No real portals" guard, duplicated from src/lib/engine/captureExecutor.ts
// (this worker runs under plain node, so the TS engine cannot be imported).
function assertLoopbackHttpUrl(rawUrl) {
  const url = new URL(rawUrl);
  const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (url.protocol !== 'http:' || !loopback.has(url.hostname.toLowerCase())) {
    throw new Error(`PORTAL_URL_DENIED: ${rawUrl} is not a plain-http loopback origin`);
  }
  return url;
}
const portalUrl = assertLoopbackHttpUrl(PORTAL_ORIGIN);
const PORTAL_HOST = portalUrl.hostname;
const PORTAL_PORT = portalUrl.port || '80';

// 'portal' mode: full portal-run toolset. 'capture' mode: read-only image
// capture (read_page, capture_screenshot, capture_url, save_checkpoint);
// every fill/click/submit/case action is denied.
const MODE = process.env.PORTAL_RUNNER_MODE || 'portal';
if (MODE !== 'portal' && MODE !== 'capture') throw new Error('MODE_DENIED');
const CAPTURE_MODE_DENY = new Set([
  'open_case',
  'fill_draft_field',
  'click_button',
  'request_final_submission',
]);

// Exact-origin allowlist for map/address capture. Trusted env config ONLY —
// requesters can never add origins at call time. Remote origins must be
// https; http is accepted for loopback only (the local app map preview).
const CAPTURE_ORIGINS = (
  process.env.PORTAL_RUNNER_CAPTURE_ORIGINS ||
  'https://cdn.kartaview.org,https://tiles.openfreemap.org,http://127.0.0.1:4311'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((o) => {
    const u = new URL(o);
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
      u.hostname.toLowerCase(),
    );
    if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u.origin;
    throw new Error(`CAPTURE_ORIGIN_CONFIG_DENIED: ${o}`);
  });
const CAPTURE_WATERMARK = 'ADVISORY — UNVERIFIED VISUAL RECORD';

// Record-and-replay skills. Skills are data, never scripts: a recorded step
// list + a SHA-256 digest over the canonical step JSON. Replay verifies the
// digest, requires a consumed human approval token bound to it, stays on the
// loopback portal origin, and can never submit.
const SKILLS_DIR = process.env.SKILLS_DIR || path.join(ROOT, 'skills');
const REVIEWER_DATA = process.env.REVIEWER_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(SKILLS_DIR, { recursive: true });
const SKILL_NAME_SAFE = /^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/;
const SUBMIT_STEP_PATTERN = /record signed human decision|submit|send|final/i;

// Keep in sync with src/lib/engine/captureExecutor.ts canonicalJson.
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
const skillDigest = (steps) =>
  crypto.createHash('sha256').update(canonicalJson(steps), 'utf8').digest('hex');

let recording = false;
let recordedEvents = [];
const sessionCalls = [];

const RECORDER_SNIPPET = `(() => {
  if (window.__naharecInstalled) return; window.__naharecInstalled = true;
  const sel = (el) => el.id ? '#' + CSS.escape(el.id) : (el.name ? '[name="' + el.name + '"]' : el.tagName.toLowerCase());
  document.addEventListener('click', (e) => {
    if (typeof window.__naharec !== 'function') return;
    const b = e.target.closest('button, [role="button"], a');
    if (b) window.__naharec({ action: 'click_button', name: (b.innerText || '').trim() });
    else window.__naharec({ action: 'click_text', text: (e.target.innerText || '').trim().slice(0, 80) });
  }, true);
  const onEdit = (e) => {
    if (typeof window.__naharec !== 'function') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))
      window.__naharec({ action: 'fill', selector: sel(t), value: t.value });
  };
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);
})();`;

function normalizeRecordedSteps(events) {
  const steps = [];
  for (const ev of events) {
    if (ev.action === 'fill') {
      const last = steps[steps.length - 1];
      if (last && last.action === 'fill' && last.selector === ev.selector) {
        last.value = ev.value;
        continue;
      }
      steps.push({ action: 'fill', selector: ev.selector, value: ev.value });
    } else if (ev.action === 'click_button' && ev.name) {
      steps.push({ action: 'click_button', name: ev.name });
    } else if (ev.action === 'click_text' && ev.text) {
      steps.push({ action: 'click_text', text: ev.text });
    }
  }
  return steps;
}

function writeSkill(name, steps, createdBy) {
  if (!SKILL_NAME_SAFE.test(name)) throw Error('SKILL_NAME_DENIED');
  const skill = {
    skill_id: name,
    name,
    version: 1,
    created_at: new Date().toISOString(),
    created_by: createdBy,
    portal_origin: PORTAL_ORIGIN,
    case_ref: currentCase || 'SYN-RC-004',
    synthetic_only: true,
    steps,
  };
  skill.steps_digest = skillDigest(steps);
  const tmp = path.join(SKILLS_DIR, name + '.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(skill, null, 2));
  fs.renameSync(tmp, path.join(SKILLS_DIR, name + '.json'));
  log({ event: createdBy === 'auto' ? 'skill-autosaved' : 'skill-recorded', skill_id: name, steps: steps.length, digest: skill.steps_digest });
  return skill;
}

function verifySkillApproval(skill, token) {
  const securityFile = path.join(REVIEWER_DATA, 'reviewer-security.json');
  if (!fs.existsSync(securityFile)) throw Error('SKILL_APPROVAL_REQUIRED');
  const state = JSON.parse(fs.readFileSync(securityFile));
  const record = state.tokens[crypto.createHash('sha256').update(token).digest('hex')];
  if (
    !record ||
    record.used !== true ||
    record.type !== 'SKILL_REPLAY' ||
    record.claim_ref !== (skill.case_ref || 'SYN-RC-004') ||
    record.digest !== skill.steps_digest ||
    record.expires < Date.now()
  ) {
    throw Error('SKILL_APPROVAL_REQUIRED');
  }
  return record;
}

const SYN_REF = /^SYN-[A-Z0-9-]+$/;
const ASSIGNED_CASES = (process.env.PORTAL_RUNNER_ASSIGNED_CASES || 'SYN-RC-004')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const ref of ASSIGNED_CASES) {
  if (!SYN_REF.test(ref)) throw new Error(`NON_SYNTHETIC_CASE_DENIED: ${ref}`);
}

const ALLOWED_FIELDS = new Set(
  (process.env.PORTAL_RUNNER_DRAFT_FIELDS || 'decision-action,decision-reasons,decision-note')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const SAFE_BUTTONS = new Set(
  (
    process.env.PORTAL_RUNNER_SAFE_BUTTONS ||
    'Generate Attorney / AFU Handover Pack'
  )
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean),
);

const CHROME_PATH = process.env.PORTAL_RUNNER_CHROME || '/usr/bin/google-chrome';
const chromeExecutable = fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined;

let context, page;

const log = (event) => {
  const at = new Date().toISOString();
  fs.appendFileSync(
    path.join(EVIDENCE, 'browser-actions.jsonl'),
    JSON.stringify({ at, ...event }) + '\n',
  );
  appendAudit({ type: event.event, at, details: event });
};

async function init() {
  if (page && !page.isClosed()) return;
  context = await chromium.launchPersistentContext(path.join(HOME, 'chrome'), {
    ...(chromeExecutable ? { executablePath: chromeExecutable } : {}),
    headless: true,
    args: ['--no-sandbox'],
    viewport: { width: 1440, height: 1000 },
  });
  await context.exposeFunction('__naharec', (ev) => {
    if (recording) recordedEvents.push({ ...ev, at: new Date().toISOString() });
  });
  await context.addInitScript(RECORDER_SNIPPET);
  await context.route('**/*', async (route) => {
    const q = route.request();
    const u = new URL(q.url());
    const isPortal = u.hostname === PORTAL_HOST && (u.port || '80') === PORTAL_PORT;
    const isCaptureOrigin = CAPTURE_ORIGINS.includes(u.origin);
    if (!isPortal && !isCaptureOrigin) {
      log({ event: 'network-denied', host: u.hostname, port: u.port });
      return route.abort();
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') {
      log({ event: 'write-denied', method: q.method(), path: u.pathname });
      return route.abort();
    }
    return route.continue();
  });
  page = context.pages()[0] || (await context.newPage());
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function captureScreenshot(name) {
  const file = path.join(EVIDENCE, name);
  await page.screenshot({ path: file });
  const artifact = {
    filename: name,
    sha256: sha256File(file),
    byte_size: fs.statSync(file).size,
    captured_at: new Date().toISOString(),
  };
  log({ event: 'screenshot', ...artifact, url: page.url() });
  return artifact;
}

const defs = [
  {
    name: 'open_case',
    description:
      'Open a permitted local NahaShield synthetic case on the isolated loopback portal. Only assigned SYN-* cases are permitted.',
    inputSchema: {
      type: 'object',
      properties: { case_id: { type: 'string' } },
      required: ['case_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    description: 'Read visible text of the current permitted synthetic case page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'click_button',
    description:
      'Click only an allowlisted safe button (preview actions). Final decisions, sending and exports are not permitted.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'fill_draft_field',
    description:
      'Fill an unsent draft in an allowlisted draft field. No record is submitted.',
    inputSchema: {
      type: 'object',
      properties: { field: { type: 'string' }, value: { type: 'string' } },
      required: ['field', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_checkpoint',
    description:
      'Save browser draft fields and a screenshot to the private worker computer, without submitting. Use after filling the draft.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'capture_screenshot',
    description:
      'Capture a screenshot (optionally of one CSS selector) of the current permitted page, with SHA-256 provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        selector: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'start_recording',
    description: 'Start recording demonstrated clicks and fills on the synthetic portal into a reusable skill.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'stop_recording',
    description: 'Stop recording and save the demonstrated steps as a digest-sealed skill.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_skills',
    description: 'List saved skills with their step digests.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'replay_skill',
    description:
      'Replay a saved skill exactly as recorded. Requires a consumed human approval token bound to the skill digest. Never submits; loopback portal only.',
    inputSchema: {
      type: 'object',
      properties: { skill_id: { type: 'string' }, approval_token: { type: 'string' } },
      required: ['skill_id', 'approval_token'],
      additionalProperties: false,
    },
  },
  {
    name: 'capture_url',
    description:
      'Read-only capture of a server-selected map/address URL. The origin must be on the trusted env-configured exact-origin allowlist (cdn.kartaview.org, tiles.openfreemap.org, or the loopback app preview); requester-supplied origins are denied. GET/HEAD only; returns a SHA-256-hashed screenshot plus a provenance sidecar.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        name: { type: 'string' },
        wait_ms: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_final_submission',
    description:
      'Request final submission. This always stops with HUMAN_APPROVAL_REQUIRED and never clicks or submits.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

let currentCase = null;
let activeCapture = false;
let shotCounter = 0;

async function call(name, args = {}) {
  if (MODE === 'capture' && CAPTURE_MODE_DENY.has(name)) throw Error('CAPTURE_MODE_READ_ONLY');
  if (activeCapture && ['click_button','fill_draft_field'].includes(name)) throw Error('CAPTURE_CONTEXT_READ_ONLY');
  if (name === 'open_case') {
    activeCapture = false;
    if (!ASSIGNED_CASES.includes(args.case_id)) throw Error('WRONG_CASE_DENIED');
    await init();
    await page.goto(`${PORTAL_ORIGIN}/recovery`);
    await page.getByText(args.case_id, { exact: true }).first().waitFor();
    await page.getByText(args.case_id, { exact: true }).first().click();
    currentCase = args.case_id;
    process.env.PORTAL_RUNNER_CASE_REF = currentCase;
    const draftFile = path.join(HOME, 'draft-fields.json');
    if (fs.existsSync(draftFile)) {
      const saved = JSON.parse(fs.readFileSync(draftFile));
      for (const [k, v] of Object.entries(saved))
        if (ALLOWED_FIELDS.has(k)) await page.locator('#' + k).fill(v);
    }
    sessionCalls.length = 0;
    sessionCalls.push(
      { action: 'goto', path: '/recovery' },
      { action: 'click_text', text: args.case_id },
    );
    log({ event: 'opened-case', case_id: args.case_id });
    return `Opened assigned local synthetic case ${args.case_id}. Read visible page before drafting.`;
  }
  if (MODE === 'capture' && CAPTURE_MODE_DENY.has(name)) {
    throw Error('CAPTURE_MODE_READ_ONLY');
  }
  if (!page && name !== 'capture_url') throw Error('Open assigned case first');

  if (name === 'capture_url') {
    let u;
    try {
      u = new URL(String(args.url || ''));
    } catch {
      throw Error('CAPTURE_URL_DENIED');
    }
    if (!CAPTURE_ORIGINS.includes(u.origin)) throw Error('CAPTURE_ORIGIN_DENIED');
    activeCapture = true;
    await init();
    const response = await page.goto(u.toString(), {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page.waitForTimeout(
      Number.isFinite(args.wait_ms) ? Math.min(Math.max(args.wait_ms, 0), 10000) : 1000,
    );
    // Advisory watermark banner on HTML documents; raw images cannot be
    // overlaid in-browser, and that is recorded honestly in the sidecar.
    let watermarkRendered = false;
    try {
      watermarkRendered = await page.evaluate((text) => {
        if (!document || !document.body) return false;
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText =
          'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#59491d;color:#ffdf8a;font:14px system-ui;padding:8px 12px;';
        document.body.appendChild(d);
        return true;
      }, `${CAPTURE_WATERMARK} · ${u.toString()} · ${new Date().toISOString()}`);
    } catch {
      watermarkRendered = false;
    }
    const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$/.test(args.name || '')
      ? args.name
      : `capture-${String(++shotCounter).padStart(2, '0')}.png`;
    const artifact = await captureScreenshot(safeName);
    const sidecar = {
      filename: artifact.filename,
      sha256: artifact.sha256,
      source_url: u.toString(),
      final_url: page.url(),
      http_status: response ? response.status() : null,
      captured_at: artifact.captured_at,
      watermark: CAPTURE_WATERMARK,
      watermark_rendered: watermarkRendered,
      author: null,
      licence: null,
      distance_m_from_requested: null,
      metadata_note:
        'author/licence/distance are attached server-side by the integration module from the provider metadata lookup; never from page content.',
    };
    fs.writeFileSync(
      path.join(EVIDENCE, safeName.replace(/\.png$/, '') + '.json'),
      JSON.stringify(sidecar, null, 2),
    );
    log({ event: 'capture-url', url: u.toString(), sha256: artifact.sha256 });
    return { ...artifact, ...sidecar };
  }

  if (name === 'read_page') {
    const body = await page.locator('body').innerText();
    const marker = body.indexOf('8-Layer Asset');
    const text = marker >= 0 ? body.slice(marker, marker + 1800) : body.slice(0, 4000);
    return text;
  }

  if (name === 'click_button') {
    if (!SAFE_BUTTONS.has(args.name)) throw Error('FINAL_OR_UNLISTED_ACTION_DENIED');
    await page.getByRole('button', { name: args.name, exact: true }).click();
    sessionCalls.push({ action: 'click_button', name: args.name });
    log({ event: 'clicked', name: args.name });
    return 'Safe preview action opened. This is not a final export or submission.';
  }

  if (name === 'fill_draft_field') {
    if (
      !ALLOWED_FIELDS.has(args.field) ||
      typeof args.value !== 'string' ||
      args.value.length > 2500
    ) {
      throw Error('DRAFT_FIELD_DENIED');
    }
    await page.locator('#' + args.field).fill(args.value);
    const draftFile = path.join(HOME, 'draft-fields.json');
    const draft = fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile)) : {};
    draft[args.field] = args.value;
    fs.writeFileSync(draftFile, JSON.stringify(draft));
    sessionCalls.push({ action: 'fill', selector: '#' + args.field, value: args.value });
    log({ event: 'filled-draft', field: args.field, value: args.value });
    return 'Draft field filled, not submitted.';
  }

  if (name === 'capture_screenshot') {
    const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$/.test(args.name || '')
      ? args.name
      : `capture-${String(++shotCounter).padStart(2, '0')}.png`;
    if (args.selector) {
      const file = path.join(EVIDENCE, safeName);
      await page.locator(args.selector).first().screenshot({ path: file });
      const artifact = {
        filename: safeName,
        sha256: sha256File(file),
        byte_size: fs.statSync(file).size,
        captured_at: new Date().toISOString(),
      };
      log({ event: 'screenshot', selector: args.selector, ...artifact, url: page.url() });
      return artifact;
    }
    return captureScreenshot(safeName);
  }

  if (name === 'save_checkpoint') {
    const fields = {};
    for (const field of ALLOWED_FIELDS) {
      const locator = page.locator('#' + field);
      if (await locator.count()) fields[field] = await locator.inputValue();
    }
    const checkpoint = {
      job_id: `portal-run-${currentCase || 'unassigned'}`,
      case_id: currentCase,
      url: page.url(),
      status: 'WAITING_HUMAN_APPROVAL',
      fields,
      at: new Date().toISOString(),
    };
    checkpoint.digest = crypto
      .createHash('sha256')
      .update(JSON.stringify(fields))
      .digest('hex');
    const tmp = path.join(HOME, 'checkpoint.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
    fs.renameSync(tmp, path.join(HOME, 'checkpoint.json'));
    const note = page.locator('#decision-note');
    if (await note.count()) await note.scrollIntoViewIfNeeded();
    const artifact = await captureScreenshot('draft-checkpoint.png');
    log({ event: 'checkpoint', digest: checkpoint.digest });
    // Auto-save: every successful workflow becomes a reusable skill.
    let autoSkill = null;
    if (currentCase && sessionCalls.length > 0) {
      const stamp = checkpoint.digest.slice(0, 8);
      autoSkill = writeSkill(`auto-${currentCase.toLowerCase()}-${stamp}`, sessionCalls.slice(), 'auto');
    }
    return JSON.stringify({ ...checkpoint, screenshot: artifact, auto_skill: autoSkill ? { skill_id: autoSkill.skill_id, steps_digest: autoSkill.steps_digest } : null });
  }

  if (name === 'start_recording') {
    recordedEvents = [];
    recording = true;
    try {
      await page.evaluate(RECORDER_SNIPPET);
    } catch {}
    log({ event: 'recording-started' });
    return 'Recording started on the synthetic portal. Demonstrate the flow, then call stop_recording.';
  }

  if (name === 'stop_recording') {
    recording = false;
    const nameArg = String(args.name || '');
    const steps = normalizeRecordedSteps(recordedEvents);
    if (currentCase) {
      steps.unshift(
        { action: 'goto', path: '/recovery' },
        { action: 'click_text', text: currentCase },
      );
    }
    if (steps.length === 0) throw Error('NOTHING_RECORDED');
    const skill = writeSkill(nameArg, steps, 'recorded');
    return {
      skill_id: skill.skill_id,
      step_count: steps.length,
      steps_digest: skill.steps_digest,
      message: 'Skill saved. Replay requires human approval bound to this digest.',
    };
  }

  if (name === 'list_skills') {
    const skills = fs
      .readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const s = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, f)));
        return { skill_id: s.skill_id, created_by: s.created_by, steps: s.steps.length, steps_digest: s.steps_digest };
      });
    return skills;
  }

  if (name === 'replay_skill') {
    const skillId = String(args.skill_id || '');
    if (!SKILL_NAME_SAFE.test(skillId)) throw Error('SKILL_ID_DENIED');
    const file = path.join(SKILLS_DIR, skillId + '.json');
    if (!fs.existsSync(file)) throw Error('SKILL_NOT_FOUND');
    const skill = JSON.parse(fs.readFileSync(file));
    if (skillDigest(skill.steps) !== skill.steps_digest) {
      log({ event: 'skill-digest-mismatch', skill_id: skillId });
      throw Error('SKILL_DIGEST_MISMATCH');
    }
    // Human approval gate: consumed token bound to this exact skill digest.
    verifySkillApproval(skill, String(args.approval_token || ''));
    log({ event: 'skill-replay-approved', skill_id: skillId, digest: skill.steps_digest });
    await init();
    const shots = [];
    for (const [i, step] of skill.steps.entries()) {
      if (step.action === 'goto') {
        if (typeof step.path !== 'string' || !step.path.startsWith('/') || step.path.startsWith('//'))
          throw Error('SKILL_STEP_DENIED');
        await page.goto(PORTAL_ORIGIN + step.path, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(800);
      } else if (step.action === 'click_text') {
        if (SUBMIT_STEP_PATTERN.test(step.text || '')) throw Error('SKILL_STEP_DENIED');
        await page.getByText(step.text, { exact: true }).first().click();
      } else if (step.action === 'click_button') {
        if (SUBMIT_STEP_PATTERN.test(step.name || '')) throw Error('SKILL_STEP_DENIED');
        await page.getByRole('button', { name: step.name, exact: true }).click();
      } else if (step.action === 'fill') {
        if (typeof step.selector !== 'string' || typeof step.value !== 'string' || step.value.length > 2500)
          throw Error('SKILL_STEP_DENIED');
        await page.locator(step.selector).fill(step.value);
      } else if (step.action === 'screenshot') {
        shots.push(await captureScreenshot(step.name || `replay-${String(i + 1).padStart(2, '0')}.png`));
      } else {
        throw Error('SKILL_STEP_DENIED');
      }
      log({ event: 'replay-step', skill_id: skillId, index: i, action: step.action });
    }
    shots.push(await captureScreenshot(`replay-${skillId}-final.png`));
    log({ event: 'skill-replay-completed', skill_id: skillId, steps: skill.steps.length });
    return {
      status: 'REPLAY_COMPLETED',
      submitted: false,
      skill_id: skillId,
      steps_run: skill.steps.length,
      screenshots: shots,
      audit_head_hash: auditHeadHash(),
    };
  }

  if (name === 'request_final_submission') {
    log({ event: 'approval-stop' });
    return {
      status: 'HUMAN_APPROVAL_REQUIRED',
      submitted: false,
      audit_head_hash: auditHeadHash(),
      message:
        'Final submission was not performed. Exact case and draft preview must be approved by a human. No approval was supplied in this run.',
    };
  }

  throw Error('UNKNOWN_TOOL');
}

const input = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
input.on('line', (line) => {
  chain = chain.then(async () => {
    let q;
    try {
      q = JSON.parse(line);
      if (q.id === undefined) return;
      let result;
      if (q.method === 'initialize') {
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'nahashield-synthetic-portal-runner', version: '0.2' },
        };
      } else if (q.method === 'tools/list') {
        result = { tools: defs };
      } else if (q.method === 'tools/call') {
        try {
          log({ event: 'tool-call', tool: q.params.name, args: q.params.arguments, request_id: q.id });
          const out = await call(q.params.name, q.params.arguments);
          log({ event: 'tool-result', tool: q.params.name, request_id: q.id, result: out });
          result = {
            content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
          };
        } catch (e) {
          log({ event: 'tool-denied', name: q.params.name, error: e.message });
          result = { content: [{ type: 'text', text: e.message }], isError: true };
        }
      } else {
        result = {};
      }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n');
    } catch (e) {
      process.stderr.write(e.message + '\n');
    }
  });
});
input.on('close', async () => {
  await chain;
  if (context) await context.close();
  process.exit(0);
});
