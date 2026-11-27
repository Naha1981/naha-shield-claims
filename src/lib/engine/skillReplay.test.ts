import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillRecord,
  computeSkillDigest,
  SUBMIT_STEP_PATTERN,
  validateSkillSteps,
  verifySkillDigest,
  type SkillStep,
} from './skillReplay';

const FNOL_STEPS: SkillStep[] = [
  { action: 'goto', path: '/recovery' },
  { action: 'click_text', text: 'SYN-RC-004' },
  { action: 'fill', selector: '#decision-note', value: 'FNOL captured per demo.' },
  { action: 'click_button', name: 'Generate Attorney / AFU Handover Pack' },
  { action: 'screenshot', name: 'fnol-01.png' },
];

test('a recorded FNOL skill validates and seals with a stable digest', () => {
  const validation = validateSkillSteps(FNOL_STEPS);
  assert.deepEqual(validation.violations, []);
  const digestA = computeSkillDigest(FNOL_STEPS);
  const digestB = computeSkillDigest(FNOL_STEPS.map((s) => ({ ...s })));
  assert.equal(digestA, digestB);
  assert.match(digestA, /^[0-9a-f]{64}$/);

  const skill = buildSkillRecord({
    name: 'fnol-demo',
    steps: FNOL_STEPS,
    created_by: 'recorded',
    portal_origin: 'http://127.0.0.1:4311',
    case_ref: 'SYN-RC-004',
    created_at: '2026-11-27T10:00:00.000Z',
  });
  assert.equal(skill.synthetic_only, true);
  assert.equal(verifySkillDigest(skill), true);
});

test('tampering with any step breaks the digest', () => {
  const skill = buildSkillRecord({
    name: 'fnol-demo',
    steps: FNOL_STEPS,
    created_by: 'auto',
    portal_origin: 'http://127.0.0.1:4311',
    case_ref: 'SYN-RC-004',
  });
  const tampered = {
    ...skill,
    steps: skill.steps.map((s, i) =>
      i === 2 ? { ...s, value: 'altered after approval' } : s,
    ),
  };
  assert.equal(verifySkillDigest(tampered), false);
});

test('submit-like controls are never replayable steps', () => {
  assert.ok(SUBMIT_STEP_PATTERN.test('Record Signed Human Decision'));
  for (const steps of [
    [{ action: 'click_button', name: 'Record Signed Human Decision' } as SkillStep],
    [{ action: 'click_text', text: 'Submit final claim' } as SkillStep],
  ]) {
    const result = validateSkillSteps(steps);
    assert.equal(result.ok, false);
    assert.ok(result.violations[0].includes('denied'));
  }
});

test('goto steps are locked to portal-relative paths', () => {
  for (const path of ['//evil.example.org/x', 'https://evil.example.org', 'recovery']) {
    const result = validateSkillSteps([{ action: 'goto', path }]);
    assert.equal(result.ok, false);
  }
  assert.equal(validateSkillSteps([{ action: 'goto', path: '/recovery' }]).ok, true);
});

test('unknown actions are rejected: skills are data, not scripts', () => {
  const result = validateSkillSteps([
    { action: 'eval', value: 'alert(1)' } as unknown as SkillStep,
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.violations[0].includes('not scripts'));
});

test('buildSkillRecord refuses invalid names and invalid steps', () => {
  assert.throws(() =>
    buildSkillRecord({
      name: '../escape',
      steps: FNOL_STEPS,
      created_by: 'recorded',
      portal_origin: 'http://127.0.0.1:4311',
      case_ref: 'SYN-RC-004',
    }),
  );
  assert.throws(() =>
    buildSkillRecord({
      name: 'bad-skill',
      steps: [{ action: 'click_button', name: 'Submit Claim' }],
      created_by: 'recorded',
      portal_origin: 'http://127.0.0.1:4311',
      case_ref: 'SYN-RC-004',
    }),
  );
});
