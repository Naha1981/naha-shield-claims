import type { TippingOffLintResult } from './types';

export const BANNED_TIPPING_OFF_TERMS: Array<{
  pattern: RegExp;
  label: string;
}> = [
  { pattern: /\bSTR\b/i, label: 'STR' },
  {
    pattern: /\bsuspicious\s+transaction\s+report\b/i,
    label: 'suspicious transaction report',
  },
  { pattern: /\bFIC\b/i, label: 'FIC' },
  { pattern: /\bmoney\s+laundering\b/i, label: 'money laundering' },
  { pattern: /\bmurder\s+suspect\b/i, label: 'murder suspect' },
  { pattern: /\bpolice\s+investigation\b/i, label: 'police investigation' },
  { pattern: /\btipping[\s-]+off\b/i, label: 'tipping off' },
];

/**
 * FIC Act s29(4) / s53 Tipping-Off Linter.
 * Blocks any outbound claimant or consent message that discloses an STR,
 * FIC investigation, criminal suspicion, or coercive investigation.
 */
export function lintOutboundMessage(message: string): TippingOffLintResult {
  const violations: string[] = [];

  for (const rule of BANNED_TIPPING_OFF_TERMS) {
    if (rule.pattern.test(message)) {
      violations.push(rule.label);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
