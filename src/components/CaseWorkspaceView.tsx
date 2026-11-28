// Constraint brief (refactoring-ui Workflow B, steps 1-3):
// Content ranking: PRIMARY = the case the investigator is working (header + active tab).
// SECONDARY = the ten workspace tabs. TERTIARY = the case switcher.
// One screen, one case: an investigator never leaves the case to understand a
// finding (28 Nov alignment review, SCREEN_28). The seven-point death matrix is
// a structured evidence table inside Identity & death, not a mandatory checklist:
// applicability follows verification policy, permissions and case circumstances.
// The Evidence Inspector opens contextually from any tab. Tokens: project scale
// only, two weights, three text colours; tabs scroll horizontally on phone.
import { InlineNavLink } from './InlineNavLink';
import React from 'react';
import type {
  AuditLogRecord,
  ClaimPreviewRecord,
  EvidenceItemRecord,
  HumanDecisionRecord,
  RoleId,
} from '../lib/engine/types';
import { evaluateClaimTimers } from '../lib/engine/timers';
import { CLAIM_AGENT_REGISTRY } from '../lib/engine/claimsAgents';
import { apiFetch, formatZar, ROLE_LABELS } from '../utils/format';
import type { NavRoute } from '../routes';

const REFERENCE_NOW_ISO = '2026-11-25T12:00:00Z';

type TabId =
  | 'overview'
  | 'timeline'
  | 'identity'
  | 'relationships'
  | 'geospatial'
  | 'telecom'
  | 'documents'
  | 'ai'
  | 'decisions'
  | 'audit';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Case overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'identity', label: 'Identity & death' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'geospatial', label: 'Geospatial evidence' },
  { id: 'telecom', label: 'SIM / RICA / bank' },
  { id: 'documents', label: 'Documents & evidence' },
  { id: 'ai', label: 'AI findings' },
  { id: 'decisions', label: 'Human decisions' },
  { id: 'audit', label: 'Audit history' },
];

// Tabs that read sensitive evidence; opening one writes a read-audit event.
const SENSITIVE_TABS: TabId[] = ['identity', 'telecom'];

interface EvidenceRecord {
  id: string;
  title: string;
  detail: string;
  state: 'Verified' | 'Pending' | 'Flagged' | 'Sealed' | 'Recorded';
  source: string;
  custody: string;
}

function stateTone(state: EvidenceRecord['state']): string {
  switch (state) {
    case 'Verified':
      return 'border-emerald-700 bg-emerald-950 text-emerald-300';
    case 'Flagged':
      return 'border-amber-700 bg-amber-950 text-amber-300';
    case 'Sealed':
      return 'border-sky-700 bg-sky-950 text-sky-300';
    default:
      return 'border-slate-600 bg-slate-800 text-slate-300';
  }
}

function claimFlags(claim: ClaimPreviewRecord): string[] {
  const flags: string[] = [];
  if (claim.avs_r_status === 'MISMATCH') flags.push('AVS-R bank verification mismatch');
  if (claim.agent_churn_flag) flags.push('Agent movement pattern');
  if (claim.living_person_signal) flags.push('Living-person signal');
  if (claim.dha_office_outlier) flags.push('DHA office outlier');
  if (claim.bi1663_box24_word_of_mouth) flags.push('BI-1663 box 24 word-of-mouth');
  if (flags.length === 0) flags.push('Deterministic sample review rule');
  return flags;
}

