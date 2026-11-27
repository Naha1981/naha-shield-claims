// HTTP loopback wrapper around computer-mcp.mjs, per the shared capture
// executor contract (accepted amendment). One Chromium, serialized jobs.
// Artifacts are retrievable by job_id + filename only; traversal is rejected.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = process.env.WORKER_ROOT || process.cwd();
const EVIDENCE = process.env.EVIDENCE_DIR || path.join(ROOT, 'evidence');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.EXECUTOR_PORT || 4330);
const BIND = process.env.BIND_HOST || '127.0.0.1';
fs.mkdirSync(EVIDENCE, { recursive: true });
fs.mkdirSync(path.join(DATA, 'jobs'), { recursive: true });

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,109}$/;
function safeArtifactName(filename) {
  if (!SAFE_NAME.test(filename) || filename.includes('..') || !/\.(png|json|jsonl)$/.test(filename)) {
    throw new Error('ARTIFACT_NAME_DENIED');
  }
  return filename;
}

// Single persistent worker -> one Chromium. Jobs serialize on `queue`.
const child = spawn(process.execPath, [new URL('./computer-mcp.mjs', import.meta.url).pathname], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
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
    waiting.get(j.id)?.(j);
    waiting.delete(j.id);
  }
});
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, resolve);
    setTimeout(() => waiting.get(id) && (waiting.delete(id), reject(new Error('WORKER_TIMEOUT'))), 120000);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const toolCall = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? '';
  return { isError: Boolean(r.result?.isError), text };
};

let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 65536) reject(new Error('BODY_TOO_LARGE'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(200, { ok: true, mode: 'shared-capture-executor', chromium: 'single-instance' });
    }
    if (req.method === 'POST' && req.url === '/jobs') {
      const body = JSON.parse(await readBody(req));
      const actions = Array.isArray(body.actions) ? body.actions : [];
      const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const record = await enqueue(async () => {
        const steps = [];
        for (const a of actions) {
          const out = await toolCall(a.tool, a.arguments || {});
          steps.push({ tool: a.tool, ...out });
          if (out.isError && body.stop_on_error !== false) break;
        }
        const result = steps;
      // Copy each referenced artifact into its owning job, never expose global filenames.
      const artifactDir = path.join(DATA, 'jobs', jobId);
      fs.mkdirSync(artifactDir, { recursive: true });
      const artifacts = [];
      for (const step of result) {
        let parsed; try { parsed = JSON.parse(step.text); } catch { continue; }
        for (const shot of [parsed, parsed.screenshot].filter(Boolean)) {
          if (!shot.filename || !shot.sha256) continue;
          const name = safeArtifactName(shot.filename);
          const bytes = fs.readFileSync(path.join(EVIDENCE, name));
          if (crypto.createHash('sha256').update(bytes).digest('hex') !== shot.sha256) throw Error('ARTIFACT_HASH_MISMATCH');
          fs.writeFileSync(path.join(artifactDir, name), bytes);
          artifacts.push({filename:name,sha256:shot.sha256});
        }
      }
      const record = { job_id: jobId, at: new Date().toISOString(), steps: result, artifacts };
      fs.writeFileSync(path.join(DATA, 'jobs', `${jobId}.json`), JSON.stringify(record, null, 2));
      return record;
      });
      return json(200, record);
    }
    const artifactMatch = req.url.match(/^\/jobs\/([A-Za-z0-9-]+)\/artifacts\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'GET' && artifactMatch) {
      const filename = safeArtifactName(artifactMatch[2]);
      const recordFile = path.join(DATA, 'jobs', artifactMatch[1] + '.json');
      if (!fs.existsSync(recordFile)) return json(404, { error: 'JOB_NOT_FOUND' });
      const record = JSON.parse(fs.readFileSync(recordFile));
      if (!record.artifacts?.some(a => a.filename === filename)) return json(404, { error: 'ARTIFACT_NOT_IN_JOB' });
      const file = path.join(DATA, 'jobs', artifactMatch[1], filename);
      if (!fs.existsSync(file)) return json(404, { error: 'NOT_FOUND' });
      const bytes = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': filename.endsWith('.png') ? 'image/png' : 'application/json',
        'x-artifact-sha256': crypto.createHash('sha256').update(bytes).digest('hex'),
      });
      return res.end(bytes);
    }
    return json(404, { error: 'NOT_FOUND' });
  } catch (e) {
    return json(400, { error: e.message });
  }
});
server.listen(PORT, BIND);
