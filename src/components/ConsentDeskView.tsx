import {useQueueView, QueueControls} from './QueueControls';
import React from 'react';
import { AlertOctagon, CheckCircle2, Smartphone, ShieldAlert } from 'lucide-react';
import {
  evaluateConsentPolicy,
  summarizeConsentAudit,
} from '../lib/engine/consent';
import { lintOutboundMessage } from '../lib/engine/lint';
import type {
  ConsentLanguage,
  ConsentPolicyInput,
  RoleId,
} from '../lib/engine/types';
import { apiFetch, formatZar } from '../utils/format';

interface ConsentDeskViewProps {
  policies: ConsentPolicyInput[];
  activeRole: RoleId;
  onRefresh: () => Promise<void>;
}

const LANGUAGE_TEMPLATES: Record<
  ConsentLanguage,
  (proposer: string, cover: string, mult: number) => string
> = {
  English: (proposer, cover, mult) =>
    `NahaShield Cover Check: ${proposer} applied to insure your life for ${cover} (${mult}x accidental cover). Do you know and consent to this policy? Reply 1 Confirm, 2 Decline, or 9 Not Me.`,
  isiZulu: (proposer, cover, mult) =>
    `Isiqinisekiso seNahaShield: U-${proposer} ufake isicelo somshwalense wempilo yakho ka-${cover} (${mult}x ingozi). Uyazi futhi uyavuma? Phendula 1 Vuma, 2 Nqaba, noma 9 Akumina.`,
  isiXhosa: (proposer, cover, mult) =>
    `Uqinisekiso lweNahaShield: U-${proposer} ufake isicelo sepolisi yobomi bakho ye-${cover} (${mult}x ingozi). Uyazi kwaye uyavuma? Phendula 1 Vuma, 2 Yala, okanye 9 Asindim.`,
  Sesotho: (proposer, cover, mult) =>
    `Netefatso ya NahaShield: ${proposer} o kentse kopo ya inshorense ya bophelo ba hao ya ${cover} (${mult}x kotsi). Na o a tseba mme o a dumela? Araba 1 Dumela, 2 Hana, kapa 9 Ha se nna.`,
  Afrikaans: (proposer, cover, mult) =>
    `NahaShield Dekking-toets: ${proposer} het aansoek gedoen vir lewensdekking op u naam van ${cover} (${mult}x ongeluksdekking). Stem u saam? Antwoord 1 Bevestig, 2 Weier, of 9 Nie Ek Nie.`,
};

