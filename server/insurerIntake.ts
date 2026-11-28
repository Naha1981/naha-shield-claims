import express from 'express';
import {
  BUILT_IN_PROFILES,
  getProfile,
  normaliseProfile,
  validateProfile,
  type InsurerProfile,
} from '../src/lib/engine/insurerProfiles';
import {
  ConnectorError,
  handleWebhookPayload,
  pullClaims,
  pullClaimsFile,
  testConnection,
  type ConnectorPullResult,
} from './insurerConnector';
import { ingestClaimRows } from '../src/lib/engine/claimsFileIngest';
import { analyseRows } from '../src/lib/engine/leakageEngine';
import { documentToRows } from './documentClaimsParse';

// Insurer intake: file drops (CSV, Excel, PDF, scans), REST pulls, webhook
// pushes and connection tests, all driven by connector profiles. Every event
// is logged in plain language WITHOUT personal data: counts, rands and status
// only, never names, references or account numbers.

export type IntakeEvent = {
  at: string;
  kind: 'file' | 'api-pull' | 'webhook' | 'test-connection';
  source: string; // profile label or file extension, never a file name
  status: 'ok' | 'error';
  claims: number;
  findings: number;
  flagged_zar: number;
  message: string;
};

const intakeLog: IntakeEvent[] = [];
const MAX_LOG = 100;

export function logIntakeEvent(e: Omit<IntakeEvent, 'at'>): void {
  intakeLog.unshift({ at: new Date().toISOString(), ...e });
  if (intakeLog.length > MAX_LOG) intakeLog.length = MAX_LOG;
}

export function getIntakeLog(): IntakeEvent[] {
  return [...intakeLog];
}

// Custom profiles added at runtime (in-memory; a restart returns to the
// built-ins). A profile is configuration, not code.
const customProfiles: InsurerProfile[] = [];

function resolveProfile(body: { profile_id?: string; profile?: unknown }): InsurerProfile | null {
  if (body?.profile && typeof body.profile === 'object') {
    const problems = validateProfile(body.profile);
    if (problems.length) throw new ConnectorError('Connector settings need fixing: ' + problems.join(' '));
    return normaliseProfile(body.profile as InsurerProfile);
  }
  const id = String(body?.profile_id ?? 'generic');
  return getProfile(id, customProfiles);
}

function resultPayload(result: ConnectorPullResult, sourceLabel: string, synthetic: boolean, format: string) {
  return {
    file_name: sourceLabel,
    synthetic,
    format,
    ingest_report: result.report,
    pages_read: result.pages_read,
    ...result.analysis,
  };
}

// ---- Mock insurer feeds (fully sample) proving the profiles work. ----

