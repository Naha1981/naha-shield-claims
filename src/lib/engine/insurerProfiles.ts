import {
  CANONICAL_COLUMNS,
  mapHeaders,
  type CanonicalColumn,
  type IngestReport,
} from './claimsFileIngest';
import type { ClaimRow } from './leakageEngine';

// Insurer connector profiles.
// A new insurer connects by configuration, not code: an endpoint, an auth
// type, a field mapping, optional paging and an optional pull schedule. The
// three built-ins are ready-made examples proven against mock feeds; any other
// insurer's REST JSON, webhook push or HTTPS file-drop works with the same
// shape supplied at runtime.

export type ConnectorAuth =
  | { type: 'none' }
  | { type: 'api_key_header'; header: string; env_var: string }
  | { type: 'bearer'; env_var: string }
  | { type: 'basic'; username_env: string; password_env: string };

export type ConnectorPaging =
  | { style: 'none' }
  | { style: 'page_param'; page_param: string; size_param: string; page_size: number; max_pages: number }
  | { style: 'offset_param'; offset_param: string; limit_param: string; page_size: number; max_pages: number };

export type ConnectorProtocol = 'rest_json' | 'webhook' | 'file_url';

export type InsurerProfile = {
  id: string; // lowercase slug, unique
  label: string; // short display name
  insurer: string; // who this connects
  protocol: ConnectorProtocol;
  status: 'mock-proven' | 'config-only';
  auth: ConnectorAuth;
  claims_path: string; // appended to the insurer base URL for pulls
  claims_list_key: string; // JSON key holding the claim array; '' = payload is the array
  // insurer field name -> canonical column. Unmapped fields fall back to the
  // automatic column-name recogniser, so partial maps still work.
  field_map: Record<string, CanonicalColumn>;
  paging: ConnectorPaging;
  schedule: { enabled: boolean; interval_minutes: number }; // pull schedule; off by default
  webhook_secret_env: string; // env var holding the shared secret for push verification
  notes: string;
};