function deathMatrix(claim: ClaimPreviewRecord): Array<{ verification: string; state: 'Pending' | 'Verified'; material: string }> {
  return [
    {
      verification: 'DHA death record',
      state: claim.dha_office_outlier ? 'Pending' : 'Verified',
      material: claim.dha_office_outlier
        ? 'Registering office is an outlier for this cluster; confirm with the issuing office. Source reference recorded.'
        : 'Source reference recorded for the sample death registration.',
    },
    {
      verification: 'Biometric validation',
      state: claim.living_person_signal ? 'Pending' : 'Verified',
      material: claim.living_person_signal
        ? 'A living-person signal is open; corroborate identity independently before relying on this record.'
        : 'Authorised source record on file (sample).',
    },
    {
      verification: 'Funeral home',
      state: 'Verified',
      material: `Source and contact record on file for ${claim.parlour_name} (fictional parlour, sample).`,
    },
    {
      verification: 'Hospital information',
      state: 'Pending',
      material: 'Authorised record not yet attached in this sample case.',
    },
    {
      verification: 'Employer information',
      state: 'Pending',
      material: 'Authorised record not yet attached in this sample case.',
    },
    {
      verification: 'Other corroboration',
      state: 'Pending',
      material: claim.bi1663_box24_word_of_mouth
        ? 'BI-1663 box 24 indicates word-of-mouth notification; corroboration required. Source reference recorded.'
        : 'Source reference to be attached where the case circumstances require it.',
    },
    {
      verification: 'Human determination',
      state: 'Pending',
      material: 'A named reviewer records the determination. Never automated.',
    },
  ];
}

function timelineEvents(claim: ClaimPreviewRecord): Array<{ when: string; what: string }> {
  const submitted = Date.parse(claim.submitted_at);
  const events: Array<{ when: string; what: string }> = [];
  const inception = submitted - (claim.inception_to_death_days + claim.death_to_reg_days) * 86400000;
  const death = inception + claim.inception_to_death_days * 86400000;
  events.push({ when: new Date(inception).toISOString().slice(0, 10), what: 'Policy inception (sample record)' });
  events.push({ when: new Date(death).toISOString().slice(0, 10), what: 'Date of death per sample record' });
  events.push({ when: new Date(death + claim.death_to_reg_days * 86400000).toISOString().slice(0, 10), what: `Death registered ${claim.death_to_reg_days} days after death (sample)` });
  events.push({ when: claim.submitted_at.slice(0, 10), what: `Claim submitted for ${formatZar(claim.claim_amount)}` });
  if (claim.has_dispute_notice && claim.dispute_opened_at) {
    events.push({ when: claim.dispute_opened_at.slice(0, 10), what: `Dispute notice opened: ${claim.dispute_reason ?? 'reason recorded in case file'}` });
  }
  events.push({ when: '2026-11-25', what: `Flag raised for human review: ${claimFlags(claim)[0]}` });
  events.push({ when: 'Now', what: 'Awaiting a reasoned human decision' });
  return events;
}

