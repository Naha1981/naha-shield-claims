import {ScreenGuide} from './ScreenGuide';
import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  FileSpreadsheet,
  FolderLock,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Menu,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import type { AnomalyAlertRecord } from '../lib/engine/anomaly';
import type { RoleId } from '../lib/engine/types';
import { formatZarCompact, ROLE_LABELS } from '../utils/format';

export type NavRoute =
  | '/'
  | '/recovery'
  | '/vault'
  | '/consent'
  | '/claims'
  | '/compliance'
  | '/workforce';

interface LayoutShellProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  activeRole: RoleId;
  onChangeRole: (role: RoleId) => void;
  orgName: string;
  vaultValid: boolean;
  anomalyAlerts: AnomalyAlertRecord[];
  anomalyThresholdPct: number;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onInspectHeatmap?: () => void;
  onOpenReadout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  route: NavRoute;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
 {route:'/workforce',label:'AI Workforce',sublabel:'Synthetic uploads · Human review',icon:ShieldCheck},
  {
    route: '/',
    label: 'Savings & Leakage',
    sublabel: 'Review example amounts',
    icon: FileSpreadsheet,
  },
  {
    route: '/recovery',
    label: 'Recovery Operations',
    sublabel: 'Assess recovery options',
    icon: Scale,
  },
  {
    route: '/vault',
    label: 'Evidence Management',
    sublabel: 'Sources and evidence history',
    icon: FolderLock,
  },
  {
    route: '/consent',
    label: 'Consent & Permissions',
    sublabel: 'Review consent evidence',
    icon: UserCheck,
  },
  {
    route: '/claims',
    label: 'Claims Quality Assurance',
    sublabel: 'Timing and payment checks',
    icon: ShieldAlert,
  },
  {
    route: '/compliance',
    label: 'Governance & Audit',
    sublabel: 'Review actions and safeguards',
    icon: ShieldCheck,
  },
];