export const BUILT_IN_PROFILES: InsurerProfile[] = [
  {
    id: 'liberty',
    label: 'Liberty',
    insurer: 'Liberty (example profile)',
    protocol: 'rest_json',
    status: 'mock-proven',
    auth: { type: 'api_key_header', header: 'x-api-key', env_var: 'INSURER_LIBERTY_API_KEY' },
    claims_path: '/claims',
    claims_list_key: 'claims',
    field_map: {
      claimNumber: 'claim_ref',
      policyNumber: 'policy_ref',
      lifeAssured: 'insured_name',
      insuredIdNumber: 'insured_id',
      claimant: 'claimant_name',
      beneficiary: 'beneficiary_name',
      payoutAccount: 'bank_account',
      contactNumber: 'phone',
      certificateNumber: 'document_hash',
      funeralDirector: 'funeral_parlour',
      certifyingDoctor: 'doctor',
      adviserCode: 'agent',
      paidAmount: 'amount_zar',
      lossDate: 'claim_date',
      policyStartDate: 'policy_inception_date',
      claimStatus: 'status',
    },
    paging: { style: 'page_param', page_param: 'page', size_param: 'pageSize', page_size: 500, max_pages: 20 },
    schedule: { enabled: false, interval_minutes: 1440 },
    webhook_secret_env: 'INSURER_LIBERTY_WEBHOOK_SECRET',
    notes: 'Pull claims as JSON, or receive pushes on the Liberty webhook path. Proven against the built-in mock Liberty feed.',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    insurer: 'Momentum (example profile)',
    protocol: 'rest_json',
    status: 'mock-proven',
    auth: { type: 'bearer', env_var: 'INSURER_MOMENTUM_TOKEN' },
    claims_path: '/claims',
    claims_list_key: 'data',
    field_map: {
      ClaimReference: 'claim_ref',
      PolicyRef: 'policy_ref',
      DeceasedName: 'insured_name',
      InsuredId: 'insured_id',
      ClaimantName: 'claimant_name',
      BeneficiaryName: 'beneficiary_name',
      BankAccountNumber: 'bank_account',
      CellphoneNumber: 'phone',
      DeathCertificateNo: 'document_hash',
      FuneralParlour: 'funeral_parlour',
      DoctorName: 'doctor',
      BrokerCode: 'agent',
      AmountPaid: 'amount_zar',
      DateOfLoss: 'claim_date',
      InceptionDate: 'policy_inception_date',
      Status: 'status',
    },
    paging: { style: 'offset_param', offset_param: 'offset', limit_param: 'limit', page_size: 500, max_pages: 20 },
    schedule: { enabled: false, interval_minutes: 1440 },
    webhook_secret_env: 'INSURER_MOMENTUM_WEBHOOK_SECRET',
    notes: 'Pull claims as JSON with offset paging, or receive pushes on the Momentum webhook path. Proven against the built-in mock Momentum feed.',
  },
  {
    id: 'generic',
    label: 'Any insurer (generic)',
    insurer: "Lawrence's company or any other insurer",
    protocol: 'rest_json',
    status: 'mock-proven',
    auth: { type: 'none' },
    claims_path: '/claims',
    claims_list_key: '',
    field_map: {},
    paging: { style: 'none' },
    schedule: { enabled: false, interval_minutes: 1440 },
    webhook_secret_env: 'INSURER_GENERIC_WEBHOOK_SECRET',
    notes: 'No fixed field names: the automatic column recogniser reads whatever the insurer sends. Proven against the built-in mock generic feed.',
  },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function getProfile(id: string, extra: InsurerProfile[] = []): InsurerProfile | null {
  return [...BUILT_IN_PROFILES, ...extra].find((p) => p.id === id) ?? null;
}

// Validates a profile supplied at runtime (env JSON or the add-connector form).
// Returns a list of plain-language problems; empty list means usable.
export function validateProfile(p: unknown): string[] {
  const problems: string[] = [];
  const o = p as Partial<InsurerProfile>;
  if (!o || typeof o !== 'object') return ['Profile must be an object.'];
  if (!o.id || !ID_RE.test(o.id)) problems.push('id must be a short lowercase slug, e.g. "acme-life".');
  if (!o.label) problems.push('label is required.');
  if (!['rest_json', 'webhook', 'file_url'].includes(String(o.protocol))) problems.push('protocol must be rest_json, webhook or file_url.');
  const authType = (o.auth as ConnectorAuth | undefined)?.type;
  if (!['none', 'api_key_header', 'bearer', 'basic'].includes(String(authType))) problems.push('auth.type must be none, api_key_header, bearer or basic.');
  if (authType === 'api_key_header' && !(o.auth as { header?: string }).header) problems.push('api_key_header auth needs a header name.');
  if (typeof o.claims_path !== 'string') problems.push('claims_path must be a string like /claims.');
  if (o.field_map && typeof o.field_map === 'object') {
    for (const [from, to] of Object.entries(o.field_map)) {
      if (!CANONICAL_COLUMNS.includes(to as CanonicalColumn)) {
        problems.push(`field_map: "${from}" points at unknown column "${to}". Known columns: ${CANONICAL_COLUMNS.join(', ')}.`);
      }
    }
  } else if (o.field_map != null) {
    problems.push('field_map must be an object of insurer field -> canonical column.');
  }
  if (o.paging && !['none', 'page_param', 'offset_param'].includes(String(o.paging.style))) problems.push('paging.style must be none, page_param or offset_param.');
  return problems;
}

export function normaliseProfile(p: InsurerProfile): InsurerProfile {
  return {
    ...p,
    claims_path: p.claims_path || '/claims',
    claims_list_key: p.claims_list_key ?? '',
    field_map: p.field_map ?? {},
    paging: p.paging ?? { style: 'none' },
    schedule: p.schedule ?? { enabled: false, interval_minutes: 1440 },
    webhook_secret_env: p.webhook_secret_env ?? `INSURER_${p.id.toUpperCase().replace(/-/g, '_')}_WEBHOOK_SECRET`,
    status: p.status ?? 'config-only',
    notes: p.notes ?? '',
  };
}

// Pulls the claim array out of an insurer payload: either the configured list
// key, the whole payload as an array, or a single claim object.
export function extractClaimRecords(profile: InsurerProfile, payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    if (profile.claims_list_key) {
      const inner = (payload as Record<string, unknown>)[profile.claims_list_key];
      if (Array.isArray(inner)) return inner.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>;
      return [];
    }
    const firstArray = Object.values(payload as Record<string, unknown>).find(Array.isArray);
    if (Array.isArray(firstArray)) return firstArray.filter((r) => r && typeof r === 'object') as Array<Record<string, unknown>>;
    return [payload as Record<string, unknown>];
  }
  return [];
}

