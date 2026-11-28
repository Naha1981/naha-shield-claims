import {
  extractClaimRecords,
  mapInsurerRecords,
  connectorIngestReport,
  type InsurerProfile,
} from '../src/lib/engine/insurerProfiles';
import { ingestClaimRows, parseClaimDate, type IngestReport } from '../src/lib/engine/claimsFileIngest';
import { analyseRows, parseCsv, type ClaimRow } from '../src/lib/engine/leakageEngine';
import { rowsFromXlsx } from './claimsFileParse';

// Generic insurer connector: pulls claim records from any configured REST JSON
// endpoint or HTTPS file drop, normalises dates, and hands canonical rows to
// the existing leakage-to-recovery analysis. Fetch is injectable so tests and
// mock feeds never touch a real insurer.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class ConnectorError extends Error {
  plain: string;
  constructor(plain: string, detail?: string) {
    super(detail ?? plain);
    this.plain = plain;
  }
}

function safeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError('The endpoint is not a valid address.', `bad base url: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConnectorError('Only http and https endpoints are supported.', `protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new ConnectorError('Do not put credentials in the address; use the auth settings.', 'credentials in url');
  }
  return url.toString().replace(/\/$/, '');
}

// Mock feeds carry sample claims and take no credentials: skip auth for
// them so every profile can be proven before a real key exists.
function isMockFeed(url: string): boolean {
  return /\/mock-insurer\//.test(url);
}

function authHeaders(profile: InsurerProfile, env: NodeJS.ProcessEnv, baseUrl?: string): Record<string, string> {
  if (baseUrl && isMockFeed(baseUrl)) return {};
  const a = profile.auth;
  if (a.type === 'none') return {};
  if (a.type === 'api_key_header') {
    const key = env[a.env_var];
    if (!key) throw new ConnectorError(`No API key is set (${a.env_var}). Add it to the server environment, or test with the mock feed.`, `missing env ${a.env_var}`);
    return { [a.header]: key };
  }
  if (a.type === 'bearer') {
    const token = env[a.env_var];
    if (!token) throw new ConnectorError(`No bearer token is set (${a.env_var}). Add it to the server environment, or test with the mock feed.`, `missing env ${a.env_var}`);
    return { authorization: `Bearer ${token}` };
  }
  const user = env[a.username_env];
  const pass = env[a.password_env];
  if (!user || !pass) throw new ConnectorError(`Basic auth needs ${a.username_env} and ${a.password_env} in the server environment.`, 'missing basic env');
  return { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

async function fetchJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, redirect: 'error' });
  } catch (e) {
    throw new ConnectorError('Could not reach the endpoint. Check the address and that the network allows it.', (e as Error).message);
  }
  if (!res.ok) {
    throw new ConnectorError(`The endpoint answered ${res.status}. ${res.status === 401 || res.status === 403 ? 'The credentials were rejected.' : res.status === 404 ? 'Nothing exists at that address.' : 'Check the insurer documentation.'}`, `HTTP ${res.status} for ${url}`);
  }
  try {
    return await res.json();
  } catch {
    throw new ConnectorError('The endpoint did not return JSON. For CSV or Excel drops use a file_url profile.', `non-JSON from ${url}`);
  }
}

function pageUrls(profile: InsurerProfile, baseUrl: string): string[] {
  const base = baseUrl + (profile.claims_path || '');
  if (profile.paging.style === 'none') return [base];
  const urls: string[] = [];
  const max = Math.min(profile.paging.max_pages, 50);
  if (profile.paging.style === 'page_param') {
    for (let p = 1; p <= max; p++) {
      urls.push(`${base}?${profile.paging.page_param}=${p}&${profile.paging.size_param}=${profile.paging.page_size}`);
    }
  } else {
    for (let p = 0; p < max; p++) {
      urls.push(`${base}?${profile.paging.offset_param}=${p * profile.paging.page_size}&${profile.paging.limit_param}=${profile.paging.page_size}`);
    }
  }
  return urls;
}

function normaliseRowDates(rows: ClaimRow[]): void {
  for (const row of rows) {
    if (row.claim_date) {
      const parsed = parseClaimDate(row.claim_date);
      if (parsed) row.claim_date = parsed;
    }
    if (row.policy_inception_date) {
      const parsed = parseClaimDate(row.policy_inception_date);
      if (parsed) row.policy_inception_date = parsed;
    }
  }
}

export type ConnectorPullResult = {
  rows: ClaimRow[];
  report: IngestReport;
  pages_read: number;
  analysis: ReturnType<typeof analyseRows>;
};

