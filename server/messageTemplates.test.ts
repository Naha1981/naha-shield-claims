import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_TEMPLATES, renderDraft, wordingProblems, type TemplateVars } from './messageTemplates';

const vars: TemplateVars = {
  insurer_name: 'Pride Life',
  claim_reference: 'CLM-2026-00421',
  document_type: 'a certified ID for the deceased',
  due_date: '2 December 2026',
  phone_number: '011 000 0000',
};

test('all ten templates render with the insurer name as a variable', () => {
  assert.equal(MESSAGE_TEMPLATES.length, 10);
  for (const t of MESSAGE_TEMPLATES) {
    const draft = renderDraft(t.id, vars);
    assert.equal(draft.status, 'draft_requires_human_approval');
    assert.ok(draft.body.startsWith('Pride Life:'), `${t.id} starts with the insurer name variable`);
    assert.ok(draft.body.length < 320, `${t.id} stays SMS-length`);
    assert.deepEqual(wordingProblems(draft.body), [], `${t.id} has no accusation or fraud wording`);
  }
});

test('a different insurer name renders a different message: never hardcoded', () => {
  const a = renderDraft('claim_received_v1', { ...vars, insurer_name: 'Liberty' });
  const b = renderDraft('claim_received_v1', { ...vars, insurer_name: 'Momentum' });
  assert.ok(a.body.startsWith('Liberty:'));
  assert.ok(b.body.startsWith('Momentum:'));
  assert.notEqual(a.body, b.body);
});

test('insurer name is required', () => {
  assert.throws(() => renderDraft('claim_received_v1', { ...vars, insurer_name: '' }), /insurer_name is required/);
});

test('deadline, document, phone and reference variables land in the body', () => {
  const d = renderDraft('claim_documents_required_v1', vars);
  assert.ok(d.body.includes('CLM-2026-00421'));
  assert.ok(d.body.includes('certified ID'));
  assert.ok(d.body.includes('2 December 2026'));
  const c = renderDraft('claim_callback_required_v1', vars);
  assert.ok(c.body.includes('011 000 0000'));
});

test('adverse templates point at review options without accusation', () => {
  for (const id of ['claim_declined_v1', 'claim_reduced_v1', 'appeal_outcome_v1'] as const) {
    const d = renderDraft(id, vars);
    assert.ok(d.body.includes('review') || d.body.includes('outcome'), `${id} mentions the review route`);
    assert.ok(!d.body.includes('not approved because'));
  }
});
