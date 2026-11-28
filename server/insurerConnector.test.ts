import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_PROFILES,
  normaliseProfile,
  type InsurerProfile,
} from '../src/lib/engine/insurerProfiles';
import {
  ConnectorError,
  handleWebhookPayload,
  pullClaims,
  pullClaimsFile,
  testConnection,
  type FetchLike,
} from './insurerConnector';

// All fetch calls are injected fakes: no test touches a real insurer or the
// network. Records are fully synthetic.

const liberty = BUILT_IN_PROFILES.find((p) => p.id === 'liberty')!;
const momentum = BUILT_IN_PROFILES.find((p) => p.id === 'momentum')!;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(pages: unknown[]): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(String(url));
    return jsonResponse(pages[Math.min(urls.length - 1, pages.length - 1)]);
  };
  return { fetchImpl, urls };
}

function libertyRecord(n: number): Record<string, unknown> {
  return {
    claimNumber: `LIB-T-${String(n).padStart(3, '0')}`,
    policyNumber: `LPOL-T-${n}`,
    claimant: `Fictional claimant ${n}`,
    beneficiary: `Fictional beneficiary ${n}`,
    payoutAccount: `LACC-T-${n}`,
    paidAmount: 100000 + n,
    lossDate: `2026-0${(n % 6) + 6}-15`,
    policyStartDate: '2024-01-15',
    claimStatus: 'paid',
  };
}

test('pullClaims follows page_param paging until a short page, then maps and analyses', async () => {
  const page1 = { claims: Array.from({ length: 500 }, (_, i) => libertyRecord(i + 1)) };
  const page2 = { claims: [libertyRecord(501), libertyRecord(502)] };
  const { fetchImpl, urls } = fakeFetch([page1, page2]);
  const result = await pullClaims(liberty, 'https://mock.example/api', fetchImpl, { INSURER_LIBERTY_API_KEY: 'test-key' } as NodeJS.ProcessEnv);
  assert.equal(result.pages_read, 2);
  assert.equal(result.report.rows_used, 502);
  assert.ok(urls[0].includes('page=1') && urls[0].includes('pageSize=500'));
  assert.ok(urls[1].includes('page=2'));
  assert.equal(result.rows[0].claim_ref, 'LIB-T-001');
  assert.ok(result.report.months_covered! >= 6);
  assert.ok(result.analysis.summary.claims_analysed === 502);
});

test('pullClaims stops after one page when paging is none', async () => {
  const { fetchImpl, urls } = fakeFetch([[libertyRecord(1), libertyRecord(2)]]);
  const noPaging: InsurerProfile = { ...liberty, paging: { style: 'none' }, claims_list_key: '' };
  const result = await pullClaims(noPaging, 'https://mock.example/api/', fetchImpl, { INSURER_LIBERTY_API_KEY: 'k' } as NodeJS.ProcessEnv);
  assert.equal(result.pages_read, 1);
  assert.equal(urls.length, 1);
  assert.equal(result.report.rows_used, 2);
});

test('pullClaims with offset paging sends offset and limit params', async () => {
  const page = { data: [libertyRecord(1)] };
  const { fetchImpl, urls } = fakeFetch([page]);
  await pullClaims(momentum, 'https://mock.example/api', fetchImpl, { INSURER_MOMENTUM_TOKEN: 't' } as NodeJS.ProcessEnv);
  assert.ok(urls[0].includes('offset=0') && urls[0].includes('limit=500'));
});

test('missing auth env var gives a plain-language error, not a stack', async () => {
  const { fetchImpl } = fakeFetch([{}]);
  await assert.rejects(
    () => pullClaims(liberty, 'https://mock.example/api', fetchImpl, {} as NodeJS.ProcessEnv),
    (e: unknown) => e instanceof ConnectorError && /No API key is set/.test((e as ConnectorError).plain),
  );
});

test('mock feed URLs need no credentials, so profiles are provable before real keys exist', async () => {
  const { fetchImpl } = fakeFetch([{ claims: [libertyRecord(1), libertyRecord(2)] }]);
  const pull = await pullClaims({ ...liberty, paging: { style: 'none' } }, 'http://localhost:3100/api/mock-insurer/liberty', fetchImpl, {} as NodeJS.ProcessEnv);
  assert.equal(pull.report.rows_used, 2);
  const t = await testConnection(liberty, 'http://localhost:3100/api/mock-insurer/liberty', fetchImpl, {} as NodeJS.ProcessEnv);
  assert.equal(t.ok, true);
});

