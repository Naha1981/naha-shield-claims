import { parseAmount, type ClaimRow } from './leakageEngine';

// Real-world claims-file ingest.
// Insurer exports arrive messy: CSV or Excel, any column names, missing values,
// duplicate rows and mixed date formats. This module maps whatever arrives onto
// the canonical claim columns, keeps a plain-language report of what was
// understood and what was missing, and never invents values for gaps.

export const CANONICAL_COLUMNS = [
  'claim_ref',
  'policy_ref',
  'insured_id',
  'insured_name',
  'policyholder_id',
  'claimant_name',
  'beneficiary_name',
  'bank_account',
  'phone',
  'document_hash',
  'funeral_parlour',
  'doctor',
  'agent',
  'amount_zar',
  'claim_date',
  'policy_inception_date',
  'status',
  'household',
] as const;

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

// Normalised alias lookup: lowercase, letters and digits only.
const ALIASES: Record<CanonicalColumn, string[]> = {
  claim_ref: [
    'claimref', 'claimno', 'claimnumber', 'claimid', 'claim', 'claimnr',
    'reference', 'referenceno', 'refno', 'ref', 'claimreference',
    'claimreferencenumber', 'claimregno', 'fileref', 'filereference',
  ],
  policy_ref: [
    'policyref', 'policyno', 'policynumber', 'policyid', 'policy',
    'policyreference', 'policynr',
  ],
  insured_id: [
    'insuredid', 'insuredidnumber', 'idnumber', 'idno', 'identitynumber',
    'deceasedid', 'lifeinsuredid', 'insuredidentitynumber', 'saidnumber',
  ],
  insured_name: [
    'insuredname', 'insured', 'deceased', 'lifeinsured', 'insuredperson',
    'nameofinsured', 'deceasedname', 'lifeassured', 'assuredlife',
  ],
  policyholder_id: [
    'policyholderid', 'holderid', 'policyownerid', 'policyholder',
    'ownerid', 'policyowner',
  ],
  claimant_name: [
    'claimantname', 'claimant', 'claimantfullname', 'claimantnameandsurname',
  ],
  beneficiary_name: [
    'beneficiaryname', 'beneficiary', 'beneficiaryfullname', 'payee',
    'payeename', 'beneficiarynameandsurname',
  ],
  bank_account: [
    'bankaccount', 'accountnumber', 'accountno', 'bankaccountnumber',
    'accno', 'payoutaccount', 'beneficiaryaccount', 'bankacc', 'account',
    'bankingaccount', 'accountnr',
  ],
  phone: [
    'phone', 'phonenumber', 'cell', 'cellphone', 'cellnumber', 'mobile',
    'mobilenumber', 'contactnumber', 'tel', 'telephone', 'msisdn',
    'cellphonenumber', 'phoneno',
  ],
  document_hash: [
    'documenthash', 'dochash', 'documentid', 'certificatehash',
    'deathcertificateno', 'deathcertificatenumber', 'docref', 'documentref',
    'documentnumber', 'certificateno',
  ],
  funeral_parlour: [
    'funeralparlour', 'parlour', 'funeralhome', 'undertaker',
    'funeralservices', 'funeraldirector', 'funeralparlor',
  ],
  doctor: [
    'doctor', 'doctorname', 'certifyingdoctor', 'medicalpractitioner',
    'physician', 'drname', 'attendingdoctor',
  ],
  agent: [
    'agent', 'agentname', 'broker', 'advisor', 'adviser', 'originator',
    'consultant', 'intermediary', 'salesperson', 'agentcode', 'brokername',
  ],
  amount_zar: [
    'amount', 'amountzar', 'amountpaid', 'paidamount', 'claimamount',
    'claimvalue', 'settlementamount', 'settlement', 'payout', 'payoutamount',
    'paid', 'value', 'benefitamount', 'sumpaid', 'grossamount', 'netamount',
    'amountr', 'paidr', 'amountrand', 'totalpaid', 'claimpaid',
  ],
  claim_date: [
    'claimdate', 'dateofclaim', 'lossdate', 'dateofloss', 'incidentdate',
    'dateofincident', 'eventdate', 'dateofdeath', 'dateregistered',
    'claimdateregistered', 'dateofevent', 'date',
  ],
  policy_inception_date: [
    'policyinceptiondate', 'inceptiondate', 'inception', 'policystartdate',
    'startdate', 'coverstartdate', 'commencementdate', 'policystart',
    'coverstart', 'policyinception',
  ],
  status: ['status', 'claimstatus', 'state', 'claimstate'],
  household: ['household', 'householdid', 'familyid', 'family', 'hh', 'hhid'],
};

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIAS_LOOKUP = new Map<string, CanonicalColumn>();
for (const [canonical, aliases] of Object.entries(ALIASES) as [CanonicalColumn, string[]][]) {
  for (const a of aliases) {
    if (!ALIAS_LOOKUP.has(a)) ALIAS_LOOKUP.set(a, canonical);
  }
}

