import type { KpiAuditNoteRecord } from './types';

export const MAX_KPI_AUDIT_NOTE_LENGTH = 400;

/**
 * POPIA s19 Data-Minimisation Sanitizer:
 * Masks accidental 13-digit SA ID numbers, email addresses, or SA phone numbers
 * before persisting notes or writing text into an exported governance report.
 */
export function sanitizePopiaText(input: string): string {
  return input
    .replace(/\b\d{13}\b/g, '[SA-ID-REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL-REDACTED]')
    .replace(
      /(?<!\d)(?:\+27\s?\d{2}|0[6-8]\d)[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g,
      '[PHONE-REDACTED]',
    );
}

export function normalizeKpiAuditNoteContent(raw: unknown): string {
  const collapsed = String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!collapsed) {
    throw new Error('Audit note cannot be empty.');
  }
  const clipped =
    collapsed.length > MAX_KPI_AUDIT_NOTE_LENGTH
      ? collapsed.slice(0, MAX_KPI_AUDIT_NOTE_LENGTH).trim()
      : collapsed;
  return sanitizePopiaText(clipped);
}

export function filterIncludedAuditNotesForPdf(
  notes: KpiAuditNoteRecord[] | undefined,
): KpiAuditNoteRecord[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((n) => n && n.include_in_pdf && n.content.trim().length > 0)
    .map((n) => ({
      ...n,
      content: sanitizePopiaText(n.content),
    }));
}
