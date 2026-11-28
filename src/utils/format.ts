import type { RoleId } from '../lib/engine/types';

export function formatZar(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded).toLocaleString('en-ZA');
  return rounded < 0 ? `-R ${abs}` : `R ${abs}`;
}

export function formatZarCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `R ${(amount / 1_000_000).toFixed(2)}m`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `R ${(amount / 1_000).toFixed(0)}k`;
  }
  return formatZar(amount);
}

export function shortHash(hash: string): string {
  if (!hash || hash.length < 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export const ROLE_LABELS: Record<RoleId, string> = {
  head_of_forensics: 'Head of Forensics',
  legal_recoveries: 'Legal / Recoveries',
  finance_cfo: 'Finance / CFO',
  underwriter: 'Underwriter',
  compliance_dpo: 'Compliance / DPO',
};

export async function apiFetch<T>(
  url: string,
  role: RoleId,
  options?: RequestInit,
): Promise<T> {
  // Static preview mode (GitHub Pages): no server exists. State reads come from
  // the bundled snapshot; writes are simulated with clearly synthetic receipts so
  // every control still responds. Nothing here touches a real record.
  if (import.meta.env.VITE_STATIC_PREVIEW) {
    const method = (options?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url === '/api/state') {
      const res = await fetch(`${import.meta.env.BASE_URL}.data/state.json`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Static preview snapshot missing (${res.status})`);
      return data as T;
    }
    if (method !== 'GET') {
      if (url === '/api/decisions') {
        return { ok: true, decision: { decision_id: 'STATIC-PREVIEW-RECEIPT' } } as T;
      }
      if (url === '/api/audit/export-pdf') {
        return { ok: true, report_id: 'STATIC-PREVIEW-REPORT' } as T;
      }
      return { ok: true } as T;
    }
  }
  let accessCode = '';
  try { accessCode = localStorage.getItem('nahashield-access-code') ?? ''; } catch { /* storage unavailable */ }
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-nahashield-role': role,
      ...(accessCode ? { 'x-nahashield-access-code': accessCode } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed (${res.status})`,
    );
  }
  return data as T;
}
