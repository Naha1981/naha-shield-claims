import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillRecord,
  computeSkillDigest,
  isSkillReplayTokenExecutable,
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

test('steps outside the registered allowlists are never replayable', () => {
  for (const steps of [
    // The real submit control: not a registered safe preview button.
    [{ action: 'click_button', name: 'Record Signed Human Decision' } as SkillStep],
    // Arbitrary page text: not an assigned synthetic case ref.
    [{ action: 'click_text', text: 'Submit final claim' } as SkillStep],
    // A synthetic-looking but unassigned case.
    [{ action: 'click_text', text: 'SYN-RC-999' } as SkillStep],
    // A fill outside the registered draft fields.
    [{ action: 'fill', selector: '#reviewer', value: 'Forged signer' } as SkillStep],
  ]) {
    const result = validateSkillSteps(steps);
    assert.equal(result.ok, false);
    assert.ok(result.violations[0].includes('denied'));
  }
});

test('goto steps are locked to the synthetic recovery page', () => {
  for (const path of [
    '//evil.example.org/x',
    'https://evil.example.org',
    'recovery',
    '/admin',
    '/recovery/other',
  ]) {
    const result = validateSkillSteps([{ action: 'goto', path }]);
    assert.equal(result.ok, false);
  }
  assert.equal(validateSkillSteps([{ action: 'goto', path: '/recovery' }]).ok, true);
});

test('a SKILL_REPLAY token must be consumed, typed, digest-bound and unexpired', () => {
  const skill = buildSkillRecord({
    name: 'fnol-demo',
    steps: FNOL_STEPS,
    created_by: 'recorded',
    portal_origin: 'http://127.0.0.1:4311',
    case_ref: 'SYN-RC-004',
  });
  const valid = {
    type: 'SKILL_REPLAY',
    claim_ref: 'SYN-RC-004',
    digest: skill.steps_digest,
    expires: Date.now() + 60000,
    used: true,
  };
  assert.equal(isSkillReplayTokenExecutable(valid, skill), true);
  assert.equal(isSkillReplayTokenExecutable(undefined, skill), false);
  assert.equal(isSkillReplayTokenExecutable({ ...valid, used: false }, skill), false);
  assert.equal(
    isSkillReplayTokenExecutable({ ...valid, type: 'INTERNAL_SYNTHETIC_REPORT_REVIEW' }, skill),
    false,
  );
  assert.equal(
    isSkillReplayTokenExecutable({ ...valid, digest: '0'.repeat(64) }, skill),
    false,
  );
  assert.equal(
    isSkillReplayTokenExecutable({ ...valid, expires: Date.now() - 1 }, skill),
    false,
  );
  assert.equal(
    isSkillReplayTokenExecutable({ ...valid, claim_ref: 'SYN-RC-005' }, skill),
    false,
  );
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
  assert.throws(() =>
    buildSkillRecord({
      name: 'bad-nav',
      steps: [{ action: 'goto', path: '/admin' }],
      created_by: 'recorded',
      portal_origin: 'http://127.0.0.1:4311',
      case_ref: 'SYN-RC-004',
    }),
  );
});