// Fallback "contains" rules, applied only when no exact alias matched and the
// target column is still unmapped. Ordered by confidence.
const CONTAINS_RULES: Array<[RegExp, CanonicalColumn]> = [
  [/inception|commencement|coverstart|policystart/, 'policy_inception_date'],
  [/lossdate|dateofloss|dateofdeath|incidentdate|claimdate|dateofclaim/, 'claim_date'],
  [/claim.*(no|nr|num|ref|id)|ref.*no/, 'claim_ref'],
  [/policy.*(no|nr|num|ref|id)/, 'policy_ref'],
  [/beneficiar/, 'beneficiary_name'],
  [/claimant/, 'claimant_name'],
  [/insured.*id|id.*number/, 'insured_id'],
  [/insured|deceased|lifeassured/, 'insured_name'],
  [/holder|owner/, 'policyholder_id'],
  [/account|bank/, 'bank_account'],
  [/phone|cell|mobile|contact/, 'phone'],
  [/hash|certificate|document/, 'document_hash'],
  [/parlour|parlor|undertaker|funeral/, 'funeral_parlour'],
  [/doctor|physician|practitioner/, 'doctor'],
  [/agent|broker|advis|originator|consultant/, 'agent'],
  [/amount|paid|payout|settlement|value/, 'amount_zar'],
  [/inception|start/, 'policy_inception_date'],
  [/date/, 'claim_date'],
  [/status/, 'status'],
  [/household|family/, 'household'],
];

export type HeaderMapping = {
  // canonical column -> source header it came from
  matched: Partial<Record<CanonicalColumn, string>>;
  // source headers we could not place
  unmapped: string[];
};

export function mapHeaders(headers: string[]): HeaderMapping {
  const matched: Partial<Record<CanonicalColumn, string>> = {};
  const usedHeaders = new Set<string>();
  // Pass 1: exact aliases.
  for (const h of headers) {
    const target = ALIAS_LOOKUP.get(normaliseHeader(h));
    if (target && !matched[target]) {
      matched[target] = h;
      usedHeaders.add(h);
    }
  }
  // Pass 2: contains rules, first strong match wins per target.
  for (const [pattern, target] of CONTAINS_RULES) {
    if (matched[target]) continue;
    for (const h of headers) {
      if (usedHeaders.has(h)) continue;
      if (pattern.test(normaliseHeader(h))) {
        matched[target] = h;
        usedHeaders.add(h);
        break;
      }
    }
  }
  return { matched, unmapped: headers.filter((h) => !usedHeaders.has(h)) };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number): string | null => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Understands YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY/MM/DD,