test('bad endpoint address gives a plain-language error', async () => {
  const { fetchImpl } = fakeFetch([{}]);
  await assert.rejects(
    () => pullClaims(liberty, 'not a url', fetchImpl, { INSURER_LIBERTY_API_KEY: 'k' } as NodeJS.ProcessEnv),
    (e: unknown) => e instanceof ConnectorError && /not a valid address/.test((e as ConnectorError).plain),
  );
});

test('HTTP errors surface as plain-language testConnection results', async () => {
  const fetch404: FetchLike = async () => jsonResponse({}, 404);
  const r = await testConnection(liberty, 'https://mock.example/api', fetch404, { INSURER_LIBERTY_API_KEY: 'k' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.ok(/404/.test(r.message) && /Nothing exists at that address/.test(r.message));
});

test('testConnection reports what the first page holds, without storing anything', async () => {
  const { fetchImpl } = fakeFetch([{ claims: [libertyRecord(1), libertyRecord(2), libertyRecord(3)] }]);
  const r = await testConnection(liberty, 'https://mock.example/api', fetchImpl, { INSURER_LIBERTY_API_KEY: 'k' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.ok(/3 claim rows/.test(r.message));
  assert.ok(/Nothing was stored/.test(r.message));
});

test('testConnection with an empty page asks for the list key to be checked', async () => {
  const { fetchImpl } = fakeFetch([{ claims: [] }]);
  const r = await testConnection(liberty, 'https://mock.example/api', fetchImpl, { INSURER_LIBERTY_API_KEY: 'k' } as NodeJS.ProcessEnv);
  assert.equal(r.ok, true);
  assert.ok(/no claims came back/i.test(r.message));
});

test('handleWebhookPayload maps a pushed batch end to end', () => {
  const result = handleWebhookPayload(momentum, {
    data: [
      { ClaimReference: 'MOM-T-1', AmountPaid: '150000.00', DateOfLoss: '25/08/2026', Status: 'Paid' },
      { ClaimReference: 'MOM-T-2', AmountPaid: '175000.00', DateOfLoss: '2026-09-29', Status: 'Paid' },
    ],
  });
  assert.equal(result.report.rows_used, 2);
  assert.equal(result.rows[0].claim_ref, 'MOM-T-1');
  assert.equal(result.rows[0].claim_date, '2026-08-25');
  assert.equal(result.rows[1].claim_date, '2026-09-29');
});

test('pullClaimsFile ingests a CSV dropped over HTTPS', async () => {
  const csv = ['Claim No,Amount Paid (R),Date of Loss', 'GEN-T-1,R 200 000,2026-10-05', 'GEN-T-2,R 95 000,05/11/2026'].join('\n');
  const fetchImpl: FetchLike = async () => new Response(csv, { status: 200 });
  const profile = normaliseProfile({ id: 'drop', label: 'Drop', insurer: 'Drop', protocol: 'file_url', auth: { type: 'none' } } as InsurerProfile);
  const result = await pullClaimsFile(profile, 'https://files.example/export/claims.csv', fetchImpl, {} as NodeJS.ProcessEnv);
  assert.equal(result.report.rows_used, 2);
  assert.equal(result.rows[0].claim_ref, 'GEN-T-1');
  assert.equal(result.rows[1].claim_date, '2026-11-05');
});

test('auth headers: api_key_header, bearer and basic are sent correctly', async () => {
  const seen: Record<string, string>[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    seen.push(init?.headers as Record<string, string>);
    return jsonResponse({ claims: [libertyRecord(1)] });
  };
  await pullClaims({ ...liberty, paging: { style: 'none' } }, 'https://m.example', fetchImpl, { INSURER_LIBERTY_API_KEY: 'secret-key' } as NodeJS.ProcessEnv);
  assert.equal(seen[0]['x-api-key'], 'secret-key');
  await pullClaims({ ...momentum, paging: { style: 'none' } }, 'https://m.example', fetchImpl, { INSURER_MOMENTUM_TOKEN: 'tok' } as NodeJS.ProcessEnv);
  assert.equal(seen[1]['authorization'], 'Bearer tok');
  const basic = normaliseProfile({ id: 'b', label: 'B', insurer: 'B', protocol: 'rest_json', auth: { type: 'basic', username_env: 'BU', password_env: 'BP' } } as InsurerProfile);
  await pullClaims(basic, 'https://m.example', fetchImpl, { BU: 'u', BP: 'p' } as NodeJS.ProcessEnv);
  assert.equal(seen[2]['authorization'], `Basic ${Buffer.from('u:p').toString('base64')}`);
});
