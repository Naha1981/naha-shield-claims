import test from 'node:test';
import assert from 'node:assert/strict';
import { RBAC_MATRIX, can, accessOf, canAccessObject, DEMO_ROLE_MAP, ROLE_LABELS, type Capability, type SpecRole } from './rbacMatrix';

// Key cells of the spec's permission matrix.

test('every capability has at least one role allowed and every role label exists', () => {
  for (const [cap, row] of Object.entries(RBAC_MATRIX)) {
    assert.ok(Object.values(row).some((v) => v === 'yes'), `${cap} should be allowed for someone`);
    for (const role of Object.keys(row)) assert.ok(role in ROLE_LABELS, `${role} in ${cap} needs a label`);
  }
});

test('recovery case creation: manager, investigator, recoveries; not finance or compliance', () => {
  assert.equal(can('claims_manager', 'create_recovery_case'), true);
  assert.equal(can('investigator', 'create_recovery_case'), true);
  assert.equal(can('head_of_recoveries', 'create_recovery_case'), true);
  assert.equal(can('finance', 'create_recovery_case'), false);
  assert.equal(can('compliance', 'create_recovery_case'), false);
  assert.equal(can('executive', 'create_recovery_case'), false);
});

test('executives get summaries, never raw evidence or indicators', () => {
  assert.equal(accessOf('executive', 'view_evidence'), 'summary');
  assert.equal(accessOf('executive', 'view_claim_indicators'), 'summary');
  assert.equal(can('executive', 'view_evidence'), false);
});

test('adverse actions need explicit approval rights', () => {
  assert.equal(can('claims_manager', 'approve_hold'), true);
  assert.equal(can('assessor', 'approve_hold'), false);
  assert.equal(can('claims_manager', 'decline_claim'), true);
  assert.equal(can('legal', 'decline_claim'), true);
  assert.equal(can('investigator', 'decline_claim'), false);
});

test('recovery money movements: recoveries and finance only', () => {
  assert.equal(can('head_of_recoveries', 'record_recovery_payment'), true);
  assert.equal(can('finance', 'record_recovery_payment'), true);
  assert.equal(can('assessor', 'record_recovery_payment'), false);
  assert.equal(can('head_of_recoveries', 'write_off_recovery'), true);
  assert.equal(can('legal', 'write_off_recovery'), true);
  assert.equal(can('finance', 'write_off_recovery'), false);
});

test('kill switch belongs to compliance and insurer admin only', () => {
  assert.equal(can('compliance', 'kill_switch'), true);
  assert.equal(can('insurer_admin', 'kill_switch'), true);
  assert.equal(can('claims_manager', 'kill_switch'), false);
  assert.equal(can('head_of_recoveries', 'kill_switch'), false);
});

test('tenant isolation: no cross-tenant access for any role', () => {
  const obj = { tenant_id: 'ten_insurer_a' };
  const outsider = { tenant_id: 'ten_insurer_b' };
  for (const role of Object.keys(ROLE_LABELS) as SpecRole[]) {
    for (const cap of Object.keys(RBAC_MATRIX) as Capability[]) {
      assert.equal(canAccessObject(role, cap, obj, outsider), false, `${role} must not ${cap} cross-tenant`);
    }
  }
  assert.equal(canAccessObject('claims_manager', 'view_recovery_case', obj, { tenant_id: 'ten_insurer_a' }), true);
});

test('sample roles map onto spec roles so Lawrence test flow keeps working', () => {
  assert.equal(DEMO_ROLE_MAP.head_of_forensics, 'investigator');
  assert.equal(DEMO_ROLE_MAP.legal_recoveries, 'head_of_recoveries');
  assert.equal(DEMO_ROLE_MAP.finance_cfo, 'finance');
  assert.equal(DEMO_ROLE_MAP.compliance_dpo, 'compliance');
  assert.equal(DEMO_ROLE_MAP.underwriter, 'policyholder');
});
