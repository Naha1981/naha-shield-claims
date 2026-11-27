import express from 'express';
import {
  DEATH_VERIFICATION_CHECKLIST,
  TRACING_SOURCES,
} from '../src/lib/engine/tracingSources';

// Retrospective claims-file leakage review.
// Read-only and in-memory: an uploaded CSV is analysed and discarded. Nothing is
// stored, shared or actioned. Every finding is a lead for a human investigator.

export type ClaimRow = Record<string, string>;

export const LEAKAGE_COLUMNS = [
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
];

export const SHORT_WINDOW_DAYS = 365; // illustrative, not calibrated
export const AGENT_MIN_CLAIMS = 5; // illustrative, not calibrated
export const AGENT_MIN_SHARE = 0.3; // illustrative, not calibrated
export const PROVIDER_MIN_CLAIMS = 3; // illustrative, not calibrated

export type Finding = {
  id: string;
  rule: string;
  subject: string;
  claim_refs: string[];
  amount_flagged_zar: number;
  reason: string;
  innocent_explanation: string;
  next_check: string;
  death_checklist: boolean;
  tracing: boolean;
  evidence_rows: ClaimRow[];
  status: 'Needs human investigation';
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

export function rowsFromCsv(text: string): ClaimRow[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('CSV needs a header row and at least one claim row');
  const header = table[0].map(norm);
  if (!header.includes('claim_ref')) throw new Error("CSV must include a 'claim_ref' column");
  return table.slice(1).map((cells) => {
    const row: ClaimRow = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

export function parseAmount(s: string): number {
  let t = String(s).replace(/[Rr\s]/g, '');
  if (t.includes(',') && t.includes('.')) {
    t = t.replace(/,/g, ''); // 1,250.00
  } else if (t.includes(',')) {
    const parts = t.split(',');
    t = parts.length === 2 && parts[1].length === 2 ? parts[0] + '.' + parts[1] : t.replace(/,/g, ''); // SA decimal comma vs thousands
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const dayMs = 86400000;
const days = (a: string, b: string) => {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return NaN;
  return Math.round((db - da) / dayMs);
};

const paid = (r: ClaimRow) => norm(r.status || '') !== 'declined';
const ref = (r: ClaimRow, i: number) => r.claim_ref || `row-${i + 1}`;
const householdOf = (r: ClaimRow) => norm(r.household || '') || `unknown-${norm(r.claimant_name || r.claim_ref)}`;

function sumPaid(rows: ClaimRow[]): number {
  return Math.round(rows.filter(paid).reduce((t, r) => t + parseAmount(r.amount_zar), 0) * 100) / 100;
}

export function demoCsv(): string {
  const H = LEAKAGE_COLUMNS.join(',');
  const r = (v: (string | number)[]) => v.join(',');
  const rows: (string | number)[][] = [];
  // Clean baseline claims (fictional), Jun-Nov 2026.
  for (let i = 1; i <= 18; i++) {
    const pad = String(i).padStart(3, '0');
    rows.push([
      `SYN-CLM-${pad}`,
      `SYN-POL-${pad}`,
      `SYN-INS-${pad}`,
      `Fictional insured ${pad}`,
      `SYN-HDR-${pad}`,
      `Fictional claimant ${pad}`,
      `Fictional beneficiary ${pad}`,
      `SYN-ACC-${pad}`,
      `SYN-PH-${pad}`,
      `SYN-DOC-${pad}`,
      `Fictional Parlour P${pad}`,
      `Fictional Dr D${pad}`,
      i % 4 === 0 ? 'Fictional agent R' : `Fictional agent ${(i % 3) + 1}`,
      120000 + i * 5000,
      `2026-${String(6 + (i % 6)).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      `2024-${String((i % 12) + 1).padStart(2, '0')}-15`,
      i === 7 || i === 12 ? 'declined' : 'paid',
      `SYN-HH-${pad}`,
    ]);
  }
  // Innocent control: one family shares a phone and a household. Must not flag.
  rows.push(
    ['SYN-CLM-019', 'SYN-POL-019', 'SYN-INS-019', 'Fictional insured 019', 'SYN-HDR-019', 'Fictional claimant 019', 'Fictional beneficiary 019', 'SYN-ACC-019', 'SYN-PH-FAMILY', 'SYN-DOC-019', 'Fictional Parlour South', 'Fictional Dr M', 'Fictional agent 2', 180000, '2026-09-02', '2023-02-10', 'paid', 'SYN-HH-FAMILY'],
    ['SYN-CLM-020', 'SYN-POL-020', 'SYN-INS-020', 'Fictional insured 020', 'SYN-HDR-020', 'Fictional claimant 020', 'Fictional beneficiary 019', 'SYN-ACC-020', 'SYN-PH-FAMILY', 'SYN-DOC-020', 'Fictional Parlour South', 'Fictional Dr M', 'Fictional agent 2', 165000, '2026-09-20', '2023-03-11', 'paid', 'SYN-HH-FAMILY'],
  );
  // Pattern 1: duplicate payment of the same claim reference.
  rows.push(
    ['SYN-CLM-021', 'SYN-POL-021', 'SYN-INS-021', 'Fictional insured 021', 'SYN-HDR-021', 'Fictional claimant 021', 'Fictional beneficiary 021', 'SYN-ACC-021', 'SYN-PH-021', 'SYN-DOC-021', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent 1', 240000, '2026-10-05', '2024-01-20', 'paid', 'SYN-HH-021'],
    ['SYN-CLM-021', 'SYN-POL-021', 'SYN-INS-021', 'Fictional insured 021', 'SYN-HDR-021', 'Fictional claimant 021', 'Fictional beneficiary 021', 'SYN-ACC-021', 'SYN-PH-021', 'SYN-DOC-021', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent 1', 240000, '2026-10-05', '2024-01-20', 'paid', 'SYN-HH-021'],
  );
  // Pattern 2: one bank account paid for two unrelated claimants.
  rows.push(
    ['SYN-CLM-022', 'SYN-POL-022', 'SYN-INS-022', 'Fictional insured 022', 'SYN-HDR-022', 'Fictional claimant 022', 'Fictional beneficiary 022', 'SYN-ACC-MULE', 'SYN-PH-022', 'SYN-DOC-022', 'Fictional Parlour West', 'Fictional Dr L', 'Fictional agent 2', 195000, '2026-08-14', '2023-06-01', 'paid', 'SYN-HH-022'],
    ['SYN-CLM-023', 'SYN-POL-023', 'SYN-INS-023', 'Fictional insured 023', 'SYN-HDR-023', 'Fictional claimant 023', 'Fictional beneficiary 023', 'SYN-ACC-MULE', 'SYN-PH-023', 'SYN-DOC-023', 'Fictional Parlour East', 'Fictional Dr K', 'Fictional agent 3', 210000, '2026-10-30', '2022-11-19', 'paid', 'SYN-HH-023'],
  );
  // Pattern 3: one beneficiary across two unrelated deceased lives.
  rows.push(
    ['SYN-CLM-024', 'SYN-POL-024', 'SYN-INS-101', 'Fictional insured 101', 'SYN-HDR-024', 'Fictional claimant 024', 'Fictional beneficiary NINE', 'SYN-ACC-024', 'SYN-PH-024', 'SYN-DOC-024', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent 1', 320000, '2026-07-11', '2021-04-01', 'paid', 'SYN-HH-024'],
    ['SYN-CLM-025', 'SYN-POL-025', 'SYN-INS-102', 'Fictional insured 102', 'SYN-HDR-025', 'Fictional claimant 025', 'Fictional beneficiary NINE', 'SYN-ACC-025', 'SYN-PH-025', 'SYN-DOC-025', 'Fictional Parlour West', 'Fictional Dr L', 'Fictional agent 2', 280000, '2026-11-02', '2022-08-15', 'paid', 'SYN-HH-025'],
  );
  // Pattern 4: the same document digest on three unrelated claims.
  rows.push(
    ['SYN-CLM-026', 'SYN-POL-026', 'SYN-INS-026', 'Fictional insured 026', 'SYN-HDR-026', 'Fictional claimant 026', 'Fictional beneficiary 026', 'SYN-ACC-026', 'SYN-PH-026', 'SYN-DOC-REUSED', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent 1', 150000, '2026-08-25', '2024-05-05', 'paid', 'SYN-HH-026'],
    ['SYN-CLM-027', 'SYN-POL-027', 'SYN-INS-027', 'Fictional insured 027', 'SYN-HDR-027', 'Fictional claimant 027', 'Fictional beneficiary 027', 'SYN-ACC-027', 'SYN-PH-027', 'SYN-DOC-REUSED', 'Fictional Parlour East', 'Fictional Dr L', 'Fictional agent 2', 175000, '2026-09-29', '2024-07-07', 'paid', 'SYN-HH-027'],
    ['SYN-CLM-028', 'SYN-POL-028', 'SYN-INS-028', 'Fictional insured 028', 'SYN-HDR-028', 'Fictional claimant 028', 'Fictional beneficiary 028', 'SYN-ACC-028', 'SYN-PH-028', 'SYN-DOC-REUSED', 'Fictional Parlour West', 'Fictional Dr K', 'Fictional agent 3', 160000, '2026-11-15', '2024-09-09', 'paid', 'SYN-HH-028'],
  );
  // Pattern 5: claims shortly after policy start (two, same fictional policyholder, other lives).
  rows.push(
    ['SYN-CLM-029', 'SYN-POL-029', 'SYN-INS-029', 'Fictional insured 029', 'SYN-HDR-HOLD', 'Fictional claimant 029', 'Fictional beneficiary 029', 'SYN-ACC-029', 'SYN-PH-029', 'SYN-DOC-029', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent R', 400000, '2026-10-20', '2026-08-01', 'paid', 'SYN-HH-029'],
    ['SYN-CLM-030', 'SYN-POL-030', 'SYN-INS-030', 'Fictional insured 030', 'SYN-HDR-HOLD', 'Fictional claimant 030', 'Fictional beneficiary 030', 'SYN-ACC-030', 'SYN-PH-030', 'SYN-DOC-030', 'Fictional Parlour West', 'Fictional Dr L', 'Fictional agent R', 350000, '2026-11-18', '2026-05-01', 'paid', 'SYN-HH-030'],
  );
  // Pattern 6: the same insured identity paid on two different claims.
  rows.push(
    ['SYN-CLM-031', 'SYN-POL-031', 'SYN-INS-105', 'Fictional insured 105', 'SYN-HDR-031', 'Fictional claimant 031', 'Fictional beneficiary 031', 'SYN-ACC-031', 'SYN-PH-031', 'SYN-DOC-031', 'Fictional Parlour North', 'Fictional Dr K', 'Fictional agent R', 260000, '2026-06-21', '2020-01-15', 'paid', 'SYN-HH-031'],
    ['SYN-CLM-032', 'SYN-POL-032', 'SYN-INS-105', 'Fictional insured 105', 'SYN-HDR-032', 'Fictional claimant 032', 'Fictional beneficiary 032', 'SYN-ACC-032', 'SYN-PH-032', 'SYN-DOC-032', 'Fictional Parlour East', 'Fictional Dr L', 'Fictional agent R', 245000, '2026-09-08', '2021-02-20', 'paid', 'SYN-HH-032'],
  );
  // Pattern 7: originator concentration (fictional agent R already has 2 above + these 5).
  for (let i = 33; i <= 37; i++) {
    rows.push([
      `SYN-CLM-0${i}`,
      `SYN-POL-0${i}`,
      `SYN-INS-0${i}`,
      `Fictional insured 0${i}`,
      `SYN-HDR-0${i}`,
      `Fictional claimant 0${i}`,
      `Fictional beneficiary 0${i}`,
      `SYN-ACC-0${i}`,
      `SYN-PH-0${i}`,
      `SYN-DOC-0${i}`,
      i % 2 ? 'Fictional Parlour West' : 'Fictional Parlour North',
      i % 2 ? 'Fictional Dr K' : 'Fictional Dr L',
      'Fictional agent R',
      130000 + i * 3000,
      `2026-0${6 + (i % 4)}-1${i % 9}`,
      '2023-01-01',
      'paid',
      `SYN-HH-0${i}`,
    ]);
  }
  return H + '\n' + rows.map(r).join('\n') + '\n';
}

export function analyseLeakage(csvText: string) {
  const rows = rowsFromCsv(csvText);
  const findings: Finding[] = [];
  const add = (
    rule: string,
    subject: string,
    group: ClaimRow[],
    reason: string,
    innocent_explanation: string,
    next_check: string,
    death_checklist: boolean,
    tracing: boolean,
  ) => {
    const refs = [...new Set(group.map((r, i) => ref(r, rows.indexOf(r))))];
    findings.push({
      id: `LEAK-${String(findings.length + 1).padStart(3, '0')}`,
      rule,
      subject,
      claim_refs: refs,
      amount_flagged_zar: sumPaid(group),
      reason,
      innocent_explanation,
      next_check,
      death_checklist,
      tracing,
      evidence_rows: group,
      status: 'Needs human investigation',
    });
  };

  const by = (key: (r: ClaimRow) => string) => {
    const m = new Map<string, ClaimRow[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const distinct = (vals: string[]) => new Set(vals.filter(Boolean)).size;

  // 1. Possible duplicate payment: same claim reference more than once, or the
  // same insured, date and amount twice.
  for (const [k, g] of by((r) => norm(r.claim_ref))) {
    if (k && g.length > 1) {
      add('Possible duplicate payment', g[0].claim_ref || k, g, `Claim reference ${k} appears ${g.length} times in the file. A second payment of one claim is direct leakage.`, 'A corrected re-submission or a system export duplication can look identical. Check payment run IDs.', 'Match both rows to bank payment runs; if one claim was paid twice, quantify and start recovery.', false, true);
    }
  }
  for (const [k, g] of by((r) => [norm(r.insured_id), norm(r.claim_date), String(parseAmount(r.amount_zar))].filter(Boolean).join('|'))) {
    const refs = new Set(g.map((r) => norm(r.claim_ref)));
    if (k && g.length > 1 && refs.size > 1) {
      add('Same insured, date and amount on different references', g[0].insured_name || g[0].insured_id, g, `${g.length} differently referenced claims share one insured identity, date and amount. This is how duplicates hide after re-capture.`, 'Two genuine benefits (for example funeral and life) can pay on the same day. Check policy types.', 'Compare the supporting documents line by line before treating one as a duplicate.', false, true);
    }
  }

  // 2. Shared bank account across unrelated claimants.
  for (const [acc, g] of by((r) => norm(r.bank_account))) {
    const claimants = g.map((r) => norm(r.claimant_name));
    const households = g.map(householdOf);
    if (distinct(claimants) >= 2 && distinct(households) >= 2) {
      add('Shared bank account across unrelated claims', g[0].bank_account, g, `One bank account received money for ${distinct(claimants)} unrelated fictional claimants. Shared payout accounts are a classic syndicate marker.`, 'Family representatives, funeral schemes and administrators lawfully receive money for others.', 'Confirm the account holder and their relationship to each claimant; trace with the free sources below.', false, true);
    }
  }

  // 3. Beneficiary across unrelated deceased lives.
  for (const [b, g] of by((r) => norm(r.beneficiary_name))) {
    const lives = distinct(g.map((r) => norm(r.insured_id)));
    const households = distinct(g.map(householdOf));
    if (b && lives >= 2 && households >= 2) {
      add('Beneficiary across unrelated lives', g[0].beneficiary_name, g, `One fictional beneficiary is named on claims over ${lives} unrelated insured lives. A repeat pattern needs source verification first.`, 'Executors, family representatives and funeral schemes appear on several claims lawfully.', 'Verify identity and relationship on each claim; run the death-verification checklist for each life.', true, true);
    }
  }

  // 4. Reused document digest.
  for (const [doc, g] of by((r) => norm(r.document_hash))) {
    if (doc && g.length >= 2 && new Set(g.map((r) => norm(r.claim_ref))).size >= 2) {
      add('Reused document across claims', g[0].document_hash, g, `One document digest supports ${g.length} unrelated fictional claims. Reused or edited certificates are a forgery lead.`, 'Template documents and batch scans can collide; the digest proves sameness, not forgery.', 'Pull the original document for each claim and compare certificates against issuer records.', true, false);
    }
  }

  // 5. Claim soon after policy start.
  for (const r of rows) {
    const d = days(r.policy_inception_date, r.claim_date);
    if (!Number.isNaN(d) && d >= 0 && d <= SHORT_WINDOW_DAYS) {
      add('Claim soon after policy start', r.policy_ref || r.claim_ref, [r], `Claim is dated ${d} days after the policy started. Illustrative threshold: ${SHORT_WINDOW_DAYS} days. Early claims are often valid; timing alone proves nothing.`, 'Genuine early loss happens. Waiting periods and policy terms decide validity, not this review.', 'Check application date disclosures and run the death-verification checklist if this is a death claim.', true, paid(r));
    }
  }

  // 6. Cover held over another person's life.
  for (const [holder, g] of by((r) => (r.policyholder_id && norm(r.policyholder_id) !== norm(r.insured_id) ? norm(r.policyholder_id) : ''))) {
    const lives = distinct(g.map((r) => norm(r.insured_id)));
    if (holder && lives >= 2) {
      add("Cover held over another person's life", g[0].policyholder_id || holder, g, `One fictional policyholder holds cover over ${lives} other lives. Policies on another person's life are common and lawful; concentrated holding is a review lead only.`, 'Family cover, employer key-person policies or lawful insurable interest.', 'Confirm insurable interest and consent for each policy; run the death-verification checklist on paid claims.', true, g.some(paid));
    }
  }

  // 7. Same insured identity paid on more than one claim.
  for (const [ins, g] of by((r) => norm(r.insured_id))) {
    const paidClaims = g.filter(paid);
    if (ins && paidClaims.length >= 2 && new Set(paidClaims.map((r) => norm(r.claim_ref))).size >= 2) {
      add('Same insured identity paid more than once', g[0].insured_name || ins, paidClaims, `One fictional insured identity was paid out on ${paidClaims.length} claims. A life is claimed once; repeats need a human check.`, 'Rider benefits or two genuine policies can both pay. Check whether both claims are death claims.', 'Verify the death once through Home Affairs, then reconcile every policy that paid.', true, true);
    }
  }

  // 8. Originator concentration.
  const paidRows = rows.filter(paid);
  for (const [agent, g] of by((r) => norm(r.agent))) {
    const agentPaid = g.filter(paid);
    if (agent && agentPaid.length >= AGENT_MIN_CLAIMS && agentPaid.length / Math.max(paidRows.length, 1) >= AGENT_MIN_SHARE) {
      add('Originator concentration', g[0].agent, agentPaid, `${agentPaid.length} of ${paidRows.length} paid fictional claims (${Math.round((agentPaid.length / paidRows.length) * 100)}%) came through one originator. Illustrative thresholds only.`, 'Book size, product mix and servicing changes can explain a large share.', 'Compare against the originator book and interview a sample of policyholders.', false, false);
    }
  }

  // 9. Service provider concentration (funeral parlour or doctor).
  for (const [field, label] of [['funeral_parlour', 'Funeral parlour across many claims'], ['doctor', 'Certifying doctor across many claims']] as const) {
    for (const [k, g] of by((r) => norm(r[field]))) {
      if (k && g.length >= PROVIDER_MIN_CLAIMS && distinct(g.map(householdOf)) >= PROVIDER_MIN_CLAIMS) {
        add(label, g[0][field], g, `One fictional ${field.replace('_', ' ')} appears on ${g.length} unrelated claims. Association is not wrongdoing.`, 'High service volume or a popular provider explains most concentrations.', 'Confirm each service directly with the provider using independently found contact details.', true, false);
      }
    }
  }

  // Post-payment recovery candidates: paid claims inside any finding, grouped by claimant.
  const flaggedRefs = new Map<ClaimRow, Set<string>>();
  const recoveryRefs = new Map<ClaimRow, Set<string>>();
  for (const f of findings) {
    for (const r of f.evidence_rows) {
      if (!flaggedRefs.has(r)) flaggedRefs.set(r, new Set());
      flaggedRefs.get(r)!.add(f.rule);
      if (f.tracing) {
        if (!recoveryRefs.has(r)) recoveryRefs.set(r, new Set());
        recoveryRefs.get(r)!.add(f.rule);
      }
    }
  }
  const candidates = new Map<string, { subject: string; claims: string[]; paid_zar: number; rules: Set<string> }>();
  for (const [r, rules] of recoveryRefs) {
    if (!paid(r)) continue;
    const key = norm(r.claimant_name) || 'unknown';
    if (!candidates.has(key)) candidates.set(key, { subject: r.claimant_name || 'Unknown claimant', claims: [], paid_zar: 0, rules: new Set() });
    const c = candidates.get(key)!;
    c.claims.push(r.claim_ref);
    c.paid_zar += parseAmount(r.amount_zar);
    for (const x of rules) c.rules.add(x);
  }
  const recovery_candidates = [...candidates.values()]
    .map((c) => ({
      ...c,
      rules: [...c.rules],
      paid_zar: Math.round(c.paid_zar * 100) / 100,
      suggested_next_step: 'Capture asset and tenure fields, then run the Recovery NRV triage before any legal spend. Trace first with the free sources below.',
    }))
    .sort((a, b) => b.paid_zar - a.paid_zar);

  const flaggedPaidRefs = new Set<string>();
  for (const [r] of flaggedRefs) if (paid(r)) flaggedPaidRefs.add(r.claim_ref);
  const flaggedPaidZar = Math.round(
    rows.filter((r) => flaggedPaidRefs.has(r.claim_ref)).reduce((t, r) => t + parseAmount(r.amount_zar), 0) * 100,
  ) / 100;

  const by_rule: Record<string, number> = {};
  for (const f of findings) by_rule[f.rule] = (by_rule[f.rule] ?? 0) + 1;

  return {
    summary: {
      claims_analysed: rows.length,
      paid_claims: paidRows.length,
      total_paid_zar: sumPaid(rows),
      flagged_claims: flaggedPaidRefs.size,
      flagged_paid_zar: flaggedPaidZar,
      findings_count: findings.length,
      by_rule,
    },
    findings,
    recovery_candidates,
    death_checklist: DEATH_VERIFICATION_CHECKLIST,
    tracing_sources: TRACING_SOURCES,
    limits: [
      'Leads, not proof. Every finding needs a human investigator before any decision.',
      'Amounts come from the supplied file only; no external data is joined.',
      'Thresholds are illustrative and not calibrated to any insurer book.',
      'Uploaded files are analysed in memory and discarded; nothing is stored.',
      'No automated recovery, contact or payment action is taken.',
    ],
  };
}

export function leakageRoutes() {
  const r = express.Router();
  r.get('/demo', (_req, res) => {
    res.json({ file_name: 'synthetic-6-month-claims-demo.csv', synthetic: true, ...analyseLeakage(demoCsv()) });
  });
  r.post('/analyse', (req, res) => {
    const csv = String(req.body?.csv ?? '');
    if (!csv.trim()) return res.status(400).json({ error: 'CSV text is required' });
    if (csv.length > 4_000_000) return res.status(413).json({ error: 'File too large for this preview (4 MB)' });
    try {
      res.json({ file_name: String(req.body?.file_name ?? 'uploaded.csv'), synthetic: false, ...analyseLeakage(csv) });
    } catch (e) {
      res.status(400).json({ error: 'Could not parse CSV: ' + (e as Error).message });
    }
  });
  return r;
}