export const CaseWorkspaceView: React.FC<{
  claims: ClaimPreviewRecord[];
  decisions: HumanDecisionRecord[];
  auditLog: AuditLogRecord[];
  evidenceItems: EvidenceItemRecord[];
  activeRole: RoleId;
  onNavigate: (route: NavRoute) => void;
}> = ({ claims, decisions, auditLog, evidenceItems, activeRole, onNavigate }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(claims[0]?.claim_id ?? null);
  const claim = claims.find((c) => c.claim_id === selectedId) ?? claims[0];
  const [tab, setTab] = React.useState<TabId>('overview');
  const [inspector, setInspector] = React.useState<EvidenceRecord | null>(null);

  React.useEffect(() => {
    if (!claim || !SENSITIVE_TABS.includes(tab)) return;
    apiFetch('/api/audit/view', activeRole, {
      method: 'POST',
      body: JSON.stringify({ view: `case-workspace/${claim.claim_id}/${tab}` }),
    }).catch(() => undefined);
  }, [tab, claim, activeRole]);

  if (!claim) {
    return (
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Case workspace</p>
        <h1 className="text-2xl font-semibold text-slate-100 mt-2">No sample cases</h1>
        <p className="text-sm text-slate-300 mt-2">No sample claims are loaded in this workspace.</p>
      </section>
    );
  }

  const timer = evaluateClaimTimers(claim, REFERENCE_NOW_ISO);
  const ageDays = Math.max(0, Math.round((Date.parse(REFERENCE_NOW_ISO) - Date.parse(claim.submitted_at)) / 86400000));
  const flags = claimFlags(claim);
  const caseDecisions = decisions.filter((d) => d.target_ref === claim.claim_id);
  const caseAudit = auditLog.filter((a) => a.object_id === claim.claim_id || String(a.object_id).includes(claim.claim_id));

  const openInspector = (record: EvidenceRecord) => setInspector(record);

  const Record: React.FC<{ record: EvidenceRecord }> = ({ record }) => (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-100 break-words">{record.title}</p>
        <p className="text-[13px] text-slate-300 mt-1 break-words">{record.detail}</p>
        <p className="text-xs text-slate-400 mt-1 break-words">{record.source}</p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateTone(record.state)}`}>{record.state}</span>
        <button
          type="button"
          className="rounded-md border border-slate-600 px-2.5 py-2 min-h-[36px] text-xs font-medium text-sky-300 hover:bg-slate-800 hover:border-sky-700 transition-colors"
          onClick={() => openInspector(record)}
          aria-label={`Inspect evidence: ${record.title}`}
        >
          Inspect
        </button>
      </div>
    </li>
  );

  const telecomRecords: EvidenceRecord[] = [
    {
      id: 'avs',
      title: `Bank account verification (AVS-R): ${claim.avs_r_status}`,
      detail:
        claim.avs_r_status === 'MISMATCH'
          ? 'The beneficiary bank account verification returned a mismatch. A changed account or spelling variant can produce the same result.'
          : claim.avs_r_status === 'UNVERIFIED'
            ? 'The beneficiary bank account has not been verified yet.'
            : 'The beneficiary bank account verified against the sample reference.',
      state: claim.avs_r_status === 'MISMATCH' ? 'Flagged' : claim.avs_r_status === 'UNVERIFIED' ? 'Pending' : 'Verified',
      source: 'Source: simulated bank verification response (sample, never a live bank call).',
      custody: 'Response held in the sample evidence store with hash and received time.',
    },
    {
      id: 'rica',
      title: 'RICA registration record',
      detail: 'The claimant contact number has a sample RICA registration record consistent with the declared identity.',
      state: 'Verified',
      source: 'Source: simulated RICA reference (sample).',
      custody: 'Reference sealed in the sample evidence store.',
    },
    {
      id: 'simswap',
      title: 'SIM-swap signal',
      detail: claim.living_person_signal
        ? 'A SIM-swap event within the claim window is part of the living-person signal cluster. Stale or mis-matched records can produce the same signal.'
        : 'No SIM-swap event inside the claim window in this sample record.',
      state: claim.living_person_signal ? 'Flagged' : 'Verified',
      source: 'Source: simulated network event feed (sample).',
      custody: 'Event record sealed with received time.',
    },
  ];

  const relationshipRecords: EvidenceRecord[] = [
    { id: 'insured', title: `Insured person: ${claim.deceased_alias}`, detail: 'Deceased alias used throughout this sample workspace. Never a real person.', state: 'Recorded', source: 'Source: sample claim record.', custody: 'Sample store.' },
    { id: 'parlour', title: `Funeral parlour: ${claim.parlour_name}`, detail: claim.voluntary_parlour_elected ? 'Voluntarily elected by the claimant on the claim form.' : 'Not voluntarily elected; appears on the claim paperwork.', state: claim.voluntary_parlour_elected ? 'Recorded' : 'Pending', source: 'Source: sample claim form.', custody: 'Sample store.' },
    {
      id: 'certifier',
      title: claim.certifier_cluster_id ? `Certifier cluster: ${claim.certifier_cluster_id}` : 'Certifier: no cluster link',
      detail: claim.certifier_cluster_id
        ? 'The certifying doctor appears in a sample cluster with other claims. A cluster is a lead, not a finding.'
        : 'The certifier does not appear in any sample cluster.',
      state: claim.certifier_cluster_id ? 'Flagged' : 'Recorded',
      source: 'Source: sample cross-claim matching.',
      custody: 'Deterministic sample match record.',
    },
    {
      id: 'agent',
      title: 'Writing agent',
      detail: claim.agent_churn_flag
        ? 'The writing agent shows an unusual movement pattern across this sample book. Legitimate agents change employers; verify the mandate.'
        : 'No movement flag on the writing agent in this sample book.',
      state: claim.agent_churn_flag ? 'Flagged' : 'Recorded',
      source: 'Source: sample policy servicing history.',
      custody: 'Sample store.',
    },
  ];

  const geoRecords: EvidenceRecord[] = [
    {
      id: 'dha-office',
      title: 'Registering DHA office',
      detail: claim.dha_office_outlier
        ? 'The registering office is a statistical outlier for this sample cluster. Rural registration patterns can legitimately cluster by office.'
        : 'The registering office sits inside the expected sample cluster.',
      state: claim.dha_office_outlier ? 'Flagged' : 'Verified',
      source: 'Source: sample geospatial cluster analysis.',
      custody: 'Analysis record with rule version.',
    },
    {
      id: 'address',
      title: 'Claimant physical address',
      detail: 'Address on the sample claim form. Check it against the maps address checker before any field visit.',
      state: 'Pending',
      source: 'Source: sample claim form.',
      custody: 'Sample store.',
    },
  ];

  const docRecords: EvidenceRecord[] = [
    { id: 'bi1663', title: 'BI-1663 death notification', detail: claim.bi1663_box24_word_of_mouth ? 'Box 24 indicates word-of-mouth notification; corroboration required.' : 'No box 24 word-of-mouth flag on the sample form.', state: claim.bi1663_box24_word_of_mouth ? 'Flagged' : 'Sealed', source: `Reference SYN-DOC-${claim.claim_id.replace(/\D/g, '').slice(-3) || '000'} (sample).`, custody: 'Sealed in the sample evidence vault with hash.' },
    { id: 'claim-form', title: 'Claim form', detail: 'Submitted claim form with declared beneficiary and bank details.', state: 'Sealed', source: 'Source: sample intake.', custody: 'Sealed with received time.' },
    { id: 'bank', title: 'Bank detail record', detail: `AVS-R outcome: ${claim.avs_r_status}.`, state: claim.avs_r_status === 'MISMATCH' ? 'Flagged' : 'Sealed', source: 'Source: simulated verification response.', custody: 'Sealed with received time.' },
  ];

  const aiFindings: EvidenceRecord[] = flags.map((flag, i) => ({
    id: `ai-${i}`,
    title: flag,
    detail:
      i === 0
        ? 'Raised by a deterministic sample rule and routed to a specialist agent for evidence assembly. This is a lead with supporting material, not a conclusion.'
        : 'Supporting signal assembled by the specialist agent. Read the innocent explanation before relying on it.',
    state: 'Flagged',
    source: `Agent: ${CLAIM_AGENT_REGISTRY[Math.min(i + 1, CLAIM_AGENT_REGISTRY.length - 1)].name} (sample run).`,
    custody: 'Run record with inputs, tools, sources and limitations held in the AI workforce console.',
  }));

  return (
    <section aria-label="Case workspace">
      {/* Case header */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-widest uppercase text-slate-400">Case workspace · Human decision required</p>
            <h1 className="text-2xl font-semibold text-slate-100 mt-2 break-words">{claim.claim_id} · Synthetic example</h1>
            <p className="text-sm text-slate-300 mt-1">Claim investigation · Forensic review</p>
          </div>
          <label className="text-xs text-slate-400">
            Case
            <select
              className="ml-2 rounded border border-slate-600 bg-slate-800 text-slate-100 px-2 py-1 text-sm"
              value={claim.claim_id}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Choose sample case"
            >
              {claims.map((c) => (
                <option key={c.claim_id} value={c.claim_id}>{c.claim_id}</option>
              ))}
            </select>
          </label>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="min-w-0"><dt className="text-xs text-slate-400">Case status</dt><dd className="text-sm font-semibold text-slate-100 mt-0.5">Under investigation</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-400">Assigned investigator</dt><dd className="text-sm font-semibold text-slate-100 mt-0.5 break-words">{ROLE_LABELS[activeRole]} (sample view)</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-400">Claim value</dt><dd className="text-xl font-semibold text-slate-100 mt-0.5 break-words">{formatZar(claim.claim_amount)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-slate-400">Age</dt><dd className="text-xl font-semibold text-slate-100 mt-0.5">{ageDays} days</dd></div>
        </dl>
        <p className="text-xs text-slate-400 mt-3 break-words">Regulatory clock: {timer.clock_label}. Sample claim; never a real person, payout or insurer.</p>
      </div>

      {/* Tabs */}
      <div className="mt-4 -mx-1 overflow-x-auto" role="tablist" aria-label="Case workspace tabs">
        <div className="flex gap-1 px-1 min-w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`rounded-lg border px-3 py-2 text-[13px] font-semibold whitespace-nowrap ${
                tab === t.id ? 'border-emerald-500 bg-slate-800 text-slate-100' : 'border-slate-700 bg-transparent text-slate-400'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-slate-100">Why this case is open</h2>
              <ul className="mt-2 space-y-1">
                {flags.map((f) => (
                  <li key={f} className="text-[13px] text-slate-300">· {f}</li>
                ))}
              </ul>
              <p className="text-[13px] text-slate-400 mt-3">Flags are leads, not findings. The innocent explanation and supporting material sit on the relevant tabs.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0"><dt className="text-xs text-slate-400">Policy</dt><dd className="text-sm font-semibold text-slate-100 mt-1 break-words">{claim.policy_ref}</dd></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0"><dt className="text-xs text-slate-400">Inception to death</dt><dd className="text-sm font-semibold text-slate-100 mt-1">{claim.inception_to_death_days} days</dd></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0"><dt className="text-xs text-slate-400">Death to registration</dt><dd className="text-sm font-semibold text-slate-100 mt-1">{claim.death_to_reg_days} days</dd></div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0"><dt className="text-xs text-slate-400">Status</dt><dd className="text-sm font-semibold text-slate-100 mt-1 break-words">{claim.status}</dd></div>
            </dl>
          </div>
        )}

        {tab === 'timeline' && (
          <ol className="space-y-2">
            {timelineEvents(claim).map((e, i) => (
              <li key={i} className="flex gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
                <span className="text-xs text-slate-400 w-20 shrink-0 pt-0.5">{e.when}</span>
                <span className="text-[13px] text-slate-200 break-words">{e.what}</span>
              </li>
            ))}
          </ol>
        )}

        {tab === 'identity' && (
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Seven-point death corroboration</h2>
            <p className="text-xs text-slate-400 mt-1">Applicability is set by the verification policy, data access permissions and the circumstances of this case. These are not seven mandatory sources in every case.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px] min-w-[420px]">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-3 font-semibold">Verification</th>
                    <th className="py-2 pr-3 font-semibold">State</th>
                    <th className="py-2 font-semibold">Supporting material</th>
                  </tr>
                </thead>
                <tbody>
                  {deathMatrix(claim).map((row) => (
                    <tr key={row.verification} className="border-b border-slate-800 align-top">
                      <td className="py-2 pr-3 text-slate-100 font-semibold">{row.verification}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${row.state === 'Verified' ? 'border-emerald-700 bg-emerald-950 text-emerald-300' : 'border-slate-600 bg-slate-800 text-slate-300'}`}>{row.state}</span>
                      </td>
                      <td className="py-2 text-slate-300">{row.material}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'relationships' && (
          <ul className="space-y-2">
            {relationshipRecords.map((r) => <Record key={r.id} record={r} />)}
            <li className="text-xs text-slate-400 pt-1">Full fictional entity graph: <InlineNavLink onClick={() => onNavigate('/network')}>open Relationships</InlineNavLink>.</li>
          </ul>
        )}

        {tab === 'geospatial' && (
          <ul className="space-y-2">
            {geoRecords.map((r) => <Record key={r.id} record={r} />)}
            <li className="text-xs text-slate-400 pt-1">Physical address checking: <a className="font-medium text-sky-400 underline decoration-sky-500/40 underline-offset-2 rounded-sm transition-colors hover:text-sky-300 hover:decoration-sky-300" href="/map-preview">open the maps checker</a>.</li>
          </ul>
        )}

        {tab === 'telecom' && (
          <ul className="space-y-2">{telecomRecords.map((r) => <Record key={r.id} record={r} />)}</ul>
        )}

        {tab === 'documents' && (
          <ul className="space-y-2">
            {docRecords.map((r) => <Record key={r.id} record={r} />)}
            <li className="text-xs text-slate-400 pt-1">Full custody history: <InlineNavLink onClick={() => onNavigate('/vault')}>open the evidence vault</InlineNavLink>. {evidenceItems.length} evidence items sit in this sample workspace.</li>
          </ul>
        )}

        {tab === 'ai' && (
          <ul className="space-y-2">
            {aiFindings.map((r) => <Record key={r.id} record={r} />)}
            <li className="text-xs text-slate-400 pt-1">Run detail, inputs, tools and limitations: <InlineNavLink onClick={() => onNavigate('/workforce')}>open the AI workforce console</InlineNavLink>.</li>
          </ul>
        )}

        {tab === 'decisions' && (
          <div className="space-y-2">
            {caseDecisions.length === 0 ? (
              <p className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-[13px] text-slate-300">No human decisions recorded on this case yet. Decisions are recorded in <InlineNavLink onClick={() => onNavigate('/needs-ok')}>Needs Your OK</InlineNavLink> after the five-step inspection sequence.</p>
            ) : (
              caseDecisions.map((d) => (
                <div key={d.decision_id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                  <p className="text-sm font-semibold text-slate-100 break-words">{d.selected_action}</p>
                  <p className="text-[13px] text-slate-300 mt-1 break-words">{d.counsel_note ?? d.objective_reasons.join(', ')}</p>
                  <p className="text-xs text-slate-400 mt-1 break-words">Receipt {d.decision_id} · {d.reviewer_role}</p>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div className="space-y-2">
            {caseAudit.length === 0 ? (
              <p className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-[13px] text-slate-300">No audit events are recorded against this case yet in this sample workspace. Opening the Identity &amp; death or SIM / RICA / bank tab writes a read-audit event.</p>
            ) : (
              caseAudit.slice(0, 20).map((a, i) => (
                <div key={i} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                  <p className="text-[13px] text-slate-100 break-words">{a.action}</p>
                  <p className="text-xs text-slate-400 mt-1 break-words">{a.actor_role} · {a.object_type} {a.object_id}</p>
                </div>
              ))
            )}
            <p className="text-xs text-slate-400">Full audit trail: <InlineNavLink onClick={() => onNavigate('/compliance')}>open Audit &amp; assurance</InlineNavLink>.</p>
          </div>
        )}
      </div>

      {/* Evidence Inspector: contextual on every tab */}
      {inspector && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3" role="dialog" aria-label="Evidence inspector" onClick={() => setInspector(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100 break-words min-w-0">{inspector.title}</h2>
              <button className="text-slate-400 text-lg leading-none shrink-0" onClick={() => setInspector(null)} aria-label="Close evidence inspector">×</button>
            </div>
            <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold mt-2 ${stateTone(inspector.state)}`}>{inspector.state}</span>
            <p className="text-[13px] text-slate-200 mt-3 break-words">{inspector.detail}</p>
            <p className="text-xs text-slate-400 mt-3 break-words">{inspector.source}</p>
            <p className="text-xs text-slate-400 mt-1 break-words">Custody: {inspector.custody}</p>
            <p className="text-xs text-slate-500 mt-3">Sample evidence. Integrity of the record does not establish the truth of its content.</p>
          </div>
        </div>
      )}
    </section>
  );
};