export const ConsentDeskView: React.FC<ConsentDeskViewProps> = ({
  policies,
  activeRole,
  onRefresh,
}) => {
  const thirdPartyPolicies = React.useMemo(
    () => policies.filter((p) => p.proposer_ne_assured || p.payer_ne_assured),
    [policies],
  );

  const [selectedPolicyId, setSelectedPolicyId] = React.useState(
    thirdPartyPolicies[0]?.policy_id ?? policies[0]?.policy_id ?? '',
  );
  const [simIndependentContact, setSimIndependentContact] =
    React.useState(true);
  const [simLanguage, setSimLanguage] =
    React.useState<ConsentLanguage>('isiZulu');
  const [phoneScreenText, setPhoneScreenText] = React.useState<string | null>(
    null,
  );
  const [simBusy, setSimBusy] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const [lastVaultHash, setLastVaultHash] = React.useState<string | null>(null);
  const [gapFilter, setGapFilter] = React.useState<'all' | 'gaps' | 'duress'>(
    'all',
  );

  const summary = React.useMemo(
    () => summarizeConsentAudit(policies),
    [policies],
  );

  const selectedPolicy = React.useMemo(
    () =>
      policies.find((p) => p.policy_id === selectedPolicyId) ?? policies[0],
    [policies, selectedPolicyId],
  );

  React.useEffect(() => {
    if (selectedPolicy) {
      setSimIndependentContact(selectedPolicy.independent_contact_on_file);
      setSimLanguage(selectedPolicy.preferred_language);
      setPhoneScreenText(null);
      setSimError(null);
    }
  }, [selectedPolicyId]);

  const outboundPreview = selectedPolicy
    ? LANGUAGE_TEMPLATES[simLanguage](
        selectedPolicy.proposer_alias,
        formatZar(selectedPolicy.cover_amount),
        selectedPolicy.accidental_multiplier,
      )
    : '';

  const templateLint = lintOutboundMessage(outboundPreview);

  const duressAlerts = React.useMemo(
    () => policies.filter((p) => p.duress_alert),
    [policies],
  );

  const evaluatedPolicies = React.useMemo(() => {
    return policies
      .map((p) => ({ policy: p, evalOut: evaluateConsentPolicy(p) }))
      .filter(({ policy, evalOut }) => {
        if (gapFilter === 'gaps') return evalOut.consent_gap_status !== 'OK';
        if (gapFilter === 'duress') return policy.duress_alert;
        return true;
      });
  }, [policies, gapFilter]);

  const policyQueue=useQueueView('consent',evaluatedPolicies,{filters:{gapFilter},onRestore:f=>setGapFilter((f.gapFilter||'all') as typeof gapFilter)});
  const duressQueue=useQueueView('duress',duressAlerts);
  async function handleTriggerOutcome(outcome: 'confirm' | 'decline' | 'duress') {
    if (!selectedPolicy) return;
    setSimBusy(true);
    setSimError(null);
    try {
      const res = await apiFetch<{
        external_screen_message: string;
        evidenceItem: { chain_hash: string } | null;
      }>('/api/consent/simulate', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          policy_id: selectedPolicy.policy_id,
          outcome,
          independent_contact_on_file: simIndependentContact,
          language: simLanguage,
          outbound_template: outboundPreview,
        }),
      });
      setPhoneScreenText(res.external_screen_message);
      setLastVaultHash(res.evidenceItem?.chain_hash ?? null);
      await onRefresh();
    } catch (err) {
      setSimError(
        err instanceof Error ? err.message : 'Consent simulation failed',
      );
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {selectedPolicy&&<section className="rounded-xl border border-slate-700 bg-slate-900 p-5" aria-label="Selected policy evidence"><h3>Policy evidence context</h3><div className="grid sm:grid-cols-3 gap-4 text-sm mt-3"><p><span className="text-slate-400">Policy</span><br/><strong>{selectedPolicy.policy_id}</strong></p><p><span className="text-slate-400">Source</span><br/>Synthetic policy fixture only</p><p><span className="text-slate-400">Purpose</span><br/>Review consent gaps, not claim eligibility</p></div><details className="mt-3 text-sm"><summary>Lawful basis and human decision boundary</summary><p className="mt-2">This screen models consent evidence and safe contact checks. It is not a case-specific lawful-processing register. An unsigned form, third-party payer or missing independent contact is a review indicator, not proof of fraud. No real consent request is delivered.</p><p className="mt-2">Reviewer must check original signed records, the applicable lawful basis, purpose and any other authority before processing real personal information.</p></details></section>}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white tracking-tight">
            Consent & Cover Integrity Desk (M2)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Independent out-of-band proof that the life assured consented to third-party cover. PEPUDA-compliant: consent tiers never inspect age.
          </p>
        </div>
        <span className="text-[13px] font-mono text-slate-400 shrink-0">
          SIMULATED ADAPTER (WhatsApp / USSD Gateway · KYC Contact Lookup)
        </span>
      </div>

      {/* Audit KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-3.5 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Third-Party Policies</div>
          <div className="font-mono text-lg font-semibold text-white mt-1 tabular-nums">
            {summary.third_party_count} / {summary.total_policies}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-red-500/40">
          <div className="text-xs text-red-300">Missing Consent Gaps</div>
          <div className="font-mono text-lg font-semibold text-red-400 mt-1 tabular-nums">
            {summary.consent_gap_count}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-amber-500/40">
          <div className="text-xs text-amber-300">Burner SIM / Unverified Channel</div>
          <div className="font-mono text-lg font-semibold text-amber-300 mt-1 tabular-nums">
            {summary.unverified_channel_count}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Escalated Tier (Age-Free)</div>
          <div className="font-mono text-lg font-semibold text-slate-100 mt-1 tabular-nums">
            {summary.escalated_count}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-red-500/40">
          <div className="text-xs text-red-300">Exposure at Consent Gap</div>
          <div className="font-mono text-lg font-semibold text-white mt-1 tabular-nums">
            {formatZar(summary.total_exposure_at_gap)}
          </div>
        </div>
      </div>

      {/* Interactive WhatsApp / USSD Consent & Silent Duress Simulator */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Simulator Controls + Phone Preview */}
        <div className="lg:col-span-7 rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Life-Assured WhatsApp / USSD Consent & Silent Duress Simulator
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tests anti-burner-SIM provenance and covert coercion handling (FIC s29(4) tipping-off safe).
              </p>
            </div>
            <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="sim-policy" className="block text-slate-400 mb-1">
                Third-Party Policy
              </label>
              <select
                id="sim-policy"
                value={selectedPolicyId}
                onChange={(e) => setSelectedPolicyId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono"
              >
                {thirdPartyPolicies.map((p) => (
                  <option key={p.policy_id} value={p.policy_id}>
                    {p.policy_id} ({p.assured_alias})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sim-lang" className="block text-slate-400 mb-1">
                Out-of-Band Language
              </label>
              <select
                id="sim-lang"
                value={simLanguage}
                onChange={(e) =>
                  setSimLanguage(e.target.value as ConsentLanguage)
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
              >
                {(['English', 'isiZulu', 'isiXhosa', 'Sesotho', 'Afrikaans'] as ConsentLanguage[]).map(
                  (l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label htmlFor="sim-contact" className="block text-slate-400 mb-1">
                Contact Provenance
              </label>
              <select
                id="sim-contact"
                value={simIndependentContact ? 'independent' : 'burner'}
                onChange={(e) =>
                  setSimIndependentContact(e.target.value === 'independent')
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
              >
                <option value="independent">Independent Contact (CRM/KYC)</option>
                <option value="burner">Burner SIM (Applicant-Supplied)</option>
              </select>
            </div>
          </div>

          {/* Side-by-side Handset Screen Preview */}
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between text-[13px] font-mono text-slate-400 border-b border-slate-800 pb-2">
              <span>HANDSET PREVIEW · {simLanguage.toUpperCase()}</span>
              <span
                className={
                  templateLint.ok ? 'text-emerald-400' : 'text-red-400'
                }
              >
                Tipping-Off Lint: {templateLint.ok ? 'PASS' : 'BLOCKED'}
              </span>
            </div>

            <div className="p-3 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-200 leading-relaxed">
              {outboundPreview}
            </div>

            {phoneScreenText && (
              <div
                data-testid="phone-external-response"
                className="p-3 rounded-md bg-slate-800/80 border border-slate-700 text-xs text-white font-medium"
              >
                Handset Display: {phoneScreenText}
              </div>
            )}

            {!simIndependentContact && (
              <div className="p-2.5 rounded bg-amber-950/40 border border-amber-600/40 text-xs text-amber-200">
                Contact Independence Unverified — Escalate: No CRM/KYC contact on file; applicant-supplied number cannot clear consent.
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={simBusy}
                onClick={() => handleTriggerOutcome('confirm')}
                className="px-3.5 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Confirm + Comprehension Answer
              </button>
              <button
                type="button"
                disabled={simBusy}
                onClick={() => handleTriggerOutcome('decline')}
                className="px-3.5 py-2 text-xs font-semibold rounded border border-amber-600/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50"
              >
                Decline / Unrecognised
              </button>
              <button
                type="button"
                disabled={simBusy}
                onClick={() => handleTriggerOutcome('duress')}
                className="px-3.5 py-2 text-xs font-semibold rounded border border-red-600/60 bg-red-950/50 text-red-200 hover:bg-red-900/50"
              >
                Silent Duress ("Not Me")
              </button>
            </div>

            {simError && (
              <div className="text-xs text-red-300">{simError}</div>
            )}
          </div>
        </div>

        {/* Right: Underwriter Silent Duress & Alert Queue */}
        <div className="lg:col-span-5 rounded-md bg-[#131C31] border border-slate-800 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-display text-base font-semibold text-white">
                Underwriter Alert Queue
              </h2>
              <span className="font-mono text-xs text-red-400 font-semibold">
                {duressAlerts.length} Active Duress
              </span>
            </div>

            {duressAlerts.length === 0 ? (
              <div className="p-4 rounded bg-slate-900 border border-slate-800 text-xs text-slate-400">
                No active silent duress coercion alerts. Trigger Silent Duress ("Not Me") in the simulator to test covert escalation.
              </div>
            ) : (
              <div className="space-y-2.5">
                <QueueControls label="Duress alerts" queue={duressQueue}/>{duressQueue.rows.map((alertPolicy) => (
                  <div
                    key={alertPolicy.policy_id}
                    data-testid="duress-alert-card"
                    className="p-3.5 rounded bg-red-950/45 border border-red-500/60 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-red-300 inline-flex items-center gap-1.5">
                        <AlertOctagon className="w-3.5 h-3.5" />
                        SILENT DURESS ALERT · {alertPolicy.policy_id}
                      </span>
                      <span className="font-mono text-[13px] text-red-200">
                        HIGH PRIORITY
                      </span>
                    </div>
                    <div className="text-xs text-slate-200">
                      Assured: {alertPolicy.assured_alias} · Proposer: {alertPolicy.proposer_alias} · Cover {formatZar(alertPolicy.cover_amount)} ({alertPolicy.accidental_multiplier}x)
                    </div>
                    <div className="text-[13px] text-red-200/90">
                      Coerced handset received neutral timeout screen. Policy issuance paused pending specialist human intervention (POPIA s71).
                    </div>
                    {alertPolicy.cert_hash && (
                      <div className="text-[13px] font-mono text-slate-300">
                        Vault Seal: {alertPolicy.cert_hash}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {lastVaultHash && (
              <div className="p-3 rounded bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Sealed to Evidence Vault · Chain Hash:{' '}
                  <span className="font-mono">{lastVaultHash.slice(0, 14)}...</span>
                </span>
              </div>
            )}
          </div>

          <div className="p-3 rounded bg-slate-900 border border-slate-800 text-[13px] text-slate-400 leading-relaxed">
            <strong className="text-slate-200">PPR Rule 2A.8.3 & PEPUDA Safeguard:</strong> Escalated consent adds recorded callback or opt-in liveness with mandatory non-biometric fallback. Age never triggers escalation.
          </div>
        </div>
      </section>

      {/* 30-Policy Consent Audit Table */}
      <section className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-white">
            Portfolio Consent-Gap Audit ({evaluatedPolicies.length} policies)
          </h2>
          <div className="flex gap-1 p-1 bg-slate-900 rounded-md border border-slate-800">
            {(
              [
                ['all', 'All Policies'],
                ['gaps', 'Consent & Channel Gaps'],
                ['duress', 'Silent Duress'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setGapFilter(k)}
                className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap ${
                  gapFilter === k
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <QueueControls label="Consent policies" queue={policyQueue}/>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="py-2.5 px-4 font-medium">Policy</th>
                <th className="py-2.5 px-4 font-medium">Parties & Product</th>
                <th className="py-2.5 px-4 font-medium">Contact Provenance</th>
                <th className="py-2.5 px-4 font-medium">Tier (Age-Free)</th>
                <th className="py-2.5 px-4 font-medium">Gap Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Exposure at Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {policyQueue.rows.map(({ policy, evalOut }) => (
                <tr key={policy.policy_id} className="hover:bg-slate-800/35">
                  <td className="py-2.5 px-4 font-mono text-slate-200 whitespace-nowrap">
                    <div>{policy.policy_id}</div>
                    <div className="text-[13px] text-slate-400">
                      {policy.preferred_language}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-100">
                      {policy.product_type}
                    </div>
                    <div className="text-[13px] text-slate-400">
                      {evalOut.third_party
                        ? `${policy.proposer_alias} → ${policy.assured_alias} (${policy.beneficiary_relationship})`
                        : 'First-party cover'}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div
                      className={
                        evalOut.contact_independence_status.includes('Unverified')
                          ? 'text-amber-300 font-medium'
                          : 'text-slate-300'
                      }
                    >
                      {evalOut.contact_independence_status}
                    </div>
                    <div className="text-[13px] text-slate-500">
                      Source: {policy.contact_source}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded border text-[13px] font-medium ${
                        evalOut.consent_tier === 'Escalated'
                          ? 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                          : 'border-slate-700 bg-slate-900 text-slate-300'
                      }`}
                    >
                      {evalOut.consent_tier}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {policy.duress_alert ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/60 bg-red-950/60 text-red-200 text-[13px] font-semibold">
                        <ShieldAlert className="w-3 h-3" />
                        SILENT DURESS
                      </span>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded border text-[13px] font-medium ${
                          evalOut.consent_gap_status === 'OK'
                            ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                            : 'border-red-500/40 bg-red-950/40 text-red-300'
                        }`}
                      >
                        {evalOut.consent_gap_status}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    <span
                      className={
                        evalOut.exposure_at_gap > 0
                          ? 'text-red-300 font-semibold'
                          : 'text-slate-500'
                      }
                    >
                      {formatZar(evalOut.exposure_at_gap)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