function mockLibertyClaims(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(3, '0');
    rows.push({
      claimNumber: `LIB-SYN-${n}`,
      policyNumber: `LPOL-SYN-${n}`,
      lifeAssured: `Fictional life ${n}`,
      insuredIdNumber: `LID-SYN-${n}`,
      claimant: `Fictional claimant ${n}`,
      beneficiary: `Fictional beneficiary ${n}`,
      payoutAccount: `LACC-SYN-${n}`,
      contactNumber: `LPH-SYN-${n}`,
      certificateNumber: `LCERT-SYN-${n}`,
      funeralDirector: `Fictional Parlour ${n}`,
      certifyingDoctor: `Fictional Dr ${n}`,
      adviserCode: i > 8 ? 'ADV-SYN-R' : `ADV-SYN-${i % 3}`,
      paidAmount: 120000 + i * 8000,
      lossDate: `2026-${String(6 + (i % 6)).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      policyStartDate: `2024-0${(i % 9) + 1}-15`,
      claimStatus: i === 5 ? 'declined' : 'paid',
    });
  }
  // Duplicate payment and a shared account so the mock proves findings.
  rows.push(
    { claimNumber: 'LIB-SYN-013', policyNumber: 'LPOL-SYN-013', lifeAssured: 'Fictional life 013', insuredIdNumber: 'LID-SYN-013', claimant: 'Fictional claimant 013', beneficiary: 'Fictional beneficiary 013', payoutAccount: 'LACC-SYN-013', contactNumber: 'LPH-SYN-013', certificateNumber: 'LCERT-SYN-013', funeralDirector: 'Fictional Parlour A', certifyingDoctor: 'Fictional Dr A', adviserCode: 'ADV-SYN-1', paidAmount: 250000, lossDate: '2026-10-05', policyStartDate: '2024-01-20', claimStatus: 'paid' },
    { claimNumber: 'LIB-SYN-013', policyNumber: 'LPOL-SYN-013', lifeAssured: 'Fictional life 013', insuredIdNumber: 'LID-SYN-013', claimant: 'Fictional claimant 013', beneficiary: 'Fictional beneficiary 013', payoutAccount: 'LACC-SYN-013', contactNumber: 'LPH-SYN-013', certificateNumber: 'LCERT-SYN-013', funeralDirector: 'Fictional Parlour A', certifyingDoctor: 'Fictional Dr A', adviserCode: 'ADV-SYN-1', paidAmount: 250000, lossDate: '2026-10-06', policyStartDate: '2024-01-20', claimStatus: 'paid' },
    { claimNumber: 'LIB-SYN-014', policyNumber: 'LPOL-SYN-014', lifeAssured: 'Fictional life 014', insuredIdNumber: 'LID-SYN-014', claimant: 'Fictional claimant 014', beneficiary: 'Fictional beneficiary 014', payoutAccount: 'LACC-SYN-MULE', contactNumber: 'LPH-SYN-014', certificateNumber: 'LCERT-SYN-014', funeralDirector: 'Fictional Parlour B', certifyingDoctor: 'Fictional Dr B', adviserCode: 'ADV-SYN-2', paidAmount: 180000, lossDate: '2026-08-14', policyStartDate: '2023-06-01', claimStatus: 'paid' },
    { claimNumber: 'LIB-SYN-015', policyNumber: 'LPOL-SYN-015', lifeAssured: 'Fictional life 015', insuredIdNumber: 'LID-SYN-015', claimant: 'Fictional claimant 015', beneficiary: 'Fictional beneficiary 015', payoutAccount: 'LACC-SYN-MULE', contactNumber: 'LPH-SYN-015', certificateNumber: 'LCERT-SYN-015', funeralDirector: 'Fictional Parlour C', certifyingDoctor: 'Fictional Dr C', adviserCode: 'ADV-SYN-1', paidAmount: 199000, lossDate: '2026-10-30', policyStartDate: '2022-11-19', claimStatus: 'paid' },
  );
  return rows;
}

function mockMomentumClaims(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(3, '0');
    rows.push({
      ClaimReference: `MOM-SYN-${n}`,
      PolicyRef: `MPOL-SYN-${n}`,
      DeceasedName: `Fictional life ${n}`,
      InsuredId: `MID-SYN-${n}`,
      ClaimantName: `Fictional claimant ${n}`,
      BeneficiaryName: `Fictional beneficiary ${n}`,
      BankAccountNumber: `MACC-SYN-${n}`,
      CellphoneNumber: `MPH-SYN-${n}`,
      DeathCertificateNo: i >= 8 ? 'MCERT-SYN-REUSED' : `MCERT-SYN-${n}`,
      FuneralParlour: `Fictional Parlour ${n}`,
      DoctorName: `Fictional Dr ${n}`,
      BrokerCode: `BRK-SYN-${i % 4}`,
      AmountPaid: `${130000 + i * 9000}.00`,
      DateOfLoss: `${String((i % 28) + 1).padStart(2, '0')}/${String(6 + (i % 6)).padStart(2, '0')}/2026`,
      InceptionDate: `2024-${String((i % 9) + 1).padStart(2, '0')}-15`,
      Status: 'Paid',
    });
  }
  // Three claims reusing one certificate number.
  rows.push(
    { ClaimReference: 'MOM-SYN-011', PolicyRef: 'MPOL-SYN-011', DeceasedName: 'Fictional life 011', InsuredId: 'MID-SYN-011', ClaimantName: 'Fictional claimant 011', BeneficiaryName: 'Fictional beneficiary 011', BankAccountNumber: 'MACC-SYN-011', CellphoneNumber: 'MPH-SYN-011', DeathCertificateNo: 'MCERT-SYN-REUSED', FuneralParlour: 'Fictional Parlour A', DoctorName: 'Fictional Dr A', BrokerCode: 'BRK-SYN-1', AmountPaid: '150000.00', DateOfLoss: '25/08/2026', InceptionDate: '2024-05-05', Status: 'Paid' },
    { ClaimReference: 'MOM-SYN-012', PolicyRef: 'MPOL-SYN-012', DeceasedName: 'Fictional life 012', InsuredId: 'MID-SYN-012', ClaimantName: 'Fictional claimant 012', BeneficiaryName: 'Fictional beneficiary 012', BankAccountNumber: 'MACC-SYN-012', CellphoneNumber: 'MPH-SYN-012', DeathCertificateNo: 'MCERT-SYN-REUSED', FuneralParlour: 'Fictional Parlour B', DoctorName: 'Fictional Dr B', BrokerCode: 'BRK-SYN-2', AmountPaid: '175000.00', DateOfLoss: '29/09/2026', InceptionDate: '2024-07-07', Status: 'Paid' },
  );
  return rows;
}

function mockGenericClaims(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(3, '0');
    rows.push({
      'Claim No': `GEN-SYN-${n}`,
      'Policy #': `GPOL-SYN-${n}`,
      'Deceased Name': `Fictional life ${n}`,
      'Claimant Full Name': `Fictional claimant ${n}`,
      Beneficiary: `Fictional beneficiary ${n}`,
      'Acc No': `GACC-SYN-${n}`,
      Cell: `GPH-SYN-${n}`,
      'Death Certificate No': `GCERT-SYN-${n}`,
      Broker: `Fictional Broker ${i % 3}`,
      'Amount Paid (R)': `R ${140000 + i * 6000}`,
      'Date of Loss': `2026-${String(6 + (i % 6)).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      'Policy Start': `2024-0${(i % 9) + 1}-15`,
      'Claim Status': 'Paid',
    });
  }
  rows.push({
    'Claim No': 'GEN-SYN-011', 'Policy #': 'GPOL-SYN-011', 'Deceased Name': 'Fictional life 011', 'Claimant Full Name': 'Fictional claimant 011', Beneficiary: 'Fictional beneficiary 011', 'Acc No': 'GACC-SYN-011', Cell: 'GPH-SYN-011', 'Death Certificate No': 'GCERT-SYN-011', Broker: 'Fictional Broker 1', 'Amount Paid (R)': 'R 300 000', 'Date of Loss': '2026-10-05', 'Policy Start': '2026-08-01', 'Claim Status': 'Paid',
  });
  return rows;
}