// Pull claims over REST JSON, following the profile's paging until a short
// page or the page cap. Stop conditions keep a chatty API from running away.
export async function pullClaims(
  profile: InsurerProfile,
  baseUrlRaw: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConnectorPullResult> {
  const baseUrl = safeBaseUrl(baseUrlRaw);
  const headers = authHeaders(profile, env, baseUrl);
  const urls = pageUrls(profile, baseUrl);
  const records: Array<Record<string, unknown>> = [];
  let pagesRead = 0;
  for (const url of urls) {
    const payload = await fetchJson(fetchImpl, url, headers);
    const page = extractClaimRecords(profile, payload);
    pagesRead++;
    records.push(...page);
    if (profile.paging.style === 'none' || page.length < profile.paging.page_size) break;
  }
  const mapped = mapInsurerRecords(profile, records);
  normaliseRowDates(mapped.rows);
  const { rows, report } = connectorIngestReport(profile, mapped.rows, mapped, `${profile.label} API`);
  return { rows, report, pages_read: pagesRead, analysis: analyseRows(rows) };
}

// Pull a claims file (CSV or Excel) over HTTPS: covers the batch file-drop
// pattern insurers use for scheduled exports.
export async function pullClaimsFile(
  profile: InsurerProfile,
  fileUrlRaw: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConnectorPullResult> {
  const url = safeBaseUrl(fileUrlRaw);
  const headers = authHeaders(profile, env, url);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, redirect: 'error' });
  } catch (e) {
    throw new ConnectorError('Could not reach the file address.', (e as Error).message);
  }
  if (!res.ok) throw new ConnectorError(`The file address answered ${res.status}.`, `HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let ingested;
  if (/\.(xlsx|xlsm)(\?|$)/i.test(url)) {
    const sheet = await rowsFromXlsx(buf);
    ingested = ingestClaimRows(sheet.headers, sheet.rows, `${profile.label} file drop`);
  } else {
    ingested = ingestClaimRowsFromCsvText(buf.toString('utf8'), `${profile.label} file drop`);
  }
  return { rows: ingested.rows, report: ingested.report, pages_read: 1, analysis: analyseRows(ingested.rows) };
}

function ingestClaimRowsFromCsvText(text: string, label: string) {
  const table = parseCsv(text);
  if (table.length < 2) throw new ConnectorError('The file needs a header row and at least one claim row.');
  const headers = table[0].map((h) => h.trim());
  const rawRows = table.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? '').trim();
    });
    return rec;
  });
  return ingestClaimRows(headers, rawRows, label);
}

// Handles one webhook push: a single claim or a batch in the profile's shape.
export function handleWebhookPayload(
  profile: InsurerProfile,
  payload: unknown,
): ConnectorPullResult {
  const records = extractClaimRecords(profile, payload);
  const mapped = mapInsurerRecords(profile, records);
  normaliseRowDates(mapped.rows);
  const { rows, report } = connectorIngestReport(profile, mapped.rows, mapped, `${profile.label} webhook`);
  return { rows, report, pages_read: 1, analysis: analyseRows(rows) };
}

// Plain-language connection test: reaches the endpoint, reads one page and
// reports what it found without keeping any claim data.
export async function testConnection(
  profile: InsurerProfile,
  baseUrlRaw: string,
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; message: string }> {
  try {
    const baseUrl = safeBaseUrl(baseUrlRaw);
    if (profile.protocol === 'file_url') {
      const result = await pullClaimsFile(profile, baseUrl, fetchImpl, env);
      return { ok: true, message: `Connected. The file holds ${result.rows.length} claim rows${result.report.months_covered ? ` over ${result.report.months_covered} months` : ''}. Nothing was stored.` };
    }
    const headers = authHeaders(profile, env, baseUrl);
    const url = pageUrls(profile, baseUrl)[0];
    const payload = await fetchJson(fetchImpl, url, headers);
    const records = extractClaimRecords(profile, payload);
    if (records.length === 0) return { ok: true, message: 'Connected, but no claims came back. Check the list key and the field mapping.' };
    const mapped = mapInsurerRecords(profile, records);
    const withRef = mapped.rows.filter((r) => r.claim_ref).length;
    return {
      ok: true,
      message: `Connected. First page holds ${records.length} claim rows; ${withRef} have a claim number, ${mapped.columns_mapped.length} columns are understood. Nothing was stored.`,
    };
  } catch (e) {
    if (e instanceof ConnectorError) return { ok: false, message: e.plain };
    return { ok: false, message: 'Connection failed: ' + (e as Error).message };
  }
}
