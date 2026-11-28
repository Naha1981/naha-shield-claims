// Worked-cases spec (Thabiso's spec 7 section 4), adapted to run for real:
// his version used vitest + testing-library with Next.js imports that do not
// exist in this repo. This repo's runner is `tsx --test` (node:test), so the
// same assertions run against the shared data module and the live API router
// (express, ephemeral port). No insurer or person names are hardcoded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { WORKED_CASES, listPayload, detailPayload, INSURER_PLACEHOLDER } from '../../src/lib/demo/workedCases';
import { workedCasesRoutes } from '../../server/workedExample';

const BANNED = [/fraudster/i, /criminal/i, /guilty/i, /pride life/i, /nomsa/i, /sibusiso/i, /zanele/i, /dlamini/i, /mkhize/i, /thabo m/i, /naledi k/i, /lawrence/i];
const blob = (o: unknown) => JSON.stringify(o);

test('landing payload renders both worked cases', () => {
  const p = listPayload();
  assert.equal(p.meta.total, 2);
  const titles = p.data.map((c) => c.title);
  assert.ok(titles.includes('Valid funeral claim approved quickly'));
  assert.ok(titles.includes('Fraud pattern detected before payment'));
});

test('fraud case shows R75,000 protected; clean case shows R0', () => {
  const [c1, c2] = listPayload().data;
  assert.equal(c1.revenue_protected, 0);
  assert.equal(c2.revenue_protected, 7_500_000); // R75,000 in cents
  assert.equal(c2.amount_claimed, 7_500_000);
  assert.equal(c1.amount_claimed, 2_500_000); // R25,000 in cents
});

test('case 1 timeline has the five steps', () => {
  const c1 = WORKED_CASES.find((c) => c.case_id === 'worked_case_001')!;
  const titles = c1.timeline.map((s) => s.title);
  for (const t of ['Claim received', 'Automated checks run', 'No fraud indicators', 'Human approval', 'Claim paid']) {
    assert.ok(titles.includes(t), `missing timeline step ${t}`);
  }
});

test('case 2 indicators cover the spec pattern', () => {
  const c2 = WORKED_CASES.find((c) => c.case_id === 'worked_case_002')!;
  const titles = c2.indicators.map((i) => i.title).join(' | ');
  assert.match(titles, /two days of death/);
  assert.match(titles, /21 days before claim/);
  assert.match(titles, /ten days before death/);
  assert.match(titles, /SIM swap/);
  assert.match(titles, /Bank account linked to multiple claims/);
  assert.match(titles, /not immediate family/);
  assert.match(titles, /Consent evidence incomplete/);
  for (const i of c2.indicators) assert.ok(i.innocent_explanation.length > 0, `indicator ${i.indicator_id} needs its innocent explanation`);
});

test('no accusation wording, no real insurer or person names anywhere', () => {
  for (const pattern of BANNED) {
    assert.equal(pattern.test(blob(WORKED_CASES)), false, `banned pattern ${pattern} present`);
    assert.equal(pattern.test(blob(listPayload())), false, `banned pattern ${pattern} in list payload`);
  }
  for (const c of WORKED_CASES) assert.equal(c.insurer, INSURER_PLACEHOLDER);
});

test('money terms stay strictly separate', () => {
  const c2 = WORKED_CASES.find((c) => c.case_id === 'worked_case_002')!;
  assert.equal(c2.value.revenue_protected, 7_500_000);
  assert.equal(c2.value.revenue_saved, 7_500_000);
  assert.equal(c2.value.revenue_recovered, 0);
  const c1 = WORKED_CASES.find((c) => c.case_id === 'worked_case_001')!;
  assert.equal(c1.value.revenue_protected + c1.value.revenue_saved + c1.value.revenue_recovered, 0);
});

test('human decision is present on both cases with appeal-safe wording', () => {
  for (const c of WORKED_CASES) {
    assert.ok(c.case_decision.approver.includes('role'), 'approver is a neutral role');
    assert.ok(!BANNED.some((p) => p.test(c.case_decision.reason)));
  }
});

test('API serves list and both case details with cents amounts', async () => {
  const app = express();
  app.use('/api/v1', workedCasesRoutes());
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/api/v1/worked-cases`)).json();
    assert.equal(list.data.length, 2);
    for (const id of ['worked_case_001', 'worked_case_002']) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/worked-cases/${id}`);
      assert.equal(res.status, 200);
      const p = await res.json();
      assert.equal(p.meta.data_type, 'fictional_sample');
      assert.equal(p.data.insurer, INSURER_PLACEHOLDER);
      assert.equal(typeof p.data.amount_claimed, 'number');
      assert.ok(p.data.amount_claimed > 1000, 'amounts are in cents, not rands');
    }
    const missing = await fetch(`http://127.0.0.1:${port}/api/v1/worked-cases/nope`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
