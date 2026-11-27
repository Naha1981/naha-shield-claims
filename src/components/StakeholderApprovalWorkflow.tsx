import React from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  DEFAULT_ATTESTATION_BY_ROLE,
  generateChallengeToken,
  isLedgerEntryVerified,
  ROLE_TO_LABEL,
  summarizeApprovalWorkflows,
  type ApprovalSignerRole,
  type LedgerApprovalWorkflowRecord,
  type StakeholderDigitalSignature,
} from '../lib/engine/approvalWorkflow';
import type { LedgerEntryInput, RoleId } from '../lib/engine/types';
import {
  auth,
  FIREBASE_PROJECT_ID,
  signInStakeholderWithGoogle,
  signOutStakeholder,
  subscribeAuthState,
  subscribeFirestoreApprovalCount,
  syncApprovalRecordToFirestore,
  syncStakeholderProfileToFirestore,
} from '../lib/firebase';
import { formatZar } from '../utils/format';

export interface ApplyDigitalSignaturePayload {
  entryId: string;
  targetRole: ApprovalSignerRole;
  action: 'sign' | 'revoke';
  expectedChallengeCode: string;
  enteredChallengeCode: string;
  attestationAccepted: boolean;
  attestationText: string;
  firebaseUid?: string | null;
  firebaseEmail?: string | null;
  firebaseDisplayName?: string | null;
}

export interface ApplyDigitalSignatureResult {
  entry: LedgerEntryInput;
  workflow: LedgerApprovalWorkflowRecord;
  signature?: StakeholderDigitalSignature;
  transitioned_to_verified?: boolean;
}

interface StakeholderApprovalWorkflowProps {
  orgId: string;
  entries: LedgerEntryInput[];
  approvalWorkflows: Record<string, LedgerApprovalWorkflowRecord>;
  activeRole: RoleId;
  activeActorName: string;
  onApplyDigitalSignature: (
    payload: ApplyDigitalSignaturePayload,
  ) => Promise<ApplyDigitalSignatureResult>;
}

type WorkflowFilter = 'awaiting' | 'verified' | 'all';

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export const StakeholderApprovalWorkflow: React.FC<
  StakeholderApprovalWorkflowProps
