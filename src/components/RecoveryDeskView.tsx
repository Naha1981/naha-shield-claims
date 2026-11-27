import {useQueueView, QueueControls} from './QueueControls';
import {AgentText} from './AgentText';
import React from 'react';
import { AlertTriangle, Plus, Scale, Sparkles, X } from 'lucide-react';
import {
  evaluateRecoveryCase,
  summarizeRecoveryPortfolio,
} from '../lib/engine/triage';
import type {
  EmploymentType,
  HumanDecisionRecord,
  RecoveryCaseInput,
  RoleId,
  TitleType,
} from '../lib/engine/types';
import { apiFetch, formatZar } from '../utils/format';
import { TRACING_SOURCES } from '../lib/engine/tracingSources';

interface RecoveryDeskViewProps {
  cases: RecoveryCaseInput[];
  decisions: HumanDecisionRecord[];
  activeRole: RoleId;
  activeActorName: string;
  onCaseAdded: () => Promise<void>;
  onDecisionRecorded: () => Promise<void>;
}

type TriageFilter = 'all' | 's300' | 'writeoff' | 'rule46a' | 'ring';

export const RecoveryDeskView: React.FC<RecoveryDeskViewProps> = ({
  cases,
  decisions,
  activeRole,
  activeActorName,
  onCaseAdded,
  onDecisionRecorded,
}) => {
  const [detailTab,setDetailTab]=React.useState('overview');
  const detailTabs=[['overview','Overview'],['assets','Assets & legal'],['scenario','NRV scenarios'],['handover','Draft handover'],['decision','Human decisions'],['tracing','Tracing & ranking']];
  const [filter, setFilter] = React.useState<TriageFilter>('all');
  const [search, setSearch] = React.useState('');
  const [selectedCase, setSelectedCase] = React.useState<RecoveryCaseInput | null>(
    cases[3] ?? cases[0] ?? null,
  );

  // Live NRV Sensitivity Sliders
  const [sliderDiscountPct, setSliderDiscountPct] = React.useState(25);
  const [sliderLegalCost, setSliderLegalCost] = React.useState(
    selectedCase?.legal_costs ?? 75000,
  );

  // Human Decision Form (POPIA s71)
  const [reviewerId, setReviewerId] = React.useState(activeActorName);
  const [selectedAction, setSelectedAction] = React.useState('');
  const [reasonsText, setReasonsText] = React.useState('');
  const [counselNote, setCounselNote] = React.useState('');
  const [decisionStatus, setDecisionStatus] = React.useState<string | null>(null);
  const [decisionError, setDecisionError] = React.useState<string | null>(null);

  // Handover Pack / Deep Thinking Brief
  const [showHandoverPack, setShowHandoverPack] = React.useState(false);
  const [aiBrief, setAiBrief] = React.useState<string | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  // Add / Import Case Modal
  const [importOpen, setImportOpen] = React.useState(false);
  const [newCaseForm, setNewCaseForm] = React.useState<RecoveryCaseInput>({
    case_id: `SYN-RC-${String(cases.length + 1).padStart(3, '0')}`,
    policy_ref: 'POL-SYN-9901',
    claim_ref: 'CLM-SYN-9901',
    defendant_alias: 'Def. New (Imported Case)',
    payout_date: '2026-11-10',
    original_payout: 350000,
    fraud_basis: 'Forged DHA-1663 death registration',
    title_type: 'Freehold',
    primary_residence: true,
    est_sale_proceeds: 1100000,
    senior_bonds: 400000,
    municipal_arrears: 25000,
    legal_costs: 65000,
    employment: 'Salaried',
    ring_flag: false,
  });
  const [importError, setImportError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReviewerId(activeActorName);
  }, [activeActorName]);

  React.useEffect(() => {
    if (selectedCase) {
      setSliderDiscountPct(25);
      setSliderLegalCost(selectedCase.legal_costs);
      const t = evaluateRecoveryCase(selectedCase);
      setSelectedAction(t.recommended_route);
      setDecisionStatus(null);
      setDecisionError(null);
      setAiBrief(null);
      setAiError(null);
    }
  }, [selectedCase?.case_id]);

  const portfolio = React.useMemo(
    () => summarizeRecoveryPortfolio(cases),
    [cases],
  );

  const enrichedCases = React.useMemo(() => {
    return cases.map((c) => ({
      item: c,
      triage: evaluateRecoveryCase(c),
    }));
  }, [cases]);

  const filteredCases = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedCases.filter(({ item, triage }) => {
      if (q) {
        const hit =
          item.case_id.toLowerCase().includes(q) ||
          item.defendant_alias.toLowerCase().includes(q) ||
          item.fraud_basis.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filter === 's300') return triage.s300_forum !== null;
      if (filter === 'writeoff') return triage.early_write_off;
      if (filter === 'rule46a') return triage.rule_46a_flag;
      if (filter === 'ring') return item.ring_flag;
      return true;
    });
  }, [enrichedCases, filter, search]);

  const worthChasing = React.useMemo(
    () =>
      [...enrichedCases]
        .map((x) => ({
          ...x,
          net: x.triage.practically_recoverable - x.item.legal_costs,
        }))
        .sort((a, b) => b.net - a.net),
    [enrichedCases],
  );
  const caseQueue=useQueueView('recovery',filteredCases,{filters:{filter,search},onRestore:f=>{setFilter((f.filter||'all') as TriageFilter);setSearch(f.search||'')}});
  const liveTriage = React.useMemo(() => {
    if (!selectedCase) return null;
    return evaluateRecoveryCase({
      ...selectedCase,
      forced_sale_discount: sliderDiscountPct / 100,
      legal_costs: sliderLegalCost,
    });
  }, [selectedCase, sliderDiscountPct, sliderLegalCost]);

  const caseDecisions = React.useMemo(() => {
    if (!selectedCase) return [];
    return decisions.filter((d) => d.target_ref === selectedCase.case_id);
  }, [decisions, selectedCase]);

  async function handleSubmitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCase) return;
    setDecisionError(null);
    setDecisionStatus(null);

    const reasons = reasonsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!reviewerId.trim()) {
      setDecisionError('A named human reviewer ID is required by this demo control.');
      return;
    }
    if (reasons.length === 0) {
      setDecisionError(
        'At least one objective review reason is required.',
      );
      return;
    }

    try {
      await apiFetch('/api/decisions', activeRole, {
        method: 'POST',
        body: JSON.stringify({
          target_type: 'recovery_route',
          target_ref: selectedCase.case_id,
          selected_action: selectedAction,
          reviewer_id: reviewerId,
          objective_reasons: reasons,
          counsel_note: counselNote,
        }),
      });
      setDecisionStatus('Human counsel decision recorded and logged to audit trail.');
      setReasonsText('');
      setCounselNote('');
      await onDecisionRecorded();
    } catch (err) {
      setDecisionError(
        err instanceof Error ? err.message : 'Failed to record decision',
      );
    }
  }

  async function handleAddCase(e: React.FormEvent) {
    e.preventDefault();
    setImportError(null);
    try {
      await apiFetch('/api/recovery/cases', activeRole, {
        method: 'POST',
        body: JSON.stringify(newCaseForm),
      });
      setImportOpen(false);
      setSelectedCase(newCaseForm);
      await onCaseAdded();
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to import case',
      );
    }
  }

  async function handleDraftAiBrief() {
    if (!selectedCase) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch<{ text: string }>(
        '/api/ai/forensic-brief',
        activeRole,
        {
          method: 'POST',
          body: JSON.stringify({ case_id: selectedCase.case_id }),
        },
      );
      setAiBrief(res.text);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Unable to generate brief',
      );
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white tracking-tight">
            Recovery & Asset-Tenure Triage Desk
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Separates paper ownership from legally accessible cash across 8 asset layers before litigation spend is committed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add / Import Case
        </button>
      </div>

      {/* Portfolio Summary Strip */}
      <div className="recovery-metrics grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-3.5 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Portfolio Loss ({portfolio.case_count})</div>
          <div className="font-mono text-lg font-semibold text-white mt-1 tabular-nums">
            {formatZar(portfolio.total_lost)}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-emerald-500/30">
          <div className="text-xs text-emerald-300">Potentially recoverable · modelled</div>
          <div className="font-mono text-lg font-semibold text-emerald-400 mt-1 tabular-nums">
            {formatZar(portfolio.total_collectable)}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Futile Spend Flagged</div>
          <div className="font-mono text-lg font-semibold text-amber-300 mt-1 tabular-nums">
            {formatZar(portfolio.total_futile_spend_avoided)}
          </div>
        </div>
        <div className="p-3.5 rounded-md bg-[#131C31] border border-slate-800">
          <div className="text-xs text-slate-400">Rule 46A · PTO · Ring Flags</div>
          <div className="font-mono text-sm font-semibold text-slate-200 mt-1.5 tabular-nums">
            {portfolio.rule_46a_count} · {portfolio.pto_count} · {portfolio.ring_referral_count}
          </div>
        </div>
      </div>

      {/* Main Split: Case Table + Detail Triage Panel */}
      <div className="grid grid-cols-1 min-[1600px]:grid-cols-12 gap-6 items-start">
        {/* Left: Filterable Table */}
        <div className="min-[1600px]:col-span-7 rounded-md bg-[#131C31] border border-slate-800 overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search case ID, defendant..."
              aria-label="Search recovery cases"
              className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-48"
            />
            <div className="inline-flex flex-nowrap gap-1 p-1 bg-slate-900 rounded-md border border-slate-800 overflow-x-auto">
              {(
                [
                  ['all', 'All'],
                  ['s300', 'CPA s300'],
                  ['writeoff', 'Write-Off'],
                  ['rule46a', 'Rule 46A'],
                  ['ring', 'Ring / AFU'],
                ] as Array<[TriageFilter, string]>
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
                    filter === k
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
            <QueueControls label="Recovery cases" queue={caseQueue}/>
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2.5 px-3 font-medium">Case</th>
                  <th className="py-2.5 px-3 font-medium">Tenure & Flags</th>
                  <th className="py-2.5 px-3 font-medium text-right">Payout</th>
                  <th className="py-2.5 px-3 font-medium text-right">NRV Low / Recov.</th>
                  <th className="py-2.5 px-3 font-medium">Recommended Route</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {caseQueue.rows.map(({ item, triage }) => {
                  const active = selectedCase?.case_id === item.case_id;
                  return (
                    <tr
                      key={item.case_id}
                      onClick={() => {setSelectedCase(item);setTimeout(()=>document.getElementById('recovery-case-detail')?.scrollIntoView({behavior:'smooth',block:'start'}),50)}}
                      className={`cursor-pointer transition-colors ${
                        active
                          ? 'bg-emerald-500/10'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {setSelectedCase(item);setTimeout(()=>document.getElementById('recovery-case-detail')?.scrollIntoView({behavior:'smooth',block:'start'}),50)}}
                          className="text-left font-mono font-semibold text-emerald-300 hover:underline"
                        >
                          {item.case_id}
                        </button>
                        <div className="text-[13px] text-slate-300">
                          {item.defendant_alias}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="text-slate-200">{item.title_type}</div>
                        <div className="text-[13px] text-slate-400 mt-0.5">
                          {[
                            triage.rule_46a_flag ? 'Rule 46A' : null,
                            triage.ipilra_pto_flag ? 'IPILRA/PTO' : null,
                            item.ring_flag ? 'Ring/AFU' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || item.employment}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {formatZar(item.original_payout)}
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={
                            triage.practically_recoverable > 0
                              ? 'text-emerald-400 font-semibold'
                              : 'text-slate-500'
                          }
                        >
                          {formatZar(triage.practically_recoverable)}
                        </div>
                        <div className="text-[13px] text-slate-400">
                          NRV: {formatZar(triage.nrv_low)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="text-slate-200 leading-snug">
                          {triage.recommended_route}
                        </div>
                        {triage.s300_forum && (
                          <div className="text-[13px] text-sky-300 font-mono mt-0.5">
                            {triage.s300_forum}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: 8-Layer Detail, Sensitivity Sliders & Mandatory Counsel Decision */}
        {selectedCase && liveTriage && (
          <div id="recovery-case-detail" className="scroll-mt-24 min-[1600px]:col-span-5 rounded-md bg-[#131C31] border border-slate-800 p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                  <span>{selectedCase.case_id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedCase.policy_ref}</span>
                </div>
                <h2 className="font-display text-lg font-bold text-white mt-0.5">
                  {selectedCase.defendant_alias}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Synthetic recorded basis: {selectedCase.fraud_basis} · Example payout {formatZar(selectedCase.original_payout)} ({selectedCase.payout_date})
                </p>
              </div>
              <span className="text-[13px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 whitespace-nowrap">
                {selectedCase.status || 'Triaged'}
              </span>
            </div>

            <div role="tablist" aria-label="Recovery case details" className="flex flex-wrap gap-2">{detailTabs.map(([id,label])=><button key={id} type="button" role="tab" id={'recovery-tab-'+id} aria-controls={'recovery-panel-'+id} aria-selected={detailTab===id} className={'rounded-lg border px-3 py-2 text-sm '+(detailTab===id?'bg-emerald-800 text-white border-emerald-700':'border-slate-600')} onClick={()=>setDetailTab(id)}>{label}</button>)}</div>
            <section id="recovery-panel-overview" role="tabpanel" aria-labelledby="recovery-tab-overview" hidden={detailTab!=='overview'}><h3 className="font-semibold">Recovery overview</h3><dl className="grid sm:grid-cols-2 gap-4 mt-3 text-sm"><div><dt>Illustrative original payout</dt><dd>{formatZar(selectedCase.original_payout)}</dd></div><div><dt>Recommended route, human review required</dt><dd>{liveTriage.recommended_route}</dd></div></dl><p className="text-sm mt-3">This is a synthetic review model, not collectible cash, a court order or authority to contact a defendant. Use Assets & legal for the existing statutory flags, NRV scenarios for assumptions, then draft handover and the named human decision.</p></section>
            <section id="recovery-panel-assets" role="tabpanel" aria-labelledby="recovery-tab-assets" hidden={detailTab!=='assets'} className="space-y-4">
            {/* Statutory Warning Banners */}
            <div className="space-y-2">
              {liveTriage.s300_warning && (
                <div className="p-3 rounded bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">
                      CPA s300 Forum: {liveTriage.s300_forum}
                    </div>
                    <div>{liveTriage.s300_warning}</div>
                  </div>
                </div>
              )}
              {liveTriage.rule_46a_flag && (
                <div className="p-3 rounded bg-slate-900 border border-amber-500/40 text-xs text-amber-200">
                  <span className="font-semibold">Uniform Rule 46A Primary Residence: </span>
                  Judicial oversight & reserve-price auction delay must be modelled prior to execution.
                </div>
              )}
              {liveTriage.ipilra_pto_flag && (
                <div className="p-3 rounded bg-red-950/40 border border-red-600/50 text-xs text-red-200">
                  <span className="font-semibold">IPILRA / Communal PTO Non-Executable: </span>
                  Asset is legally inaccessible for civil attachment (accessible = 0). Halt execution spend.
                </div>
              )}
              {liveTriage.state_referral_pack && (
                <div className="p-3 rounded bg-sky-950/40 border border-sky-600/50 text-xs text-sky-200">
                  <span className="font-semibold">Syndicate Ring Referral: </span>
                  {liveTriage.state_referral_pack}
                </div>
              )}
            </div>

            {/* 8-Layer Asset Profile */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-200">
                  8-Layer Asset & Tenure Profile
                </h3>
                <span className="text-[13px] font-mono text-slate-400">
                  SIMULATED ADAPTER (WinDeed / CIPC)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[13px] text-slate-400">1. Registered Owner</div>
                  <div className="text-slate-200 font-medium truncate">
                    {liveTriage.eight_layers.registered_owner}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[13px] text-slate-400">2–3. Legal / Beneficial</div>
                  <div className="text-slate-200 font-medium truncate">
                    {liveTriage.eight_layers.beneficial_owner}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[13px] text-slate-400">4. Est. Market Value</div>
                  <div className="font-mono text-slate-200 tabular-nums">
                    {formatZar(liveTriage.eight_layers.market_value)}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[13px] text-slate-400">5. Forced-Sale ({sliderDiscountPct}% disc.)</div>
                  <div className="font-mono text-slate-200 tabular-nums">
                    {formatZar(liveTriage.eight_layers.forced_sale_value)}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[13px] text-slate-400">6. NRV Low / High</div>
                  <div className="font-mono text-slate-200 tabular-nums">
                    {formatZar(liveTriage.nrv_low)} / {formatZar(liveTriage.nrv_high)}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-slate-900/80 border border-emerald-500/30">
                  <div className="text-[13px] text-emerald-300">7–8. Accessible & Recoverable</div>
                  <div className="font-mono text-emerald-400 font-semibold tabular-nums">
                    {liveTriage.accessible === 1 ? 'YES' : 'NO'} · {formatZar(liveTriage.practically_recoverable)}
                  </div>
                </div>
              </div>
            </div>

            </section><section id="recovery-panel-tracing" role="tabpanel" aria-labelledby="recovery-tab-tracing" hidden={detailTab!=='tracing'} className="space-y-4">
              <div>
                <h3 className="font-semibold">Worth chasing first</h3>
                <p className="text-[13px] text-slate-400 mt-1">All cases ranked by modelled net recovery (practically recoverable minus legal costs). Modelled ranking, not a legal conclusion.</p>
                <div className="overflow-x-auto mt-2"><table className="w-full text-xs border border-slate-800"><thead><tr className="text-left text-slate-400"><th className="py-1.5 px-2">Rank</th><th className="py-1.5 px-2">Case</th><th className="py-1.5 px-2 text-right">Paid out</th><th className="py-1.5 px-2 text-right">Net recoverable</th><th className="py-1.5 px-2">Route</th></tr></thead><tbody>{worthChasing.map((x, i) => <tr key={x.item.case_id} className={x.item.case_id===selectedCase?.case_id?'bg-emerald-500/10 border-t border-slate-800':'border-t border-slate-800'}><td className="py-1.5 px-2 font-mono">{i + 1}</td><td className="py-1.5 px-2"><button type="button" className="text-emerald-300 font-mono hover:underline" onClick={() => setSelectedCase(x.item)}>{x.item.case_id}</button><div className="text-slate-400">{x.item.defendant_alias}{x.triage.early_write_off ? ' · Park: futile spend' : ''}</div></td><td className="py-1.5 px-2 text-right font-mono">{formatZar(x.item.original_payout)}</td><td className={x.net > 0 ? 'py-1.5 px-2 text-right font-mono text-emerald-400' : 'py-1.5 px-2 text-right font-mono text-slate-500'}>{formatZar(x.net)}</td><td className="py-1.5 px-2 text-slate-300">{x.triage.recommended_route}</td></tr>)}</tbody></table></div>
              </div>
              <div>
                <h3 className="font-semibold">Free South African tracing sources</h3>
                <p className="text-[13px] text-slate-400 mt-1">Free sources first; official-fee sources are marked so nothing is spent by accident. No live lookup is wired in: each search is a human step.</p>
                <div className="overflow-x-auto mt-2"><table className="w-full text-xs border border-slate-800"><thead><tr className="text-left text-slate-400"><th className="py-1.5 px-2">Source</th><th className="py-1.5 px-2">What it verifies</th><th className="py-1.5 px-2">Cost</th><th className="py-1.5 px-2">When to use it</th></tr></thead><tbody>{TRACING_SOURCES.map((s) => <tr key={s.name} className="border-t border-slate-800"><td className="py-1.5 px-2"><a className="text-emerald-300 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></td><td className="py-1.5 px-2 text-slate-300">{s.what}</td><td className={s.cost==='Free'?'py-1.5 px-2 text-emerald-400':'py-1.5 px-2 text-amber-300'}>{s.cost}</td><td className="py-1.5 px-2 text-slate-300">{s.use}</td></tr>)}</tbody></table></div>
              </div>
              {liveTriage?.ipilra_pto_flag && (
                <div className="p-3 rounded bg-amber-950/40 border border-amber-700/60 text-xs text-amber-200">
                  Communal / PTO tenure: the land cannot be sheriff-attached, so auction estimates do not apply. Verify tenure with the Traditional Council or communal property association records, and use the engine's emoluments or structured-settlement route.
                </div>
              )}
            </section><section id="recovery-panel-scenario" role="tabpanel" aria-labelledby="recovery-tab-scenario" hidden={detailTab!=='scenario'} className="space-y-4">
            <h3 className="font-semibold">NRV scenario comparison</h3><p className="text-sm">Illustrative assumptions only. Existing deterministic triage calculation, no probability or recoverability guarantee. Changing a slider does not change the case or commit a decision.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left p-2">Scenario</th><th className="text-left p-2">Discount</th><th className="text-left p-2">Legal cost</th><th className="text-left p-2">Model route</th></tr></thead><tbody>{[{name:'Lower discount / cost',discount:0.15,cost:25000},{name:'Recorded case assumptions',discount:selectedCase.forced_sale_discount??0.25,cost:selectedCase.legal_costs},{name:'Higher discount / cost',discount:0.5,cost:150000}].map(row=>{const evaluation=evaluateRecoveryCase({...selectedCase,forced_sale_discount:row.discount,legal_costs:row.cost});return <tr key={row.name} className="border-t border-slate-700"><td className="p-2">{row.name}</td><td className="p-2">{Math.round(row.discount*100)}%</td><td className="p-2">{formatZar(row.cost)}</td><td className="p-2">{evaluation.recommended_route}</td></tr>})}</tbody></table></div>
            {/* Live NRV Sensitivity Sliders */}
            <div className="p-3.5 rounded bg-slate-900/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">
                  Live NRV Sensitivity Modelling
                </h3>
                <span className="text-xs font-mono text-emerald-300">
                  Route: {liveTriage.recommended_route}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <label htmlFor="slider-fsd">Forced-Sale Discount</label>
                  <span className="font-mono text-slate-200">{sliderDiscountPct}%</span>
                </div>
                <input
                  id="slider-fsd"
                  type="range"
                  min={10}
                  max={50}
                  step={5}
                  value={sliderDiscountPct}
                  onChange={(e) => setSliderDiscountPct(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <label htmlFor="slider-cost">Estimated Legal & Sheriff Cost</label>
                  <span className="font-mono text-slate-200">{formatZar(sliderLegalCost)}</span>
                </div>
                <input
                  id="slider-cost"
                  type="range"
                  min={10000}
                  max={250000}
                  step={5000}
                  value={sliderLegalCost}
                  onChange={(e) => setSliderLegalCost(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>

            </section><section id="recovery-panel-handover" role="tabpanel" aria-labelledby="recovery-tab-handover" hidden={detailTab!=='handover'} className="space-y-4">
            {/* Attorney / AFU Handover Pack */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowHandoverPack((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 text-slate-200 hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <Scale className="w-3.5 h-3.5" />
                {showHandoverPack ? 'Hide Handover Pack' : 'Generate Attorney / AFU Handover Pack'}
              </button>
              <button
                type="button"
                disabled={aiLoading}
                onClick={handleDraftAiBrief}
                className="px-3 py-1.5 text-xs font-medium rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40 inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiLoading ? 'Drafting Brief...' : 'Draft Brief (Deep Thinking)'}
              </button>
            </div>

            {showHandoverPack && (
              <div className="p-3.5 rounded bg-slate-950 border border-slate-800 text-xs space-y-2">
                <div className="font-semibold text-white">
                  Attorney / AFU Handover Pack Preview — {selectedCase.case_id}
                </div>
                <p className="text-slate-300 leading-relaxed">
                  <strong>Claimant Insurer:</strong> Synthetic Partner · <strong>Defendant:</strong> {selectedCase.defendant_alias} · <strong>Loss:</strong> {formatZar(selectedCase.original_payout)}
                </p>
                <p className="text-slate-300 leading-relaxed">
                  <strong>Tenure & Equity:</strong> {selectedCase.title_type} (Bonds: {formatZar(selectedCase.senior_bonds)}, Arrears: {formatZar(selectedCase.municipal_arrears)}). Modelled recoverable: {formatZar(liveTriage.practically_recoverable)}.
                </p>
                <p className="text-slate-300 leading-relaxed">
                  <strong>Counsel Route Draft:</strong> {liveTriage.recommended_route}
                  {liveTriage.s300_forum ? ` (${liveTriage.s300_forum} — verify 60-day s300(5)(b) bar)` : ''}
                  {liveTriage.state_referral_pack ? `. ${liveTriage.state_referral_pack}` : ''}
                </p>
              </div>
            )}

            {aiError && (
              <div className="p-3 rounded bg-amber-950/40 border border-amber-700/60 text-xs text-amber-200">
                {aiError}
              </div>
            )}
            {aiBrief && (
              <div className="p-3.5 rounded bg-slate-950 border border-emerald-500/30 text-xs text-slate-200 whitespace-pre-wrap max-h-60 overflow-y-auto">
                <div className="text-[13px] font-mono text-emerald-400 mb-2">
                  DRAFT FOR HUMAN REVIEW · Legal references require counsel validation
                </div>
                <AgentText text={aiBrief}/>
              </div>
            )}

            </section><section id="recovery-panel-decision" role="tabpanel" aria-labelledby="recovery-tab-decision" hidden={detailTab!=='decision'} className="space-y-4">
            {/* Mandatory Human Decision Form (POPIA s71) */}
            <form
              onSubmit={handleSubmitDecision}
              className="pt-4 border-t border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Human review control · legal basis to be confirmed
                </h3>
                <span className="text-[13px] text-slate-400">
                  No auto-litigation permitted
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="decision-reviewer"
                    className="block text-[13px] text-slate-400 mb-1"
                  >
                    Named Reviewer ID
                  </label>
                  <input
                    id="decision-reviewer"
                    type="text"
                    value={reviewerId}
                    onChange={(e) => setReviewerId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="decision-action"
                    className="block text-[13px] text-slate-400 mb-1"
                  >
                    Recorded human route / action
                  </label>
                  <input
                    id="decision-action"
                    type="text"
                    value={selectedAction}
                    onChange={(e) => setSelectedAction(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="decision-reasons"
                  className="block text-[13px] text-slate-400 mb-1"
                >
                  Objective Reasons (one per line — required)
                </label>
                <textarea
                  id="decision-reasons"
                  rows={2}
                  value={reasonsText}
                  onChange={(e) => setReasonsText(e.target.value)}
                  placeholder="e.g., WinDeed title verified freehold NRV exceeds payout; counsel confirmed s300(5)(b) window"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500"
                />
              </div>

              <div>
                <label
                  htmlFor="decision-note"
                  className="block text-[13px] text-slate-400 mb-1"
                >
                  Counsel Note (Optional)
                </label>
                <input
                  id="decision-note"
                  type="text"
                  value={counselNote}
                  onChange={(e) => setCounselNote(e.target.value)}
                  placeholder="Masindi delict check or settlement floor instruction"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500"
                />
              </div>

              {decisionError && (
                <div className="text-xs text-red-300 bg-red-950/40 border border-red-700/50 rounded p-2.5">
                  {decisionError}
                </div>
              )}
              {decisionStatus && (
                <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-700/50 rounded p-2.5">
                  {decisionStatus}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                Record reviewer decision
              </button>

              {caseDecisions.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="text-[13px] text-slate-400 font-medium">
                    Recorded Decisions ({caseDecisions.length})
                  </div>
                  {caseDecisions.map((d) => (
                    <div
                      key={d.decision_id}
                      className="p-2.5 rounded bg-slate-900 border border-slate-800 text-[13px] text-slate-300"
                    >
                      <div className="font-semibold text-emerald-300">
                        {d.selected_action}
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        Reviewer: {d.reviewer_id} · {d.decided_at.slice(0, 10)}
                      </div>
                      <div className="mt-1 text-slate-300">
                        Reasons: {d.objective_reasons.join('; ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </form></section>
          </div>
        )}
      </div>

      {/* Add / Import Recovery Case Modal */}
      {importOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add or Import Recovery Case"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleAddCase}
            className="w-full max-w-lg rounded-lg bg-[#131C31] border border-slate-700 p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="font-display text-base font-bold text-white">
                Add / Import Loss-Register Case (Runs NRV Engine)
              </h2>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 text-[13px]">
              <span className="text-slate-400">
                Optional: load single-row CSV (case_id, policy_ref, alias, payout, title_type, proceeds, bonds, arrears, costs, employment)
              </span>
              <label className="px-2.5 py-1 rounded border border-slate-700 text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0">
                Load CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const txt = await file.text();
                    const lines = txt
                      .split(/\r?\n/)
                      .map((l) => l.trim())
                      .filter(Boolean);
                    const rowLine =
                      lines.length > 1 && lines[0].toLowerCase().includes('case_id')
                        ? lines[1]
                        : lines[0];
                    if (!rowLine) return;
                    const cols = rowLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
                    if (cols.length >= 6) {
                      setNewCaseForm((prev) => ({
                        ...prev,
                        case_id: cols[0] || prev.case_id,
                        policy_ref: cols[1] || prev.policy_ref,
                        defendant_alias: cols[2] || prev.defendant_alias,
                        original_payout: Number(cols[3]) || prev.original_payout,
                        title_type: (['Freehold', 'Sectional', 'Communal / PTO', 'None'].includes(cols[4])
                          ? cols[4]
                          : prev.title_type) as TitleType,
                        est_sale_proceeds: Number(cols[5]) || 0,
                        senior_bonds: Number(cols[6]) || 0,
                        municipal_arrears: Number(cols[7]) || 0,
                        legal_costs: Number(cols[8]) || prev.legal_costs,
                        employment: (['Salaried', 'Self-Employed', 'Unemployed', 'Incarcerated'].includes(cols[9])
                          ? cols[9]
                          : prev.employment) as EmploymentType,
                      }));
                    }
                  }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Case ID</label>
                <input
                  required
                  value={newCaseForm.case_id}
                  onChange={(e) =>
                    setNewCaseForm({ ...newCaseForm, case_id: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Policy Ref</label>
                <input
                  required
                  value={newCaseForm.policy_ref}
                  onChange={(e) =>
                    setNewCaseForm({ ...newCaseForm, policy_ref: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-slate-400 mb-1">Defendant Alias (No Real PII)</label>
                <input
                  required
                  value={newCaseForm.defendant_alias}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      defendant_alias: e.target.value,
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Original Payout (ZAR)</label>
                <input
                  type="number"
                  required
                  value={newCaseForm.original_payout}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      original_payout: Number(e.target.value),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Title Type</label>
                <select
                  value={newCaseForm.title_type}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      title_type: e.target.value as TitleType,
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                >
                  <option value="Freehold">Freehold</option>
                  <option value="Sectional">Sectional</option>
                  <option value="Communal / PTO">Communal / PTO</option>
                  <option value="None">None</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Est. Sale Proceeds</label>
                <input
                  type="number"
                  value={newCaseForm.est_sale_proceeds}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      est_sale_proceeds: Number(e.target.value),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Senior Bonds</label>
                <input
                  type="number"
                  value={newCaseForm.senior_bonds}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      senior_bonds: Number(e.target.value),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Legal Costs Est.</label>
                <input
                  type="number"
                  value={newCaseForm.legal_costs}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      legal_costs: Number(e.target.value),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Employment</label>
                <select
                  value={newCaseForm.employment}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      employment: e.target.value as EmploymentType,
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white"
                >
                  <option value="Salaried">Salaried</option>
                  <option value="Self-Employed">Self-Employed</option>
                  <option value="Unemployed">Unemployed</option>
                  <option value="Incarcerated">Incarcerated</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-slate-300 pt-2">
                <input
                  type="checkbox"
                  checked={newCaseForm.primary_residence}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      primary_residence: e.target.checked,
                    })
                  }
                />
                Primary Residence (Rule 46A)
              </label>
              <label className="flex items-center gap-2 text-slate-300 pt-2">
                <input
                  type="checkbox"
                  checked={newCaseForm.ring_flag}
                  onChange={(e) =>
                    setNewCaseForm({
                      ...newCaseForm,
                      ring_flag: e.target.checked,
                    })
                  }
                />
                Syndicate Ring (AFU / MLRO)
              </label>
            </div>

            {importError && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-700/50 rounded p-2.5">
                {importError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="px-4 py-2 text-xs rounded border border-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Import & Run Triage
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
