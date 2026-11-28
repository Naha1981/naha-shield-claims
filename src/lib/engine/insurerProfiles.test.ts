import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_PROFILES,
  validateProfile,
  normaliseProfile,
  getProfile,
  extractClaimRecords,
  mapInsurerRecords,
  connectorIngestReport,
  type InsurerProfile,
} from './insurerProfiles';

const liberty = BUILT_IN_PROFILES.find((p) => p.id === 'liberty')!;
const momentum = BUILT_IN_PROFILES.find((p) => p.id === 'momentum')!;
const generic = BUILT_IN_PROFILES.find((p) => p.id === 'generic')!;

test('built-in profiles are valid and distinct', () => {
  for (const p of BUILT_IN_PROFILES) assert.deepEqual(validateProfile(p), [], `${p.id} should validate`);
  const ids = BUILT_IN_PROFILES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('validateProfile rejects bad configuration in plain language', () => {
  assert.ok(validateProfile({}).length > 0);
  assert.ok(validateProfile({ id: 'Bad ID', label: 'x', protocol: 'rest_json', auth: { type: 'none' }, claims_path: '/c' }).some((m) => m.includes('slug')));
  assert.ok(validateProfile({ id: 'ok-id', label: 'x', protocol: 'ftp', auth: { type: 'none' }, claims_path: '/c' }).some((m) => m.includes('protocol')));
  assert.ok(validateProfile({ id: 'ok-id', label: 'x', protocol: 'rest_json', auth: { type: 'api_key_header' }, claims_path: '/c' }).some((m) => m.includes('header name')));
  const badMap = { id: 'ok-id', label: 'x', protocol: 'rest_json', auth: { type: 'none' }, claims_path: '/c', field_map: { theirField: 'not_a_column' } };
  assert.ok(validateProfile(badMap).some((m) => m.includes('not_a_column')));
});

test('normaliseProfile fills defaults for a minimal custom profile', () => {
  const p = normaliseProfile({ id: 'acme-life', label: 'Acme Life', insurer: 'Acme', protocol: 'rest_json', auth: { type: 'none' } } as InsurerProfile);
  assert.equal(p.claims_path, '/claims');
  assert.equal(p.schedule.enabled, false);
  assert.equal(p.status, 'config-only');
  assert.ok(p.webhook_secret_env.includes('ACME_LIFE'));
});

test('getProfile finds built-ins and runtime additions', () => {
  assert.equal(getProfile('liberty')?.id, 'liberty');
  assert.equal(getProfile('nope'), null);
  const extra = normaliseProfile({ id: 'acme-life', label: 'Acme', insurer: 'Acme', protocol: 'webhook', auth: { type: 'none' } } as InsurerProfile);
  assert.equal(getProfile('acme-life', [extra])?.protocol, 'webhook');
});

test('extractClaimRecords honours the list key, bare arrays and single claims', () => {
  assert.equal(extractClaimRecords(liberty, { claims: [{ a: 1 }, { a: 2 }], total: 2 }).length, 2);
  assert.equal(extractClaimRecords(momentum, { data: [{ a: 1 }] }).length, 1);
  assert.equal(extractClaimRecords(generic, [{ a: 1 }, { a: 2 }]).length, 2);
  assert.equal(extractClaimRecords(generic, { claimNumber: 'X1' }).length, 1);
  assert.equal(extractClaimRecords(liberty, { claims: 'not-a-list' }).length, 0);
});

test('mapInsurerRecords: profile field_map wins, unknown names fall back to the recogniser', () => {
  const records = [
    { claimNumber: 'LIB-1', paidAmount: 250000, lossDate: '2026-10-05', unexpectedExtra: 'zzz' },
    { claimNumber: 'LIB-2', paidAmount: 90000, lossDate: '2026-08-01' },
  ];
  const { rows, columns_mapped, columns_ignored } = mapInsurerRecords(liberty, records);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].claim_ref, 'LIB-1');
  assert.equal(rows[0].amount_zar, '250000');
  assert.equal(rows[0].claim_date, '2026-10-05');
  assert.ok(columns_mapped.some((c) => c.from === 'claimNumber' && c.to === 'claim_ref'));
  assert.ok(columns_ignored.includes('unexpectedExtra'));
});

test('mapInsurerRecords with an empty field_map still reads generic columns', () => {
  const records = [{ 'Claim No': 'GEN-1', 'Amount Paid (R)': 'R 300 000', 'Date of Loss': '2026-10-05' }];
  const { rows } = mapInsurerRecords(generic, records);
  assert.equal(rows[0].claim_ref, 'GEN-1');
  assert.equal(rows[0].amount_zar, 'R 300 000');
});

test('connectorIngestReport removes exact duplicates, fills missing refs, counts months', () => {
  const records = [
    { claimNumber: 'A1', paidAmount: 100, lossDate: '2026-06-10' },
    { claimNumber: 'A1', paidAmount: 100, lossDate: '2026-06-10' }, // exact duplicate row
    { claimNumber: '', paidAmount: 50, lossDate: '2026-11-02' },
  ];
  const mapped = mapInsurerRecords(liberty, records);
  const { rows, report } = connectorIngestReport(liberty, mapped.rows, mapped, 'Liberty API');
  assert.equal(report.rows_read, 3);
  assert.equal(report.rows_used, 2);
  assert.equal(report.duplicate_rows_removed, 1);
  assert.equal(report.rows_missing_ref, 1);
  assert.ok(rows[1].claim_ref.startsWith('row-'));
  assert.equal(report.months_covered, 6);
  assert.ok(report.warnings.length >= 2);
});
