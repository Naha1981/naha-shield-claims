import type { LedgerEntryInput, RoleId } from './types';

export type ApprovalSignerRole = 'head_of_forensics' | 'finance_cfo';

export type WorkflowVerificationStatus =
  | 'Pending Dual-Factor'
  | 'Awaiting CFO Signature'
  | 'Awaiting Forensics Signature'
  | 'Verified';

export interface StakeholderDigitalSignature {
  role: ApprovalSignerRole;
  role_label: 'Head of Forensics' | 'Chief Financial Officer';
  signer_id: string;
  signer_name: string;
  signer_email: string | null;
  auth_method: 'firebase_google_oauth' | 'workspace_rbac_2fa';
  challenge_code: string;
  attestation: string;
  signature_digest: string;
  signed_at: string;
}

export interface LedgerApprovalWorkflowRecord {
  entry_id: string;
  forensics_signature: StakeholderDigitalSignature | null;
  cfo_signature: StakeholderDigitalSignature | null;
  workflow_status: WorkflowVerificationStatus;
  verification_certificate_hash: string | null;
  verified_at: string | null;
}

export const ROLE_TO_LABEL: Record<
  ApprovalSignerRole,
  'Head of Forensics' | 'Chief Financial Officer'
> = {
  head_of_forensics: 'Head of Forensics',
  finance_cfo: 'Chief Financial Officer',
};

export const DEFAULT_ATTESTATION_BY_ROLE: Record<ApprovalSignerRole, string> = {
  head_of_forensics:
    'Forensic evidence, DHA/bureau corroboration, and human review controls verified for Rand protection booking.',
  finance_cfo:
    'Bank-reconciled EFT clearance, legal/tracing cost deduction, and IFRS ledger allocation verified for booking.',
};

export function isApprovalSignerRole(role: RoleId): role is ApprovalSignerRole {
  return role === 'head_of_forensics' || role === 'finance_cfo';
}

export function deriveWorkflowStatus(
  forensicsSig: StakeholderDigitalSignature | null,
  cfoSig: StakeholderDigitalSignature | null,
): WorkflowVerificationStatus {
  if (forensicsSig && cfoSig) return 'Verified';
  if (forensicsSig && !cfoSig) return 'Awaiting CFO Signature';
  if (!forensicsSig && cfoSig) return 'Awaiting Forensics Signature';
  return 'Pending Dual-Factor';
}

export function isLedgerEntryVerified(
  record: LedgerApprovalWorkflowRecord | null | undefined,
): boolean {
  if (!record) return false;
  return (
    record.workflow_status === 'Verified' &&
    record.forensics_signature !== null &&
    record.cfo_signature !== null &&
    typeof record.verification_certificate_hash === 'string' &&
    record.verification_certificate_hash.length >= 16
  );
}

export function validateDualFactorApprovalInput(params: {
  actorRole: RoleId;
  targetRole: ApprovalSignerRole;
  expectedChallengeCode: string;
  enteredChallengeCode: string;
  attestationAccepted: boolean;
  attestationText: string;
}): { ok: boolean; error?: string } {
  if (params.actorRole !== params.targetRole) {
    return {
      ok: false,
      error: `Separation of Duties Enforced: Switch active role to "${ROLE_TO_LABEL[params.targetRole]}" to apply this digital signature.`,
    };
  }

  const expected = params.expectedChallengeCode.trim().toUpperCase();
  const entered = params.enteredChallengeCode.trim().toUpperCase();
  if (!/^NAHA-\d{4}$/.test(expected)) {
    return {
      ok: false,
      error: 'Invalid or expired signing challenge token.',
    };
  }
  if (entered !== expected) {
    return {
      ok: false,
      error: `Dual-factor verification failed: entered token "${entered || 'empty'}" does not match active challenge "${expected}".`,
    };
  }

  if (!params.attestationAccepted) {
    return {
      ok: false,
      error: 'Stakeholder legal attestation checkbox must be confirmed.',
    };
  }

  if (params.attestationText.trim().length < 12) {
    return {
      ok: false,
      error: 'Attestation statement must be at least 12 characters.',
    };
  }

  return { ok: true };
}

export function generateChallengeToken(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    cryptoObj.getRandomValues(arr);
    const digits = 1000 + (arr[0] % 9000);
    return `NAHA-${digits}`;
  }
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `NAHA-${digits}`;
}

/**
 * Deterministic cryptographic signature payload builder (digest supplied by Node crypto or WebCrypto)
 */