// Maps insurer records onto the canonical claim model. The profile's field_map
// wins; anything unmapped falls back to the automatic column-name recogniser.
export function mapInsurerRecords(
  profile: InsurerProfile,
  records: Array<Record<string, unknown>>,
): { rows: ClaimRow[]; columns_mapped: Array<{ from: string; to: CanonicalColumn }>; columns_ignored: string[] } {
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const fallback = mapHeaders(headers.filter((h) => !(h in profile.field_map)));
  const resolved: Record<string, CanonicalColumn> = { ...profile.field_map };
  for (const [to, from] of Object.entries(fallback.matched)) {
    if (!Object.values(resolved).includes(to as CanonicalColumn)) resolved[from] = to as CanonicalColumn;
  }
  const rows = records.map((rec) => {
    const row: ClaimRow = {};
    for (const c of CANONICAL_COLUMNS) row[c] = '';
    for (const [from, to] of Object.entries(resolved)) {
      const v = rec[from];
      row[to] = v == null ? '' : String(v).trim();
    }
    return row;
  });
  const mappedFrom = new Set(Object.keys(resolved).filter((k) => headers.includes(k)));
  return {
    rows,
    columns_mapped: Object.entries(resolved)
      .filter(([from]) => mappedFrom.has(from))
      .map(([from, to]) => ({ from, to })),
    columns_ignored: headers.filter((h) => !mappedFrom.has(h)),
  };
}

// Builds the ingest report for connector-fed rows so the File check card tells
// the same plain-language story as file uploads.
export function connectorIngestReport(
  profile: InsurerProfile,
  rows: ClaimRow[],
  mapped: { columns_mapped: Array<{ from: string; to: CanonicalColumn }>; columns_ignored: string[] },
  sourceLabel: string,
): { rows: ClaimRow[]; report: IngestReport } {
  let missingRef = 0;
  let missingAmount = 0;
  let missingDate = 0;
  let first: string | null = null;
  let last: string | null = null;
  const seen = new Set<string>();
  let duplicates = 0;
  const kept: ClaimRow[] = [];
  for (const row of rows) {
    const sig = CANONICAL_COLUMNS.map((c) => row[c] ?? '').join('');
    if (seen.has(sig)) {
      duplicates++;
      continue;
    }
    seen.add(sig);
    if (!row.claim_ref) missingRef++;
    if (!row.amount_zar) missingAmount++;
    if (!row.claim_date) missingDate++;
    if (row.claim_date) {
      if (!first || row.claim_date < first) first = row.claim_date;
      if (!last || row.claim_date > last) last = row.claim_date;
    }
    kept.push(row);
  }
  kept.forEach((row, i) => {
    if (!row.claim_ref) row.claim_ref = `row-${i + 1}`;
  });
  const warnings: string[] = [];
  if (missingRef > 0) warnings.push(`${missingRef} row${missingRef === 1 ? '' : 's'} had no claim number: kept as row-N`);
  if (missingAmount > 0) warnings.push(`${missingAmount} row${missingAmount === 1 ? '' : 's'} had no amount; counted as R0.`);
  if (missingDate > 0) warnings.push(`${missingDate} row${missingDate === 1 ? '' : 's'} had no readable claim date.`);
  if (duplicates > 0) warnings.push(`${duplicates} duplicate export row${duplicates === 1 ? '' : 's'} removed.`);
  const months =
    first && last
      ? Math.max(1, (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + (Number(last.slice(5, 7)) - Number(first.slice(5, 7))) + 1)
      : null;
  return {
    rows: kept,
    report: {
    file_name: sourceLabel,
    rows_read: rows.length,
    rows_used: kept.length,
    columns_mapped: mapped.columns_mapped,
    columns_ignored: mapped.columns_ignored,
    rows_missing_ref: missingRef,
    rows_missing_amount: missingAmount,
    rows_missing_date: missingDate,
    dates_not_understood: 0,
    duplicate_rows_removed: duplicates,
    first_claim_date: first,
    last_claim_date: last,
    months_covered: months,
    warnings,
    },
  };
}