export const LayoutShell: React.FC<LayoutShellProps> = ({
  activeRoute,
  onNavigate,
  activeRole,
  onChangeRole,
  orgName,
  vaultValid,
  anomalyAlerts,
  anomalyThresholdPct,
  onAcknowledgeAlert,
  onInspectHeatmap,
  onOpenReadout,
  children,
}) => {
  const [theme, setTheme] = React.useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('nahashield-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nahashield-theme', theme); } catch { /* Storage may be unavailable. */ }
  }, [theme]);
  const [collapsed,setCollapsed]=React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [alertsOpen, setAlertsOpen] = React.useState(false);
  const [ackBusyId, setAckBusyId] = React.useState<string | null>(null);
  const alertMenuRef = React.useRef<HTMLDivElement | null>(null);

  const unacknowledgedAlerts = React.useMemo(
    () => anomalyAlerts.filter((a) => !a.acknowledged),
    [anomalyAlerts],
  );
  const unacknowledgedCount = unacknowledgedAlerts.length;

  React.useEffect(() => {
    if (!alertsOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (
        alertMenuRef.current &&
        !alertMenuRef.current.contains(e.target as Node)
      ) {
        setAlertsOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAlertsOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [alertsOpen]);

  async function handleAck(alertId: string) {
    setAckBusyId(alertId);
    try {
      await onAcknowledgeAlert(alertId);
    } finally {
      setAckBusyId(null);
    }
  }

  const currentTitle =
    NAV_ITEMS.find((n) => n.route === activeRoute)?.label ?? 'NahaShield';

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100 flex flex-col overflow-x-hidden">
      {/* Mandatory Environment & Residency Banner */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-[13px] font-mono tracking-wide text-slate-400 text-center leading-tight">
        DEMONSTRATION · Synthetic data only · No live actions or payments
      </div>

      {/* Top Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-3 sm:px-4 lg:px-6 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-4">
        {/* Zone 1: Single-line Wordmark + Mobile toggle */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 lg:min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="lg:hidden shrink-0 p-1.5 sm:p-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="font-display text-sm sm:text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            NahaShield
          </a>
          <span className="hidden md:inline text-slate-600" aria-hidden="true">
            /
          </span>
          <span className="hidden md:inline text-sm text-slate-300 truncate">
            {currentTitle}
          </span>
        </div>

        {/* Zone 2: Demo RBAC Role Switcher */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 justify-end sm:flex-initial">
          <label
            htmlFor="role-switcher"
            className="hidden md:inline text-xs text-slate-400 whitespace-nowrap"
          >
            Demo view
          </label>
          <select
            id="role-switcher"
            aria-label="Demo role view, not account permissions"
            value={activeRole}
            onChange={(e) => {const role=e.target.value as RoleId;void fetch('/api/demo-view-audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role})});onChangeRole(role)}}
            className="w-full max-w-[106px] sm:max-w-none sm:w-auto truncate bg-slate-900 border border-slate-700 text-slate-100 text-[13px] sm:text-xs font-medium rounded-md px-1.5 sm:px-3 py-1 sm:py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {(Object.keys(ROLE_LABELS) as RoleId[]).map((roleKey) => (
              <option key={roleKey} value={roleKey}>
                {ROLE_LABELS[roleKey]}
              </option>
            ))}
          </select>
        </div>

        {/* Zone 3: Persistent Anomaly Alert Badge + Primary Action */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <div ref={alertMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setAlertsOpen((v) => !v)}
              aria-expanded={alertsOpen}
              aria-haspopup="dialog"
              title="Unacknowledged anomaly alerts"
              data-testid="header-anomaly-alert-button"
              className={`relative inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md border text-[13px] sm:text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                unacknowledgedCount > 0
                  ? 'bg-red-950/70 border-red-500/60 text-red-200 hover:bg-red-900/70'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Bell
                className={`w-3.5 h-3.5 shrink-0 ${
                  unacknowledgedCount > 0 ? 'text-red-400' : 'text-slate-400'
                }`}
              />
              <span className="hidden lg:inline">Alerts</span>
              <span
                data-testid="header-anomaly-alert-badge"
                className={`font-mono text-[10px] sm:text-[13px] font-bold tabular-nums px-1.5 py-0.5 rounded-xs leading-none ${
                  unacknowledgedCount > 0
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {unacknowledgedCount}
              </span>
            </button>

            {alertsOpen && (
              <div
                role="dialog"
                aria-label="Anomaly Threshold Alerts"
                className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-14 sm:top-full sm:mt-2 sm:w-[400px] z-50 rounded-md bg-[#0F172A] border border-slate-700 shadow-2xl overflow-hidden"
              >
                <div className="px-3.5 py-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#131C31]">
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Anomaly Threshold Alerts</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5 tabular-nums">
                      Trigger threshold: ≥{anomalyThresholdPct}% ·{' '}
                      {unacknowledgedCount} unacknowledged
                    </div>
                  </div>
                  {unacknowledgedCount > 0 && (
                    <button
                      type="button"
                      disabled={ackBusyId === 'all'}
                      onClick={() => handleAck('all')}
                      className="px-2 py-1 text-[13px] font-medium rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <CheckCheck className="w-3 h-3 text-emerald-400" />
                      Ack All
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/80">
                  {anomalyAlerts.length === 0 ? (
                    <div className="p-4 text-xs text-slate-400">
                      No product segments currently meet or exceed the{' '}
                      <span className="font-mono text-slate-200">
                        {anomalyThresholdPct}%
                      </span>{' '}
                      anomaly density threshold.
                    </div>
                  ) : (
                    anomalyAlerts.map((alert) => (
                      <div
                        key={alert.alert_id}
                        className={`p-3 text-xs flex items-start justify-between gap-3 ${
                          alert.acknowledged
                            ? 'bg-[#0F172A] opacity-75'
                            : 'bg-red-950/20'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-xs border ${
                                alert.severity === 'critical'
                                  ? 'bg-red-950/80 border-red-500/60 text-red-300'
                                  : 'bg-amber-950/70 border-amber-600/60 text-amber-300'
                              }`}
                            >
                              {alert.severity}
                            </span>
                            <span className="font-semibold text-slate-100 truncate">
                              {alert.product_type}
                            </span>
                          </div>
                          <div className="text-slate-300 font-medium">
                            {alert.pattern_label}
                          </div>
                          <div className="text-[13px] font-mono text-slate-400 tabular-nums">
                            {alert.density_pct}% density ({alert.affected_count}/
                            {alert.total_in_segment}) ·{' '}
                            {formatZarCompact(alert.exposure_zar)} scope
                          </div>
                        </div>

                        <div className="shrink-0">
                          {alert.acknowledged ? (
                            <span className="text-[10px] font-mono text-emerald-400 whitespace-nowrap">
                              Acked
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={ackBusyId === alert.alert_id}
                              onClick={() => handleAck(alert.alert_id)}
                              aria-label={`Acknowledge ${alert.product_type} ${alert.pattern_label} alert`}
                              className="px-2 py-1 text-[13px] font-medium rounded border border-emerald-500/40 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 whitespace-nowrap"
                            >
                              {ackBusyId === alert.alert_id
                                ? 'Saving...'
                                : 'Acknowledge'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-3.5 py-2.5 border-t border-slate-800 bg-[#131C31] flex items-center justify-between gap-2">
                  <span className="text-[13px] text-slate-400">
                    PEPUDA age-free rules · Audit logged
                  </span>
                  {onInspectHeatmap && (
                    <button
                      type="button"
                      onClick={() => {
                        setAlertsOpen(false);
                        onInspectHeatmap();
                      }}
                      className="text-[13px] font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      Inspect Heatmap
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenReadout}
            className="px-2 sm:px-4 py-1 sm:py-1.5 text-[13px] sm:text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <span className="sm:hidden">Export</span>
            <span className="hidden sm:inline">Export overview</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs lg:hidden"
          />
        )}

        {/* Sidebar Navigation */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 overflow-y-auto' : 'hidden'
          } lg:block lg:static ${collapsed?'lg:w-24':'lg:w-60'} w-64 shrink-0 bg-[#0F172A] border-r border-slate-800 flex flex-col justify-between`}
        >
          <div className="p-4 space-y-6">
            <div className="flex items-center justify-between lg:hidden pb-3 border-b border-slate-800">
              <span className="font-display text-sm font-bold text-white">
                NahaShield Navigation
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <p className="text-[13px] font-medium text-slate-400 px-2 mb-2">
                Workspace
              </p>
              <div className="px-2.5 py-2 rounded-md bg-slate-900/90 border border-slate-800 text-xs text-slate-200 leading-snug">
                <div className="font-medium truncate">{orgName}</div>
                <div className="text-[13px] text-slate-400 mt-0.5 font-mono">
                  Synthetic workspace · Server separated
                </div>
              </div>
            </div>

            <button className="hidden lg:block text-sm text-sky-300 underline mb-3" onClick={()=>setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed?'Expand navigation':'Collapse navigation'}</button><nav aria-label="Primary modules" className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeRoute === item.route;
                return (
                  <button
                    key={item.route}
                    title={item.label+": "+item.sublabel}
                    aria-label={item.label}
                    type="button"
                    onClick={() => {
                      onNavigate(item.route);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-md flex items-start gap-3 transition-colors ${
                      active
                        ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/30'
                        : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className={collapsed?'lg:hidden min-w-0':'min-w-0'}>
                      <div className="text-sm font-semibold whitespace-normal">
                        {item.label}
                      </div>
                      <div className="nav-description text-[13px] text-slate-400 whitespace-normal">
                        {item.sublabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav><a href="/map-preview" className="mt-3 flex rounded-lg border border-emerald-700 bg-emerald-800 px-4 py-3 font-semibold text-white">Maps &amp; address evidence</a>

            {/* Vault Integrity & Phase 3 Locked Status */}
            <details><summary className="text-sm cursor-pointer">Evidence & safeguards</summary><div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="px-3 py-2.5 rounded-md bg-slate-900/80 border border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Evidence hash chain</span>
                  <span
                    className={`font-mono font-semibold ${
                      vaultValid ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {vaultValid ? 'CHAIN VALID' : 'CHAIN CHECK FAILED'}
                  </span>
                </div>
              </div>

              <div className="px-3 py-2.5 rounded-md bg-slate-900/50 border border-slate-800/80">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Phase 3 Cross-Insurer PSI</span>
                </div>
                <p className="text-[13px] text-slate-400 mt-1 leading-relaxed">
                  LOCKED. Owner: designated compliance/legal reviewer, not assigned in this demo. Activation requires case-specific legal review of POPIA s57/58, lawful basis, agreements and tested security controls. No authorisation is recorded.
                </p>
              </div>
            </div></details>
          </div>

          <div className="p-4 border-t border-slate-800 text-[13px] text-slate-500">
            NahaLabs (Pty) Ltd · AI recommendations require named human review
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-4 lg:p-8 max-w-[1840px]">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4"><div><p className="text-sm text-slate-400">NahaShield / {currentTitle}</p><h1 className="text-2xl font-semibold text-slate-100 mt-1">{currentTitle}</h1></div><details className="rounded border border-slate-700 p-3 text-sm text-slate-200"><summary className="cursor-pointer">Workspace and account</summary><p className="mt-2 max-w-sm">{orgName}. Named reviewer sign-in is under Documents or Messages. The role selector is a demo view, not account access.</p><p className="mt-2 max-w-sm">No account invitation, password reset or company onboarding is provided here. Do not enter real claimant data.</p></details></div><a href="/map-preview" className="inline-flex items-center rounded-lg border border-emerald-700 bg-emerald-800 text-white px-4 py-3 mb-4 font-semibold">Maps · Check a physical address</a><ScreenGuide route={activeRoute}/>{children}
        </main>
      </div>
    </div>
  );
};