> = ({
  orgId,
  entries,
  approvalWorkflows,
  activeRole,
  activeActorName,
  onApplyDigitalSignature,
}) => {
  const [filter, setFilter] = React.useState<WorkflowFilter>('awaiting');
  const [selectedEntryId, setSelectedEntryId] = React.useState<string>(() => {
    const syn009 = entries.find((e) => e.entry_id === 'SYN-009');
    if (syn009) return syn009.entry_id;
    const firstPending = entries.find(
      (e) => !isLedgerEntryVerified(approvalWorkflows[e.entry_id]),
    );
    return firstPending?.entry_id ?? entries[0]?.entry_id ?? '';
  });

  const [targetRole, setTargetRole] =
    React.useState<ApprovalSignerRole>('finance_cfo');
  const [challengeToken, setChallengeToken] = React.useState<string>(() =>
    generateChallengeToken(),
  );
  const [enteredChallenge, setEnteredChallenge] = React.useState<string>('');
  const [attestationText, setAttestationText] = React.useState<string>(
    DEFAULT_ATTESTATION_BY_ROLE.finance_cfo,
  );
  const [attestationAccepted, setAttestationAccepted] =
    React.useState<boolean>(false);

  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [workflowError, setWorkflowError] = React.useState<string | null>(null);
  const [workflowNotice, setWorkflowNotice] = React.useState<string | null>(
    null,
  );

  // Firebase Auth + Firestore Realtime Sync State
  const [firebaseUser, setFirebaseUser] = React.useState<User | null>(
    () => auth?.currentUser ?? null,
  );
  const [authBusy, setAuthBusy] = React.useState<boolean>(false);
  const [firestoreDocCount, setFirestoreDocCount] = React.useState<
    number | null
  >(null);
  const [firestoreNote, setFirestoreNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsub = subscribeAuthState((user) => {
      setFirebaseUser(user);
      if (user && user.emailVerified) {
        void syncStakeholderProfileToFirestore({
          user,
          orgId,
          assignedRole: activeRole,
        }).catch((err) => {
          setFirestoreNote(
            err instanceof Error ? err.message : 'Firestore profile sync note',
          );
        });
      }
    });
    return unsub;
  }, [orgId, activeRole]);

  React.useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) {
      setFirestoreDocCount(null);
      return;
    }
    const unsub = subscribeFirestoreApprovalCount(
      orgId,
      firebaseUser,
      (count) => {
        setFirestoreDocCount(count);
        setFirestoreNote(null);
      },
      (err) => {
        setFirestoreNote(err.message);
      },
    );
    return unsub;
  }, [orgId, firebaseUser]);

  const summary = React.useMemo(
    () => summarizeApprovalWorkflows(approvalWorkflows),
    [approvalWorkflows],
  );

  const filteredEntries = React.useMemo(() => {
    return entries.filter((entry) => {
      const wf = approvalWorkflows[entry.entry_id];
      const verified = isLedgerEntryVerified(wf);
      if (filter === 'verified') return verified;
      if (filter === 'awaiting') return !verified;
      return true;
    });
  }, [entries, approvalWorkflows, filter]);

  // Keep selectedEntryId valid if entries change
  React.useEffect(() => {
    if (
      selectedEntryId &&
      entries.some((e) => e.entry_id === selectedEntryId)
    ) {
      return;
    }
    if (filteredEntries[0]) {
      setSelectedEntryId(filteredEntries[0].entry_id);
    } else if (entries[0]) {
      setSelectedEntryId(entries[0].entry_id);
    }
  }, [entries, filteredEntries, selectedEntryId]);

  const selectedEntry = React.useMemo(
    () => entries.find((e) => e.entry_id === selectedEntryId) ?? entries[0],
    [entries, selectedEntryId],
  );

  const selectedWorkflow = selectedEntry
    ? approvalWorkflows[selectedEntry.entry_id]
    : undefined;

  // Smart default targetRole when selecting a different entry
  React.useEffect(() => {
    if (!selectedWorkflow) return;
    let nextTarget: ApprovalSignerRole = targetRole;
    if (!selectedWorkflow.cfo_signature && selectedWorkflow.forensics_signature) {
      nextTarget = 'finance_cfo';
    } else if (
      !selectedWorkflow.forensics_signature &&
      selectedWorkflow.cfo_signature
    ) {
      nextTarget = 'head_of_forensics';
    } else if (activeRole === 'finance_cfo') {
      nextTarget = 'finance_cfo';
    } else if (activeRole === 'head_of_forensics') {
      nextTarget = 'head_of_forensics';
    }
    setTargetRole(nextTarget);
    setAttestationText(DEFAULT_ATTESTATION_BY_ROLE[nextTarget]);
  }, [selectedEntry?.entry_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectTargetRole(role: ApprovalSignerRole) {
    setTargetRole(role);
    setAttestationText(DEFAULT_ATTESTATION_BY_ROLE[role]);
    setWorkflowError(null);
  }

  function handleRotateChallenge() {
    setChallengeToken(generateChallengeToken());
    setEnteredChallenge('');
    setWorkflowError(null);
  }

  async function handleGoogleAuth() {
    setAuthBusy(true);
    setFirestoreNote(null);
    setWorkflowError(null);
    try {
      const user = await signInStakeholderWithGoogle();
      setFirebaseUser(user);
      if (user.emailVerified) {
        await syncStakeholderProfileToFirestore({
          user,
          orgId,
          assignedRole: activeRole,
        });
      }
      setWorkflowNotice(
        `Firebase stakeholder identity verified: ${user.email ?? user.uid}. Dual-factor signatures will also replicate to Cloud Firestore.`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Firebase Google sign-in cancelled.';
      setFirestoreNote(msg);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignOut() {
    setAuthBusy(true);
    try {
      await signOutStakeholder();
      setFirebaseUser(null);
      setFirestoreDocCount(null);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleApplySignature(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEntry) return;
    setWorkflowError(null);
    setWorkflowNotice(null);
    setSubmitting(true);

    try {
      const res = await onApplyDigitalSignature({
        entryId: selectedEntry.entry_id,
        targetRole,
        action: 'sign',
        expectedChallengeCode: challengeToken,
        enteredChallengeCode: enteredChallenge,
        attestationAccepted,
        attestationText,
        firebaseUid: firebaseUser?.uid ?? null,
        firebaseEmail: firebaseUser?.email ?? null,
        firebaseDisplayName: firebaseUser?.displayName ?? null,
      });

      if (firebaseUser?.emailVerified && res.signature) {
        try {
          await syncApprovalRecordToFirestore({
            orgId,
            caseRef: selectedEntry.case_ref,
            amountAtStake: selectedEntry.amount_at_stake,
            record: res.workflow,
            actorRole: targetRole,
            action:
              res.workflow.workflow_status === 'Verified'
                ? 'WORKFLOW_VERIFIED'
                : 'SIGNATURE_APPLIED',
            signatureDigest: res.signature.signature_digest,
          });
        } catch (fbErr) {
          setFirestoreNote(
            fbErr instanceof Error
              ? fbErr.message
              : 'Firestore replication deferred.',
          );
        }
      }

      const verifiedNow = isLedgerEntryVerified(res.workflow);
      setWorkflowNotice(
        verifiedNow
          ? `${selectedEntry.entry_id} is now Verified — both Head of Forensics and Chief Financial Officer digital signatures sealed (Certificate ${res.workflow.verification_certificate_hash?.slice(0, 14)}…).`
          : `${ROLE_TO_LABEL[targetRole]} digital signature applied to ${selectedEntry.entry_id}. Status: ${res.workflow.workflow_status}.`,
      );

      setChallengeToken(generateChallengeToken());
      setEnteredChallenge('');
      setAttestationAccepted(false);
    } catch (err) {
      setWorkflowError(
        err instanceof Error
          ? err.message
          : 'Unable to apply digital signature.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeSlot(slotRole: ApprovalSignerRole) {
    if (!selectedEntry) return;
    setWorkflowError(null);
    setWorkflowNotice(null);
    setSubmitting(true);

    try {
      const res = await onApplyDigitalSignature({
        entryId: selectedEntry.entry_id,
        targetRole: slotRole,
        action: 'revoke',
        expectedChallengeCode: challengeToken,
        enteredChallengeCode: '',
        attestationAccepted: false,
        attestationText: '',
      });

      if (firebaseUser?.emailVerified) {
        try {
          await syncApprovalRecordToFirestore({
            orgId,
            caseRef: selectedEntry.case_ref,
            amountAtStake: selectedEntry.amount_at_stake,
            record: res.workflow,
            actorRole: slotRole,
            action: 'SIGNATURE_REVOKED',
            signatureDigest: 'revoked',
          });
        } catch (fbErr) {
          setFirestoreNote(
            fbErr instanceof Error
              ? fbErr.message
              : 'Firestore revocation sync deferred.',
          );
        }
      }

      setWorkflowNotice(
        `${ROLE_TO_LABEL[slotRole]} signature revoked on ${selectedEntry.entry_id}. Entry is no longer Verified.`,
      );
    } catch (err) {
      setWorkflowError(
        err instanceof Error ? err.message : 'Unable to revoke signature.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const entryVerified = isLedgerEntryVerified(selectedWorkflow);
  const roleMatchesTarget = activeRole === targetRole;
  const activeRoleLabel =
    activeRole === 'head_of_forensics'
      ? 'Head of Forensics'
      : activeRole === 'finance_cfo'
        ? 'Chief Financial Officer'
        : activeRole.replace(/_/g, ' ');

  return (
    <section
      aria-label="Stakeholder Approval Workflow"
      className="rounded-md bg-[#131C31] border border-slate-800 overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Stakeholder Approval Workflow
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dual-factor digital signature gate: requires independent{' '}
            <span className="text-slate-200 font-medium">
              Head of Forensics
            </span>{' '}
            and{' '}
            <span className="text-slate-200 font-medium">
              Chief Financial Officer
            </span>{' '}
            signatures before a ledger entry can be marked{' '}
            <span className="text-emerald-300 font-medium">Verified</span>.
          </p>
        </div>

        {/* Firebase Firestore Identity & Sync Bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
          <div className="flex items-center gap-1.5 text-slate-300 font-mono">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>Firestore · {FIREBASE_PROJECT_ID}</span>
            {firestoreDocCount !== null && (
              <span className="text-emerald-300 tabular-nums">
                · {firestoreDocCount} synced
              </span>
            )}
          </div>

          {firebaseUser ? (
            <div className="flex items-center gap-2">
              <span className="text-emerald-300 font-mono truncate max-w-[190px]">
                {firebaseUser.email || firebaseUser.uid}
              </span>
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignOut}
                className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3 h-3" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={handleGoogleAuth}
              className="px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 font-medium inline-flex items-center gap-1.5"
            >
              <UserCheck className="w-3.5 h-3.5" />
              {authBusy ? 'Connecting...' : 'Sign In with Google (2FA)'}
            </button>
          )}
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-slate-800 bg-[#0F172A]/60">
        <div className="p-3 rounded bg-[#0F172A] border border-slate-800">
          <div className="text-[11px] text-slate-400">
            Verified (Dual-Signed)
          </div>
          <div className="font-mono text-lg font-semibold text-emerald-400 mt-1 tabular-nums">
            {summary.verifiedCount} / {summary.total}
          </div>
        </div>
        <div className="p-3 rounded bg-[#0F172A] border border-slate-800">
          <div className="text-[11px] text-slate-400">
            Awaiting CFO Signature
          </div>
          <div className="font-mono text-lg font-semibold text-amber-300 mt-1 tabular-nums">
            {summary.awaitingCfoCount}
          </div>
        </div>
        <div className="p-3 rounded bg-[#0F172A] border border-slate-800">
          <div className="text-[11px] text-slate-400">
            Awaiting Forensics Signature
          </div>
          <div className="font-mono text-lg font-semibold text-amber-300 mt-1 tabular-nums">
            {summary.awaitingForensicsCount}
          </div>
        </div>
        <div className="p-3 rounded bg-[#0F172A] border border-slate-800">
          <div className="text-[11px] text-slate-400">
            Pending Dual-Factor
          </div>
          <div className="font-mono text-lg font-semibold text-slate-200 mt-1 tabular-nums">
            {summary.pendingBothCount}
          </div>
        </div>
      </div>

      {/* Inline Feedback Banners */}
      {workflowNotice && (
        <div
          role="status"
          className="mx-4 mt-4 p-3 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{workflowNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkflowNotice(null)}
            className="text-emerald-300 hover:text-white font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {workflowError && (
        <div
          role="alert"
          className="mx-4 mt-4 p-3 rounded bg-amber-950/50 border border-amber-600/60 text-amber-200 text-xs flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{workflowError}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkflowError(null)}
            className="text-amber-300 hover:text-white font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {firestoreNote && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300">
          Firestore status: {firestoreNote}
        </div>
      )}

      {/* Main Two-Column Approval Workbench */}
      <div className="p-4 grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Queue: Select Ledger Entry */}
        <div className="xl:col-span-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-200">
              Ledger Verification Queue
            </div>
            <div className="inline-flex items-center gap-1 p-0.5 bg-slate-900 rounded border border-slate-800">
              {(
                [
                  ['awaiting', 'Awaiting'],
                  ['verified', 'Verified'],
                  ['all', 'All'],
                ] as Array<[WorkflowFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                    filter === key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {filteredEntries.length === 0 ? (
              <div className="p-4 rounded bg-[#0F172A] border border-slate-800 text-xs text-slate-400">
                No ledger entries match this filter.
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const wf = approvalWorkflows[entry.entry_id];
                const isSelected = selectedEntry?.entry_id === entry.entry_id;
                const verified = isLedgerEntryVerified(wf);
                const statusText = wf?.workflow_status ?? 'Pending Dual-Factor';

                return (
                  <button
                    key={entry.entry_id}
                    type="button"
                    onClick={() => {
                      setSelectedEntryId(entry.entry_id);
                      setWorkflowError(null);
                      setWorkflowNotice(null);
                    }}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      isSelected
                        ? 'bg-slate-800/80 border-emerald-500/50'
                        : 'bg-[#0F172A] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-white">
                        {entry.entry_id} · {entry.case_ref}
                      </span>
                      <span className="font-mono text-xs text-slate-200 tabular-nums">
                        {formatZar(entry.amount_at_stake)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 truncate">
                      {entry.event_type} · {entry.basis}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px]">
                      <span
                        className={
                          verified
                            ? 'text-emerald-400 font-medium'
                            : 'text-amber-300 font-medium'
                        }
                      >
                        {statusText}
                      </span>
                      <span className="text-slate-400 font-mono tabular-nums">
                        {wf?.forensics_signature ? 'F:✓' : 'F:·'} /{' '}
                        {wf?.cfo_signature ? 'CFO:✓' : 'CFO:·'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel: Signature Slots + Dual-Factor Challenge */}
        {selectedEntry && selectedWorkflow && (
          <div className="xl:col-span-8 space-y-4">
            {/* Selected Entry Header & Verification Certificate Gate */}
            <div className="p-4 rounded bg-[#0F172A] border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-white">
                      {selectedEntry.entry_id}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono text-slate-300">
                      {selectedEntry.case_ref}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300">
                      {selectedEntry.event_type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {selectedEntry.description}
                  </p>
                </div>

                <div className="sm:text-right shrink-0">
                  <div className="font-mono text-base font-semibold text-white tabular-nums">
                    {formatZar(selectedEntry.amount_at_stake)}
                  </div>
                  <div
                    className={`text-xs font-semibold mt-0.5 ${
                      entryVerified ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    Status: {selectedWorkflow.workflow_status}
                  </div>
                </div>
              </div>

              {entryVerified ? (
                <div className="p-3 rounded bg-emerald-950/35 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-300 font-medium">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Dual-Factor Verification Complete · Ledger Entry Marked
                      Verified
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-emerald-200 tabular-nums break-all">
                    Verification Certificate SHA-256:{' '}
                    {selectedWorkflow.verification_certificate_hash}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded bg-slate-900/90 border border-slate-800 flex items-center gap-2 text-xs text-slate-300">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Verification Gate Locked — Requires both Head of Forensics
                    and Chief Financial Officer dual-factor digital signatures
                    before this entry can be marked{' '}
                    <span className="text-white font-medium">Verified</span>.
                  </span>
                </div>
              )}
            </div>

            {/* Dual Signature Slots */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  {
                    role: 'head_of_forensics' as ApprovalSignerRole,
                    title: 'Head of Forensics',
                    sig: selectedWorkflow.forensics_signature,
                  },
                  {
                    role: 'finance_cfo' as ApprovalSignerRole,
                    title: 'Chief Financial Officer',
                    sig: selectedWorkflow.cfo_signature,
                  },
                ] as const
              ).map(({ role, title, sig }) => {
                const isActiveTarget = targetRole === role;
                const canRevoke = Boolean(sig && activeRole === role);

                return (
                  <div
                    key={role}
                    className={`p-3.5 rounded bg-[#0F172A] border space-y-2.5 ${
                      sig
                        ? 'border-emerald-500/40'
                        : isActiveTarget
                          ? 'border-amber-500/50'
                          : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-white">
                        {title}
                      </div>
                      <span
                        className={`text-[11px] font-medium ${
                          sig ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {sig ? 'Signed (2FA)' : 'Pending Signature'}
                      </span>
                    </div>

                    {sig ? (
                      <div className="space-y-1.5 text-[11px]">
                        <div className="text-slate-300">
                          Signer:{' '}
                          <span className="text-white font-medium">
                            {sig.signer_name}
                          </span>
                          {sig.signer_email && (
                            <span className="text-emerald-300 font-mono ml-1">
                              ({sig.signer_email})
                            </span>
                          )}
                        </div>
                        <div className="text-slate-400 font-mono tabular-nums">
                          {sig.auth_method === 'firebase_google_oauth'
                            ? 'Factor: Firebase Google OAuth + Token'
                            : 'Factor: Workspace RBAC + Token'}{' '}
                          · {formatTimestamp(sig.signed_at)}
                        </div>
                        <div
                          className="font-mono text-[10px] text-slate-400 break-all"
                          title={sig.signature_digest}
                        >
                          SHA-256 Digest: {sig.signature_digest.slice(0, 28)}…
                        </div>
                        <div className="text-slate-400 italic">
                          &ldquo;{sig.attestation}&rdquo;
                        </div>
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={submitting || !canRevoke}
                            onClick={() => handleRevokeSlot(role)}
                            className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
                              canRevoke
                                ? 'border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200'
                                : 'border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {canRevoke
                              ? 'Revoke Own Signature'
                              : `Switch to ${title} to Revoke`}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-[11px] text-slate-400">
                        <p>
                          No digital signature recorded for {title}. Both
                          stakeholder signatures are mandatory for Verified status.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleSelectTargetRole(role)}
                          className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
                            isActiveTarget
                              ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300'
                              : 'border-slate-700 bg-slate-900 hover:border-slate-500 text-slate-200'
                          }`}
                        >
                          {isActiveTarget
                            ? `Selected for Signing (${title})`
                            : `Select ${title} Slot`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Dual-Factor Signing Form */}
            <form
              onSubmit={handleApplySignature}
              className="p-4 rounded bg-[#0F172A] border border-slate-800 space-y-3.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-400 shrink-0" />
                  <h3 className="text-xs font-semibold text-white">
                    Dual-Factor Digital Signature Authorization
                  </h3>
                </div>

                <div className="inline-flex items-center gap-1 p-0.5 bg-slate-900 rounded border border-slate-800">
                  {(
                    [
                      ['head_of_forensics', 'Head of Forensics'],
                      ['finance_cfo', 'Chief Financial Officer'],
                    ] as Array<[ApprovalSignerRole, string]>
                  ).map(([roleKey, roleName]) => (
                    <button
                      key={roleKey}
                      type="button"
                      onClick={() => handleSelectTargetRole(roleKey)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                        targetRole === roleKey
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {roleName}
                    </button>
                  ))}
                </div>
              </div>

              {/* Factor 1 Identity + Separation of Duties Gate */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                  <div className="text-[11px] text-slate-400">
                    Factor 1 · Active Stakeholder Identity
                  </div>
                  <div className="text-slate-200 font-medium mt-0.5">
                    {activeActorName} · Role:{' '}
                    <span className="text-white">{activeRoleLabel}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    {firebaseUser?.emailVerified
                      ? `Google OAuth Verified (${firebaseUser.email})`
                      : 'Workspace RBAC Session (optional Google OAuth above)'}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Factor 2 · Active One-Time Challenge Token
                    </div>
                    <div
                      data-testid="active-challenge-token"
                      className="font-mono text-sm font-bold text-emerald-300 mt-0.5 tracking-wider tabular-nums"
                    >
                      {challengeToken}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRotateChallenge}
                    className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] inline-flex items-center gap-1 shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Rotate Token
                  </button>
                </div>
              </div>

              {!roleMatchesTarget && (
                <div
                  role="note"
                  className="p-2.5 rounded bg-amber-950/40 border border-amber-600/50 text-amber-200 text-xs flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Separation of Duties Active: You are currently acting as{' '}
                    <span className="font-semibold">{activeRoleLabel}</span>.
                    Switch the header Active RBAC Role selector to{' '}
                    <span className="font-semibold">
                      {ROLE_TO_LABEL[targetRole]}
                    </span>{' '}
                    to sign this slot (server rejects cross-role signing with
                    HTTP 403).
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-1">
                  <label
                    htmlFor="stakeholder-challenge-input"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Confirm Challenge Token
                  </label>
                  <input
                    id="stakeholder-challenge-input"
                    type="text"
                    value={enteredChallenge}
                    onChange={(ev) => setEnteredChallenge(ev.target.value)}
                    placeholder={`Enter ${challengeToken}`}
                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 focus:border-emerald-500 focus:outline-none text-xs font-mono text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label
                    htmlFor="stakeholder-attestation-input"
                    className="block text-[11px] font-medium text-slate-300"
                  >
                    Digital Signature Attestation Statement (
                    {ROLE_TO_LABEL[targetRole]})
                  </label>
                  <textarea
                    id="stakeholder-attestation-input"
                    rows={2}
                    value={attestationText}
                    onChange={(ev) => setAttestationText(ev.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 focus:border-emerald-500 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <label
                  htmlFor="stakeholder-attestation-checkbox"
                  className="inline-flex items-start gap-2 text-xs text-slate-300 cursor-pointer"
                >
                  <input
                    id="stakeholder-attestation-checkbox"
                    type="checkbox"
                    checked={attestationAccepted}
                    onChange={(ev) =>
                      setAttestationAccepted(ev.target.checked)
                    }
                    className="mt-0.5 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>
                    I record this synthetic review attestation. This does not establish independent identity verification or immutable storage for{' '}
                    <span className="font-mono text-white">
                      {selectedEntry.entry_id}
                    </span>
                    .
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {submitting
                    ? 'Sealing Signature...'
                    : `Apply Digital Signature (${ROLE_TO_LABEL[targetRole]})`}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
};