const MOCK_FEEDS: Record<string, (page: number, size: number) => { key: string; rows: Array<Record<string, unknown>>; total: number }> = {
  liberty: (page, size) => {
    const all = mockLibertyClaims();
    return { key: 'claims', rows: all.slice((page - 1) * size, page * size), total: all.length };
  },
  momentum: (page, size) => {
    const all = mockMomentumClaims();
    return { key: 'data', rows: all.slice((page - 1) * size, page * size), total: all.length };
  },
  generic: (page, size) => {
    const all = mockGenericClaims();
    return { key: '', rows: all.slice((page - 1) * size, page * size), total: all.length };
  },
};

const MAX_FILE_BASE64_CHARS = 14_000_000;

// Real insurer data only moves once sign-in is ON and Thabiso agrees. Mock
// feeds stay open in every mode so connectors can always be proven first.
function realDataGate(baseUrl: string): { ok: true } | { ok: false; message: string } {
  if (/\/mock-insurer\//.test(baseUrl)) return { ok: true };
  if (process.env.NAHASHIELD_LOGIN === 'on') return { ok: true }; // auth enforced by the global middleware
  return { ok: false, message: 'Sign-in is OFF. Real insurer data only comes in once the login switch is ON and Thabiso agrees. Test with the mock feed.' };
}

export function intakeRoutes() {
  const r = express.Router();

  r.get('/profiles', (_req, res) => {
    res.json({
      profiles: [...BUILT_IN_PROFILES, ...customProfiles].map((p) => ({
        id: p.id,
        label: p.label,
        insurer: p.insurer,
        protocol: p.protocol,
        status: p.status,
        auth_type: p.auth.type,
        paging: p.paging.style,
        schedule: p.schedule,
        webhook_path: `/api/intake/webhook/${p.id}`,
        webhook_secret_configured: Boolean(process.env[p.webhook_secret_env]),
        notes: p.notes,
        custom: !BUILT_IN_PROFILES.some((b) => b.id === p.id),
      })),
    });
  });

  r.post('/profiles', (req, res) => {
    const problems = validateProfile(req.body?.profile);
    if (problems.length) return res.status(400).json({ error: problems.join(' ') });
    const profile = normaliseProfile(req.body.profile as InsurerProfile);
    if (getProfile(profile.id, customProfiles)) {
      return res.status(409).json({ error: `A connector with id "${profile.id}" already exists.` });
    }
    customProfiles.push(profile);
    logIntakeEvent({ kind: 'api-pull', source: profile.label, status: 'ok', claims: 0, findings: 0, flagged_zar: 0, message: `Connector "${profile.label}" added by configuration.` });
    res.status(201).json({ ok: true, profile_id: profile.id });
  });

  r.get('/log', (_req, res) => {
    res.json({ events: getIntakeLog(), note: 'Counts and rands only: no names, claim numbers or account details are logged.' });
  });

  r.post('/test-connection', async (req, res) => {
    let profile: InsurerProfile | null = null;
    try {
      profile = resolveProfile(req.body ?? {});
      if (!profile) return res.status(404).json({ error: 'Unknown connector profile.' });
      const baseUrl = String(req.body?.base_url ?? '');
      const gate = realDataGate(baseUrl);
      if (!gate.ok) return res.status(403).json({ error: gate.message });
      const result = await testConnection(profile, baseUrl);
      logIntakeEvent({ kind: 'test-connection', source: profile.label, status: result.ok ? 'ok' : 'error', claims: 0, findings: 0, flagged_zar: 0, message: result.message });
      res.json(result);
    } catch (e) {
      const message = e instanceof ConnectorError ? e.plain : (e as Error).message;
      if (profile) logIntakeEvent({ kind: 'test-connection', source: profile.label, status: 'error', claims: 0, findings: 0, flagged_zar: 0, message });
      res.status(400).json({ error: message });
    }
  });

  r.post('/fetch', async (req, res) => {
    let profile: InsurerProfile | null = null;
    try {
      profile = resolveProfile(req.body ?? {});
      if (!profile) return res.status(404).json({ error: 'Unknown connector profile.' });
      const baseUrl = String(req.body?.base_url ?? '');
      const gate = realDataGate(baseUrl);
      if (!gate.ok) return res.status(403).json({ error: gate.message });
      const result = profile.protocol === 'file_url'
        ? await pullClaimsFile(profile, baseUrl)
        : await pullClaims(profile, baseUrl);
      const sample = /mock-insurer/.test(baseUrl);
      logIntakeEvent({
        kind: 'api-pull',
        source: profile.label,
        status: 'ok',
        claims: result.report.rows_used,
        findings: result.analysis.summary.findings_count,
        flagged_zar: result.analysis.summary.flagged_paid_zar,
        message: `Pulled ${result.report.rows_used} claims in ${result.pages_read} page(s) from ${profile.label}.`,
      });
      res.json(resultPayload(result, `${profile.label} API`, sample, profile.protocol));
    } catch (e) {
      const message = e instanceof ConnectorError ? e.plain : (e as Error).message;
      if (profile) logIntakeEvent({ kind: 'api-pull', source: profile.label, status: 'error', claims: 0, findings: 0, flagged_zar: 0, message });
      res.status(400).json({ error: message });
    }
  });

  r.post('/webhook/:profileId', (req, res) => {
    const profile = getProfile(String(req.params.profileId), customProfiles);
    if (!profile) return res.status(404).json({ error: 'Unknown connector profile.' });
    const expectedSecret = process.env[profile.webhook_secret_env];
    if (process.env.NAHASHIELD_LOGIN === 'on' && !expectedSecret) {
      return res.status(503).json({ error: 'Sign-in is ON but this connector has no webhook secret configured. Set the secret env var before receiving real pushes.' });
    }
    if (expectedSecret) {
      const got = String(req.headers['x-webhook-secret'] ?? '');
      if (got !== expectedSecret) {
        logIntakeEvent({ kind: 'webhook', source: profile.label, status: 'error', claims: 0, findings: 0, flagged_zar: 0, message: 'Webhook rejected: wrong or missing secret.' });
        return res.status(401).json({ error: 'Webhook secret missing or wrong.' });
      }
    }
    try {
      const result = handleWebhookPayload(profile, req.body);
      logIntakeEvent({
        kind: 'webhook',
        source: profile.label,
        status: 'ok',
        claims: result.report.rows_used,
        findings: result.analysis.summary.findings_count,
        flagged_zar: result.analysis.summary.flagged_paid_zar,
        message: `Webhook push: ${result.report.rows_used} claim(s) received${expectedSecret ? '' : ' (no secret configured: sample mode)'}.`,
      });
      res.json(resultPayload(result, `${profile.label} webhook`, false, 'webhook'));
    } catch (e) {
      const message = (e as Error).message;
      logIntakeEvent({ kind: 'webhook', source: profile.label, status: 'error', claims: 0, findings: 0, flagged_zar: 0, message });
      res.status(400).json({ error: message });
    }
  });

  r.post('/file', async (req, res) => {
    const fileName = String(req.body?.file_name ?? 'document');
    const b64 = String(req.body?.content_base64 ?? '');
    const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'file').toLowerCase();
    if (!b64) return res.status(400).json({ error: 'File content is required' });
    if (b64.length > MAX_FILE_BASE64_CHARS) return res.status(413).json({ error: 'File too large (10 MB)' });
    try {
      const buffer = Buffer.from(b64, 'base64');
      const parsed = await documentToRows(buffer, fileName);
      const { rows, report } = ingestClaimRows(parsed.headers, parsed.rows, fileName);
      const analysis = analyseRows(rows);
      logIntakeEvent({
        kind: 'file',
        source: `${ext.toUpperCase()} (${parsed.pages_or_engine})`,
        status: 'ok',
        claims: report.rows_used,
        findings: analysis.summary.findings_count,
        flagged_zar: analysis.summary.flagged_paid_zar,
        message: `Document read: ${report.rows_used} claims via ${parsed.pages_or_engine}.`,
      });
      res.json({ file_name: fileName, synthetic: false, format: parsed.kind, ingest_report: report, ...analysis });
    } catch (e) {
      const message = (e as Error).message;
      logIntakeEvent({ kind: 'file', source: ext.toUpperCase(), status: 'error', claims: 0, findings: 0, flagged_zar: 0, message });
      res.status(400).json({ error: message });
    }
  });

  // Mock insurer feeds, fully sample, so every profile can be tested with
  // no live connection: point base_url at <origin>/api/mock-insurer/<id>.
  const mockRouter = express.Router();
  mockRouter.get('/:profileId/claims', (req, res) => {
    const feed = MOCK_FEEDS[String(req.params.profileId)];
    if (!feed) return res.status(404).json({ error: 'No mock feed for this profile. Available: liberty, momentum, generic.' });
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const size = Math.min(1000, Math.max(1, Number(req.query.pageSize ?? req.query.limit ?? 500) || 500));
    const effectivePage = req.query.offset != null ? Math.floor(offset / size) + 1 : page;
    const batch = feed(effectivePage, size);
    const body: Record<string, unknown> = { total: batch.total, synthetic: true };
    if (batch.key) body[batch.key] = batch.rows;
    else Object.assign(body, {});
    res.json(batch.key ? body : batch.rows);
  });

  return { router: r, mockRouter };
}
