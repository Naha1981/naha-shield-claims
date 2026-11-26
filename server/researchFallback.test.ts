import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOfficialSources, fetchOfficialResearch } from './researchFallback';

test('query selects only fixed official URLs, never arbitrary requested URLs', () => {
  assert.equal(selectOfficialSources('fetch http://127.0.0.1/secrets').length, 0);
  const rows = selectOfficialSources('POPIA section 71');
  assert.equal(rows.length, 1);
  assert.equal(new URL(rows[0].uri).hostname, 'justice.gov.za');
});
test('unsupported topics fail closed', async () => {
  await assert.rejects(fetchOfficialResearch('unrelated topic'), /No matching official source/);
});
test('accepts actual PDF response and includes fetched time and exact source', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('%PDF-test', { status: 200 });
  try {
    const result = await fetchOfficialResearch('POPIA');
    assert.equal(result.sources.length, 1);
    assert.ok(result.sources[0].fetched_at);
    assert.equal(Buffer.from(result.parts[0].inlineData.data, 'base64').toString(), '%PDF-test');
  } finally { globalThis.fetch = original; }
});
test('HTML errors never become official evidence', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>blocked</html>', { status: 200 });
  try { await assert.rejects(fetchOfficialResearch('POPIA'), /could not be fetched/); }
  finally { globalThis.fetch = original; }
});
