import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  collection,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { LedgerApprovalWorkflowRecord } from './engine/approvalWorkflow';
import type { RoleId } from './engine/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let app: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (typeof window !== 'undefined' && firebaseConfig?.projectId) {
  app = initializeApp(firebaseConfig);
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  authInstance = getAuth(app);
}

export const db = dbInstance;
export const auth = authInstance;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<{
  reachable: boolean;
  offline: boolean;
}> {
  if (!db) return { reachable: false, offline: true };
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { reachable: true, offline: false };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
      return { reachable: false, offline: true };
    }
    // Permission denied / not-found still confirms Firestore endpoint is reachable
    return { reachable: true, offline: false };
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}

export function subscribeAuthState(
  cb: (user: User | null) => void,
): Unsubscribe {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, cb);
}

export async function signInStakeholderWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error('Firebase Auth is not initialized in this environment.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutStakeholder(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function syncStakeholderProfileToFirestore(params: {
  user: User;
  orgId: string;
  assignedRole: RoleId;
}): Promise<void> {
  if (!db || !params.user.emailVerified) return;
  const profilePath = `orgs/${params.orgId}/stakeholder_profiles/${params.user.uid}`;
  try {
    const batch = writeBatch(db);
    const ref = doc(db, 'orgs', params.orgId, 'stakeholder_profiles', params.user.uid);
    batch.set(
      ref,
      {
        uid: params.user.uid,
        orgId: params.orgId,
        displayName: (params.user.displayName || params.user.email || 'Stakeholder').slice(0, 100),
        ...(params.user.email ? { email: params.user.email.slice(0, 180) } : {}),
        assignedRole: params.assignedRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export async function syncApprovalRecordToFirestore(params: {
  orgId: string;
  caseRef: string;
  amountAtStake: number;
  record: LedgerApprovalWorkflowRecord;
  actorRole: 'head_of_forensics' | 'finance_cfo';
  action: 'SIGNATURE_APPLIED' | 'SIGNATURE_REVOKED' | 'WORKFLOW_VERIFIED';
  signatureDigest: string;
}): Promise<void> {
  if (!db || !auth?.currentUser || !auth.currentUser.emailVerified) return;

  const uid = auth.currentUser.uid;
  const approvalPath = `orgs/${params.orgId}/ledger_approvals/${params.record.entry_id}`;
  const auditId = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const batch = writeBatch(db);
    const approvalRef = doc(
      db,
      'orgs',
      params.orgId,
      'ledger_approvals',
      params.record.entry_id,
    );

    const mapSignature = (
      sig: LedgerApprovalWorkflowRecord['forensics_signature'],
    ) =>
      sig
        ? {
            role: sig.role,
            signerUid: sig.signer_id,
            signerName: sig.signer_name,
            signatureDigest: sig.signature_digest,
            challengeCode: sig.challenge_code,
            attestation: sig.attestation,
            signedAt: sig.signed_at,
          }
        : null;

    batch.set(approvalRef, {
      entryId: params.record.entry_id,
      orgId: params.orgId,
      caseRef: params.caseRef.slice(0, 64),
      amountAtStake: params.amountAtStake,
      workflowStatus: params.record.workflow_status,
      forensicsSigned: Boolean(params.record.forensics_signature),
      cfoSigned: Boolean(params.record.cfo_signature),
      forensicsSignature: mapSignature(params.record.forensics_signature),
      cfoSignature: mapSignature(params.record.cfo_signature),
      verificationCertificateHash:
        params.record.verification_certificate_hash ?? null,
      updatedByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const auditRef = doc(db, 'orgs', params.orgId, 'approval_audit', auditId);
    batch.set(auditRef, {
      auditId,
      orgId: params.orgId,
      entryId: params.record.entry_id,
      actorUid: uid,
      actorRole: params.actorRole,
      action: params.action,
      signatureDigest: params.signatureDigest,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, approvalPath);
  }
}

export function subscribeFirestoreApprovalCount(
  orgId: string,
  user: User | null,
  onCount: (count: number) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  if (!db || !user || !user.emailVerified) {
    return () => {};
  }
  const path = `orgs/${orgId}/ledger_approvals`;
  return onSnapshot(
    collection(db, 'orgs', orgId, 'ledger_approvals'),
    (snap) => {
      onCount(snap.size);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(
          wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
        );
      }
    },
  );
}
