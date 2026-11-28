import {RelationshipGraph} from './components/RelationshipGraph';
import {BootSplash} from './components/BootSplash';
import {RetrospectiveLeakageView} from './components/RetrospectiveLeakageView';
import {IntakeView} from './components/IntakeView';
import {InvestigatorView} from './components/InvestigatorView';
import {WorkedCaseLanding} from './pages/WorkedCaseLanding';
import {WorkedCaseDetailPage} from './pages/WorkedCaseDetailPage';
import { SYNTHETIC_RECOVERY_CASES } from '../db/seeds/syntheticData';
import './network.css';
import {WorkforceView} from './components/WorkforceView';
import{WorkforceTabs}from'./components/WorkforceTabs';
import React from 'react';
import { LayoutShell, type NavRoute } from './components/LayoutShell';
import { OverviewLedgerView } from './components/OverviewLedgerView';
import { RecoveryDeskView } from './components/RecoveryDeskView';
import { EvidenceVaultView } from './components/EvidenceVaultView';
import { ConsentDeskView } from './components/ConsentDeskView';
import { ClaimsPreviewView } from './components/ClaimsPreviewView';
import { ComplianceAuditView } from './components/ComplianceAuditView';
import type {
  AuditLogRecord,
  ClaimAgentProposalRecord,
  ClaimAgentRunRecord,
  ClaimPreviewRecord,
  ConsentPolicyInput,
  EvidenceItemRecord,
  HumanDecisionRecord,
  KpiAuditNoteRecord,
  LedgerEntryInput,
  RecoveryCaseInput,
  RoleId,
  VaultVerificationResult,
} from './lib/engine/types';
import type { AnomalyAlertRecord } from './lib/engine/anomaly';
import type { LedgerApprovalWorkflowRecord } from './lib/engine/approvalWorkflow';
import type {
  ApplyDigitalSignaturePayload,
  ApplyDigitalSignatureResult,
} from './components/StakeholderApprovalWorkflow';
import type { SimulatedAdapterMeta } from './lib/adapters';
import { apiFetch } from './utils/format';

interface AppBootstrapPayload {
  org_id: string;
  org_name: string;
  recovery_cases: RecoveryCaseInput[];
  ledger_entries: LedgerEntryInput[];
  consent_policies: ConsentPolicyInput[];
  claims_preview: ClaimPreviewRecord[];
  evidence_items: EvidenceItemRecord[];
  decisions: HumanDecisionRecord[];
  audit_log: AuditLogRecord[];
  anomaly_threshold_pct: number;
  anomaly_alerts: AnomalyAlertRecord[];
  kpi_audit_notes: KpiAuditNoteRecord[];
  approval_workflows: Record<string, LedgerApprovalWorkflowRecord>;
  agent_runs?: ClaimAgentRunRecord[];
  agent_proposals?: ClaimAgentProposalRecord[];
  guardrails: Array<{
    id: string;
    statute: string;
    title: string;
    detail: string;
    status: string;
  }>;
  adapters: SimulatedAdapterMeta[];
  vault_verification: VaultVerificationResult;
  tamper_simulated: boolean;
  active_actor: {
    role: RoleId;
    userId: string;
    displayName: string;
  };
}

function parseRouteFromLocation(): NavRoute {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const raw = window.location.pathname;
  const path = ((base && raw.startsWith(base) ? raw.slice(base.length) : raw) || '/') as NavRoute;
  const valid: NavRoute[] = [
    '/',
    '/recovery',
    '/vault',
    '/consent',
    '/claims',
    '/compliance','/workforce','/network','/leakage','/intake',
  ];
  if (valid.includes(path)) return path;
  return import.meta.env.VITE_STATIC_PREVIEW ? '/leakage' : '/';
}