export function buildSignatureCanonicalPayload(params: {
  entry_id: string;
  role: ApprovalSignerRole;
  signer_id: string;
  challenge_code: string;
  attestation: string;
  signed_at: string;
}): string {
  return JSON.stringify({
    entry_id: params.entry_id,
    role: params.role,
    signer_id: params.signer_id,
    challenge_code: params.challenge_code.trim().toUpperCase(),
    attestation: params.attestation.trim(),
    signed_at: params.signed_at,
  });
}

export function buildSeedApprovalWorkflows(
  entries: LedgerEntryInput[],
  digestFn: (input: string) => string,
): Record<string, LedgerApprovalWorkflowRecord> {
  const out: Record<string, LedgerApprovalWorkflowRecord> = {};

  for (const entry of entries) {
    const signedAt = `${entry.event_date}T12:00:00.000Z`;
    let forensicsSig: StakeholderDigitalSignature | null = null;
    let cfoSig: StakeholderDigitalSignature | null = null;

    if (entry.forensics_signoff) {
      const payload = buildSignatureCanonicalPayload({
        entry_id: entry.entry_id,
        role: 'head_of_forensics',
        signer_id: 'usr_forensics_01',
        challenge_code: 'NAHA-1001',
        attestation: DEFAULT_ATTESTATION_BY_ROLE.head_of_forensics,
        signed_at: signedAt,
      });
      forensicsSig = {
        role: 'head_of_forensics',
        role_label: 'Head of Forensics',
        signer_id: 'usr_forensics_01',
        signer_name: entry.forensics_signoff_by || 'K. Ndlovu',
        signer_email: null,
        auth_method: 'workspace_rbac_2fa',
        challenge_code: 'NAHA-1001',
        attestation: DEFAULT_ATTESTATION_BY_ROLE.head_of_forensics,
        signature_digest: digestFn(payload),
        signed_at: signedAt,
      };
    }

    if (entry.finance_signoff) {
      const payload = buildSignatureCanonicalPayload({
        entry_id: entry.entry_id,
        role: 'finance_cfo',
        signer_id: 'usr_finance_01',
        challenge_code: 'NAHA-2002',
        attestation: DEFAULT_ATTESTATION_BY_ROLE.finance_cfo,
        signed_at: signedAt,
      });
      cfoSig = {
        role: 'finance_cfo',
        role_label: 'Chief Financial Officer',
        signer_id: 'usr_finance_01',
        signer_name: entry.finance_signoff_by || 'S. Pillay (CFO)',
        signer_email: null,
        auth_method: 'workspace_rbac_2fa',
        challenge_code: 'NAHA-2002',
        attestation: DEFAULT_ATTESTATION_BY_ROLE.finance_cfo,
        signature_digest: digestFn(payload),
        signed_at: signedAt,
      };
    }

    const status = deriveWorkflowStatus(forensicsSig, cfoSig);
    const certHash =
      status === 'Verified' && forensicsSig && cfoSig
        ? digestFn(
            `${entry.entry_id}|${forensicsSig.signature_digest}|${cfoSig.signature_digest}`,
          )
        : null;

    out[entry.entry_id] = {
      entry_id: entry.entry_id,
      forensics_signature: forensicsSig,
      cfo_signature: cfoSig,
      workflow_status: status,
      verification_certificate_hash: certHash,
      verified_at: status === 'Verified' ? signedAt : null,
    };
  }

  return out;
}

export function summarizeApprovalWorkflows(
  records: Record<string, LedgerApprovalWorkflowRecord>,
): {
  total: number;
  verifiedCount: number;
  awaitingCfoCount: number;
  awaitingForensicsCount: number;
  pendingBothCount: number;
} {
  const list = Object.values(records);
  let verifiedCount = 0;
  let awaitingCfoCount = 0;
  let awaitingForensicsCount = 0;
  let pendingBothCount = 0;

  for (const r of list) {
    if (isLedgerEntryVerified(r)) verifiedCount += 1;
    else if (r.workflow_status === 'Awaiting CFO Signature') awaitingCfoCount += 1;
    else if (r.workflow_status === 'Awaiting Forensics Signature') {
      awaitingForensicsCount += 1;
    } else {
      pendingBothCount += 1;
    }
  }

  return {
    total: list.length,
    verifiedCount,
    awaitingCfoCount,
    awaitingForensicsCount,
    pendingBothCount,
  };
}