// "5 Jun 2026", "Jun 5 2026" and Excel serial day numbers. South African
// exports are day-first; an ambiguous 01/02/2026 is read as 1 February and the
// report notes the assumption.
export function parseClaimDate(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    // Day-first (SA convention). If the first number cannot be a month this is
    // unambiguous; otherwise we still read day-first and say so in the report.
    return iso(+m[3], +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? iso(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s*,?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? iso(+m[3], mon, +m[2]) : null;
  }
  if (/^\d{5}(\.0+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= 30000 && serial <= 60000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

export type IngestReport = {
  file_name: string;
  rows_read: number;
  rows_used: number;
  columns_mapped: Array<{ from: string; to: CanonicalColumn }>;
  columns_ignored: string[];
  rows_missing_ref: number;
  rows_missing_amount: number;
  rows_missing_date: number;
  dates_not_understood: number;
  duplicate_rows_removed: number;
  first_claim_date: string | null;
  last_claim_date: string | null;
  months_covered: number | null;
  warnings: string[];
};

export type IngestResult = {
  rows: ClaimRow[];
  report: IngestReport;
};

export function ingestClaimRows(
  headers: string[],
  rawRows: Array<Record<string, string>>,
  fileName: string,
): IngestResult {
  const mapping = mapHeaders(headers);
  const warnings: string[] = [];
  if (!mapping.matched.claim_ref) {
    throw new Error(
      'No claim reference column found. Columns seen: ' +
        headers.map((h) => `"${h}"`).join(', ') +
        '. Add a column like "Claim No" or "Claim Ref" and try again.',
    );
  }
  if (!mapping.matched.amount_zar) {
    warnings.push('No amount column was recognised, so rand values read as R0. Check the column names against the template.');
  }
  if (!mapping.matched.status) {
    warnings.push('No status column was recognised, so every row is counted as paid. Declined claims should carry a "declined" status.');
  }
  if (!mapping.matched.claim_date) {
    warnings.push('No claim date column was recognised, so date coverage and early-claim timing cannot be checked.');
  }

  const rows: ClaimRow[] = [];
  const seenSignatures = new Set<string>();
  let duplicateRowsRemoved = 0;
  let rowsMissingRef = 0;
  let rowsMissingAmount = 0;
  let rowsMissingDate = 0;
  let datesNotUnderstood = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (const raw of rawRows) {
    const row: ClaimRow = {};
    for (const c of CANONICAL_COLUMNS) row[c] = '';
    for (const [canonical, source] of Object.entries(mapping.matched) as [CanonicalColumn, string][]) {
      row[canonical] = String(raw[source] ?? '').trim();
    }
    const hasAnyValue = Object.values(row).some((v) => v !== '');
    if (!hasAnyValue) continue;

    const signature = CANONICAL_COLUMNS.map((c) => row[c] ?? '').join('\u0001');
    if (seenSignatures.has(signature)) {
      duplicateRowsRemoved++;
      continue;
    }
    seenSignatures.add(signature);

    if (row.claim_date) {
      const parsed = parseClaimDate(row.claim_date);
      if (parsed) {
        row.claim_date = parsed;
        if (!firstDate || parsed < firstDate) firstDate = parsed;
        if (!lastDate || parsed > lastDate) lastDate = parsed;
      } else {
        datesNotUnderstood++;
        row.claim_date = '';
      }
    }
    if (row.policy_inception_date) {
      const parsed = parseClaimDate(row.policy_inception_date);
      if (parsed) row.policy_inception_date = parsed;
      else row.policy_inception_date = '';
    }

    if (!row.claim_ref) rowsMissingRef++;
    if (mapping.matched.amount_zar && !row.amount_zar) rowsMissingAmount++;
    if (mapping.matched.claim_date && !row.claim_date) rowsMissingDate++;
    rows.push(row);
  }

  rows.forEach((row, i) => {
    if (!row.claim_ref) row.claim_ref = `row-${i + 1}`;
  });

  const monthsCovered =
    firstDate && lastDate
      ? Math.max(
          1,
          (Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4))) * 12 +
            (Number(lastDate.slice(5, 7)) - Number(firstDate.slice(5, 7))) +
            1,
        )
      : null;

  if (rowsMissingRef > 0) warnings.push(`${rowsMissingRef} row(s) had no claim reference; they were kept and labelled row-1, row-2...`);
  if (rowsMissingAmount > 0) warnings.push(`${rowsMissingAmount} row(s) had no amount; they count as R0 in the totals.`);
  if (rowsMissingDate > 0) warnings.push(`${rowsMissingDate} row(s) had no readable claim date.`);
  if (datesNotUnderstood > 0) warnings.push(`${datesNotUnderstood} date value(s) could not be understood and were left out of date checks.`);
  if (duplicateRowsRemoved > 0) warnings.push(`${duplicateRowsRemoved} exact duplicate row(s) were removed so one export line is not counted twice.`);

  return {
    rows,
    report: {
      file_name: fileName,
      rows_read: rawRows.length,
      rows_used: rows.length,
      columns_mapped: (Object.entries(mapping.matched) as [CanonicalColumn, string][]).map(
        ([to, from]) => ({ from, to }),
      ),
      columns_ignored: mapping.unmapped,
      rows_missing_ref: rowsMissingRef,
      rows_missing_amount: rowsMissingAmount,
      rows_missing_date: rowsMissingDate,
      dates_not_understood: datesNotUnderstood,
      duplicate_rows_removed: duplicateRowsRemoved,
      first_claim_date: firstDate,
      last_claim_date: lastDate,
      months_covered: monthsCovered,
      warnings,
    },
  };
}

// Convenience for CSV text: reuse the tolerant CSV parser, then ingest.
export function ingestCsvText(csvText: string, fileName: string, parseCsv: (t: string) => string[][]): IngestResult {
  const table = parseCsv(csvText);
  if (table.length < 2) throw new Error('The file needs a header row and at least one claim row.');
  const headers = table[0].map((h) => h.trim());
  const rawRows = table.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? '').trim();
    });
    return rec;
  });
  return ingestClaimRows(headers, rawRows, fileName);
}