export default function App() {
  React.useEffect(()=>{fetch('/api/health',{cache:'no-store'}).then(r=>r.json()).then(j=>{const mine=document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src')?.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1];if(mine&&j.build_id&&j.build_id!==mine&&!sessionStorage.getItem('ct-reloaded')){sessionStorage.setItem('ct-reloaded','1');const u=new URL(location.href);u.searchParams.set('v',j.build_id);location.replace(u.toString())}}).catch(()=>{})},[]);
  const [route, setRoute] = React.useState<NavRoute>(() =>
    parseRouteFromLocation(),
  );
  const [activeRole, setActiveRole] =
    React.useState<RoleId>('head_of_forensics');
  const [data, setData] = React.useState<AppBootstrapPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [readoutModalOpen, setReadoutModalOpen] = React.useState(false);

  const loadState = React.useCallback(async (roleToUse: RoleId) => {
    try {
      const payload = await apiFetch<AppBootstrapPayload>(
        '/api/state',
        roleToUse,
      );
      setData(payload);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load ClaimTrace state',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if(route!=='/network'&&route!=='/leakage'&&!(import.meta.env.VITE_STATIC_PREVIEW&&route==='/recovery'))loadState(activeRole);
  }, [activeRole, route, loadState]);

  React.useEffect(() => {
    const onPopState = () => setRoute(parseRouteFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(nextRoute: NavRoute) {
    setRoute(nextRoute);
    if (window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
    apiFetch('/api/audit/view', activeRole, {
      method: 'POST',
      body: JSON.stringify({ view: nextRoute }),
    })
      .then(() => {
        if (nextRoute === '/compliance') {
          return loadState(activeRole);
        }
      })
      .catch(() => {});
  }

  function handleChangeRole(nextRole: RoleId) {
    setActiveRole(nextRole);
    apiFetch('/api/demo-view-audit', nextRole, {
      method: 'POST',
      body: JSON.stringify({ role: nextRole }),
    }).catch(() => {});
  }

  async function handleToggleSignoff(
    entryId: string,
    signoffType: 'forensics' | 'finance',
    signed: boolean,
  ) {
    await apiFetch(`/api/ledger/${entryId}/signoff`, activeRole, {
      method: 'POST',
      body: JSON.stringify({ signoff_type: signoffType, signed }),
    });
    await loadState(activeRole);
  }

  async function handleApplyDigitalSignature(
    payload: ApplyDigitalSignaturePayload,
  ): Promise<ApplyDigitalSignatureResult> {
    const res = await apiFetch<
      ApplyDigitalSignatureResult & { ok: boolean }
    >(
      `/api/ledger/${encodeURIComponent(payload.entryId)}/approve-signature`,
      activeRole,
      {
        method: 'POST',
        body: JSON.stringify({
          target_role: payload.targetRole,
          action: payload.action,
          expected_challenge_code: payload.expectedChallengeCode,
          entered_challenge_code: payload.enteredChallengeCode,
          attestation_accepted: payload.attestationAccepted,
          attestation_text: payload.attestationText,
          firebase_uid: payload.firebaseUid ?? null,
          firebase_email: payload.firebaseEmail ?? null,
          firebase_display_name: payload.firebaseDisplayName ?? null,
        }),
      },
    );
    await loadState(activeRole);
    return res;
  }

  function handleOpenReadout() {
    if (route !== '/') {
      navigate('/');
    }
    setReadoutModalOpen(true);
  }

  async function handleUpdateAnomalyThreshold(thresholdPct: number) {
    await apiFetch('/api/anomaly/threshold', activeRole, {
      method: 'POST',
      body: JSON.stringify({ threshold_pct: thresholdPct }),
    });
    await loadState(activeRole);
  }

  async function handleAcknowledgeAlert(alertId: string) {
    await apiFetch(
      `/api/anomaly/alerts/${encodeURIComponent(alertId)}/acknowledge`,
      activeRole,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    await loadState(activeRole);
  }

  async function handleAddKpiAuditNote(
    content: string,
  ): Promise<KpiAuditNoteRecord> {
    const res = await apiFetch<{
      ok: boolean;
      note: KpiAuditNoteRecord;
      notes: KpiAuditNoteRecord[];
    }>('/api/kpi/notes', activeRole, {
      method: 'POST',
      body: JSON.stringify({ content, include_in_pdf: true }),
    });
    await loadState(activeRole);
    return res.note;
  }

  async function handleToggleKpiAuditNotePdf(
    noteId: string,
    includeInPdf: boolean,
  ) {
    await apiFetch(
      `/api/kpi/notes/${encodeURIComponent(noteId)}`,
      activeRole,
      {
        method: 'PATCH',
        body: JSON.stringify({ include_in_pdf: includeInPdf }),
      },
    );
    await loadState(activeRole);
  }

  async function handleDeleteKpiAuditNote(noteId: string) {
    await apiFetch(
      `/api/kpi/notes/${encodeURIComponent(noteId)}`,
      activeRole,
      {
        method: 'DELETE',
      },
    );
    await loadState(activeRole);
  }

  function handleInspectHeatmap() {
    if (route !== '/') {
      navigate('/');
    }
    window.setTimeout(() => {
      const el = document.querySelector(
        'section[aria-label="Anomaly Density Heatmap"]',
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  }

  if(route==='/network')return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Synthetic graph preview" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><RelationshipGraph/></LayoutShell>;
  if(route==='/recovery'&&import.meta.env.VITE_STATIC_PREVIEW)return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Synthetic recovery preview" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><RecoveryDeskView cases={SYNTHETIC_RECOVERY_CASES} decisions={[]} activeRole={activeRole} activeActorName="Synthetic reviewer" onCaseAdded={async()=>{}} onDecisionRecorded={async()=>{}}/></LayoutShell>;
  if(route==='/leakage')return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Synthetic leakage preview" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><RetrospectiveLeakageView onNavigate={navigate} activeRole={activeRole}/></LayoutShell>;
  if(route==='/intake')return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Insurer intake" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><IntakeView onNavigate={navigate} activeRole={activeRole}/></LayoutShell>;
  if(route==='/investigator')return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Claims investigation" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><InvestigatorView activeRole={activeRole} onOpenExample={()=>navigate('/see-worked-case-example')}/></LayoutShell>;
  if(route==='/see-worked-case-example')return <LayoutShell activeRoute={route} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Worked example" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><WorkedCaseLanding onOpenCase={(id)=>navigate(`/see-worked-case-example/${id}` as NavRoute)} onSeed={()=>navigate('/investigator')}/></LayoutShell>;
  if(route.startsWith('/see-worked-case-example/'))return <LayoutShell activeRoute={'/see-worked-case-example'} onNavigate={navigate} activeRole={activeRole} onChangeRole={handleChangeRole} orgName="Worked example" vaultValid={false} anomalyAlerts={[]} anomalyThresholdPct={75} onAcknowledgeAlert={async()=>{}} onOpenReadout={()=>{}}><WorkedCaseDetailPage caseId={route.split('/').pop() ?? ''} onBack={()=>navigate('/see-worked-case-example')}/></LayoutShell>;
  if (loading && !data) {
    return <BootSplash />;
  }

  if (error || !data) {
    const loginRequired = Boolean(error && error.includes('access code'));
    return (
      <div className="min-h-screen bg-[#0B1120] text-red-300 flex flex-col items-center justify-center p-6 gap-4">
        <div className="text-sm font-semibold">
          {error ?? 'Failed to initialize ClaimTrace'}
        </div>
        {loginRequired && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.target as HTMLFormElement).elements.namedItem('access_code') as HTMLInputElement;
              try { localStorage.setItem('nahashield-access-code', input.value.trim()); } catch { /* storage unavailable */ }
              setError(null);
              setLoading(true);
              loadState(activeRole);
            }}
          >
            <input
              name="access_code"
              type="password"
              placeholder="Access code"
              aria-label="Access code"
              className="px-3 py-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200"
            />
            <button type="submit" className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 text-white">
              Sign in
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => loadState(activeRole)}
          className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 text-white"
        >
          Retry Connection
        </button><a href="/review" className="underline">Open the public synthetic review</a><div className="w-full max-w-2xl"><WorkforceView onRecorded={()=>void loadState(activeRole)}/></div>
      </div>
    );
  }

  return (
    <LayoutShell
      activeRoute={route}
      onNavigate={navigate}
      activeRole={activeRole}
      onChangeRole={handleChangeRole}
      orgName={data.org_name}
      vaultValid={data.vault_verification.valid}
      anomalyAlerts={data.anomaly_alerts ?? []}
      anomalyThresholdPct={data.anomaly_threshold_pct ?? 75}
      onAcknowledgeAlert={handleAcknowledgeAlert}
      onInspectHeatmap={handleInspectHeatmap}
      onOpenReadout={handleOpenReadout}
    >
      {route === '/workforce' && <WorkforceTabs activeRole={activeRole} onRecorded={()=>loadState(activeRole)}/>}
      {route === '/' && (
        <OverviewLedgerView
          orgId={data.org_id}
          entries={data.ledger_entries}
          recoveryCases={data.recovery_cases}
          consentPolicies={data.consent_policies}
          evidenceItems={data.evidence_items}
          vaultVerification={data.vault_verification}
          claims={data.claims_preview ?? []}
          anomalyThresholdPct={data.anomaly_threshold_pct ?? 75}
          anomalyAlerts={data.anomaly_alerts ?? []}
          kpiAuditNotes={data.kpi_audit_notes ?? []}
          approvalWorkflows={data.approval_workflows ?? {}}
          onAddKpiAuditNote={handleAddKpiAuditNote}
          onToggleKpiAuditNotePdf={handleToggleKpiAuditNotePdf}
          onDeleteKpiAuditNote={handleDeleteKpiAuditNote}
          onUpdateThreshold={handleUpdateAnomalyThreshold}
          orgName={data.org_name}
          activeRole={activeRole}
          activeActorName={data.active_actor.displayName}
          onToggleSignoff={handleToggleSignoff}
          onApplyDigitalSignature={handleApplyDigitalSignature}
          onNavigate={navigate}
          onRefresh={() => loadState(activeRole)}
          readoutModalOpen={readoutModalOpen}
          onCloseReadoutModal={() => setReadoutModalOpen(false)}
        />
      )}

      {route === '/recovery' && (
        <RecoveryDeskView
          cases={data.recovery_cases}
          decisions={data.decisions}
          activeRole={activeRole}
          activeActorName={data.active_actor.displayName}
          onCaseAdded={() => loadState(activeRole)}
          onDecisionRecorded={() => loadState(activeRole)}
        />
      )}

      {route === '/vault' && (
        <EvidenceVaultView
          items={data.evidence_items}
          verification={data.vault_verification}
          tamperSimulated={data.tamper_simulated}
          activeRole={activeRole}
          onRefresh={() => loadState(activeRole)}
        />
      )}

      {route === '/consent' && (
        <ConsentDeskView
          policies={data.consent_policies}
          activeRole={activeRole}
          onRefresh={() => loadState(activeRole)}
        />
      )}

      {route === '/claims' && (
        <ClaimsPreviewView
          claims={data.claims_preview}
          activeRole={activeRole}
          onRefresh={() => loadState(activeRole)}
        />
      )}

      {route === '/compliance' && (
        <ComplianceAuditView
          guardrails={data.guardrails}
          adapters={data.adapters}
          auditLog={data.audit_log}
          agentRuns={data.agent_runs ?? []}
          agentProposals={data.agent_proposals ?? []}
          claims={data.claims_preview}
          activeRole={activeRole}
          onRefresh={() => loadState(activeRole)}
        />
      )}
    </LayoutShell>
  );
}
