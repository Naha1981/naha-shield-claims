import { sanitizePopiaText } from './popia';

export type IngestionCaptureMode = 'drag_drop' | 'camera';

export type AllowedEvidenceMime =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'text/csv'
  | 'application/json'
  | 'text/plain';

export type InsuranceDocumentClass =
  | 'Death Notice / BI-1663'
  | 'Policy Schedule / Consent Record'
  | 'Claims Bordereaux (CSV)'
  | 'Structured Claim Record (JSON)'
  | 'Assessor Field Photo (Camera)'
  | 'Sheriff Return / Legal Process'
  | 'Bank / AVS-R Proof'
  | 'Insurance Document / Statement';

export interface IngestedAttachmentMeta {
  filename: string;
  mime_type: AllowedEvidenceMime;
  byte_size: number;
  binary_sha256: string;
  capture_mode: IngestionCaptureMode;
  document_class: InsuranceDocumentClass;
  pii_redactions_count: number;
  extracted_refs: string[];
  record_count: number | null;
}

export interface ProcessedEvidenceDocument {
  meta: IngestedAttachmentMeta;
  suggested_title: string;
  suggested_case_ref: string | null;
  extracted_summary: string;
  sanitized_note: string;
}

export const MAX_INGESTION_BYTES = 5 * 1024 * 1024; // 5 MB strict ceiling

export const ALLOWED_EVIDENCE_MIMES: ReadonlySet<AllowedEvidenceMime> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'application/json',
  'text/plain',
]);

export const ALLOWED_MIME_EXTENSIONS: Record<AllowedEvidenceMime, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'text/plain': ['.txt', '.log'],
};

const PROHIBITED_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeIngestionFilename(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() || 'document';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._]+/, '');
  const bounded = cleaned.slice(0, 110);
  return bounded || 'evidence_document';
}

export function normalizeAllowedMime(
  rawMime: string,
  filename: string,
): AllowedEvidenceMime | null {
  const mime = rawMime.trim().toLowerCase().split(';')[0];
  if (ALLOWED_EVIDENCE_MIMES.has(mime as AllowedEvidenceMime)) {
    return mime as AllowedEvidenceMime;
  }
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

export function verifyMagicBytes(
  bytes: Uint8Array,
  mime: AllowedEvidenceMime,
): { ok: boolean; reason?: string } {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'Empty file payload rejected.' };
  }
  if (bytes.byteLength > MAX_INGESTION_BYTES) {
    return {
      ok: false,
      reason: `File exceeds ${Math.round(MAX_INGESTION_BYTES / (1024 * 1024))} MB security limit.`,
    };
  }

  if (mime === 'application/pdf') {
    // %PDF-
    const isPdf =
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d;
    return isPdf
      ? { ok: true }
      : { ok: false, reason: 'PDF signature (%PDF-) verification failed.' };
  }

  if (mime === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ok =
      bytes.length >= sig.length && sig.every((b, idx) => bytes[idx] === b);
    return ok
      ? { ok: true }
      : { ok: false, reason: 'PNG file header signature verification failed.' };
  }

  if (mime === 'image/jpeg') {
    const ok =
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    return ok
      ? { ok: true }
      : { ok: false, reason: 'JPEG SOI marker verification failed.' };
  }

  if (mime === 'image/webp') {
    const ok =
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    return ok
      ? { ok: true }
      : { ok: false, reason: 'WebP RIFF header verification failed.' };
  }

  // Text-based formats: block NUL bytes (binary masquerading as CSV/JSON/TXT)
  const checkLen = Math.min(bytes.length, 8192);
  for (let i = 0; i < checkLen; i += 1) {
    if (bytes[i] === 0x00) {
      return {
        ok: false,
        reason: 'Unexpected binary NUL byte in text/structured claim record.',
      };
    }
  }
  return { ok: true };
}

export function classifyInsuranceDocument(params: {
  filename: string;
  mime: AllowedEvidenceMime;
  captureMode: IngestionCaptureMode;
  textSample?: string;
}): InsuranceDocumentClass {
  if (params.mime === 'text/csv') {
    return 'Claims Bordereaux (CSV)';
  }
  if (params.mime === 'application/json') {
    return 'Structured Claim Record (JSON)';
  }
  const hay = `${params.filename} ${params.textSample ?? ''}`.toLowerCase();
  if (
    hay.includes('1663') ||
    hay.includes('dha') ||
    hay.includes('death') ||
    hay.includes('mortuary') ||
    hay.includes('parlour')
  ) {
    return 'Death Notice / BI-1663';
  }
  if (hay.includes('sheriff') || hay.includes('summons') || hay.includes('judgment')) {
    return 'Sheriff Return / Legal Process';
  }
  if (hay.includes('avs') || hay.includes('bank') || hay.includes('eft') || hay.includes('proof')) {
    return 'Bank / AVS-R Proof';
  }
  if (hay.includes('consent') || hay.includes('policy') || hay.includes('schedule')) {
    return 'Policy Schedule / Consent Record';
  }
  if (params.captureMode === 'camera') {
    return 'Assessor Field Photo (Camera)';
  }
  return 'Insurance Document / Statement';
}

export function extractInsuranceReferences(text: string): string[] {
  const matches =
    text.match(/\b(?:SYN-RC-\d+|SYN-POL-\d+|CLM-[A-Z0-9-]+|POL-[A-Z0-9-]+)\b/g) ??
    [];
  return Array.from(new Set(matches)).slice(0, 8);
}

function redactAndCountPii(rawText: string): {
  masked: string;
  redactionCount: number;
} {
  const masked = sanitizePopiaText(rawText);
  const redactionCount = (
    masked.match(/\[(?:SA-ID|EMAIL|PHONE)-REDACTED\]/g) ?? []
  ).length;
  return { masked, redactionCount };
}

function parseCsvSummary(rawText: string): {
  recordCount: number;
  headers: string[];
  previewText: string;
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { recordCount: 0, headers: [], previewText: 'Empty CSV file' };
  }
  const headers = lines[0]
    .split(',')
    .map((h) => h.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
    .slice(0, 12);
  const recordCount = Math.max(0, lines.length - 1);
  const sampleRows = lines.slice(1, 4).join(' | ');
  return {
    recordCount,
    headers,
    previewText: `${recordCount} data row(s); columns [${headers.join(', ')}]${sampleRows ? `; sample: ${sampleRows}` : ''}`,
  };
}

function sanitizeJsonValue(val: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(val)) {
    return val.slice(0, 20).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (PROHIBITED_JSON_KEYS.has(k)) continue;
      out[k] = sanitizeJsonValue(v, depth + 1);
    }
    return out;
  }
  return val;
}

function parseJsonSummary(rawText: string): {
  recordCount: number;
  previewText: string;
} {
  const parsed = JSON.parse(rawText) as unknown;
  const safe = sanitizeJsonValue(parsed);
  if (Array.isArray(safe)) {
    const keys =
      safe[0] && typeof safe[0] === 'object'
        ? Object.keys(safe[0] as Record<string, unknown>).slice(0, 10)
        : [];
    return {
      recordCount: safe.length,
      previewText: `JSON array (${safe.length} record(s))${keys.length ? `; fields [${keys.join(', ')}]` : ''}: ${JSON.stringify(safe.slice(0, 2)).slice(0, 240)}`,
    };
  }
  if (safe && typeof safe === 'object') {
    const keys = Object.keys(safe as Record<string, unknown>);
    return {
      recordCount: 1,
      previewText: `JSON object (${keys.length} fields: ${keys.slice(0, 10).join(', ')}): ${JSON.stringify(safe).slice(0, 260)}`,
    };
  }
  return {
    recordCount: 1,
    previewText: `JSON scalar value: ${String(safe).slice(0, 120)}`,
  };
}

export function processEvidencePayload(params: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  binarySha256: string;
  captureMode: IngestionCaptureMode;
  investigatorNote?: string;
  imageDimensions?: { width: number; height: number } | null;
}): ProcessedEvidenceDocument {
  const safeFilename = sanitizeIngestionFilename(params.filename);
  const mime = normalizeAllowedMime(params.mimeType, safeFilename);
  if (!mime) {
    throw new Error(
      'Unsupported file format. Allowed formats: PDF, PNG, JPEG, WebP, CSV, JSON, TXT.',
    );
  }

  const magicCheck = verifyMagicBytes(params.bytes, mime);
  if (!magicCheck.ok) {
    throw new Error(magicCheck.reason || 'File header validation failed.');
  }

  let rawExtract = '';
  let recordCount: number | null = null;

  if (mime === 'text/csv') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    const csvInfo = parseCsvSummary(text);
    recordCount = csvInfo.recordCount;
    rawExtract = csvInfo.previewText;
  } else if (mime === 'application/json') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    try {
      const jsonInfo = parseJsonSummary(text);
      recordCount = jsonInfo.recordCount;
      rawExtract = jsonInfo.previewText;
    } catch {
      throw new Error('Malformed JSON claim record rejected.');
    }
  } else if (mime === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(params.bytes);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    recordCount = lines.length;
    rawExtract = `Text statement (${lines.length} non-empty line(s)): ${lines.slice(0, 4).join(' ').slice(0, 280)}`;
  } else if (mime === 'application/pdf') {
    const ascii = new TextDecoder('latin1').decode(params.bytes);
    const versionMatch = ascii.match(/^%PDF-(\d+\.\d+)/);
    const pageMatches = ascii.match(/\/Type\s*\/Page\b/g);
    const pages = pageMatches ? pageMatches.length : 1;
    recordCount = pages;
    // Extract readable title/subject text segments if uncompressed
    const titleMatch = ascii.match(/\/Title\s*\(([^()]{2,80})\)/);
    rawExtract = `PDF v${versionMatch?.[1] ?? '1.x'} (${pages} page marker(s), ${params.bytes.byteLength.toLocaleString('en-US')} bytes)${titleMatch ? ` · Embedded Title: ${titleMatch[1]}` : ''}`;
  } else {
    const dims =
      params.imageDimensions &&
      params.imageDimensions.width > 0 &&
      params.imageDimensions.height > 0
        ? ` (${params.imageDimensions.width}x${params.imageDimensions.height}px)`
        : '';
    rawExtract = `${params.captureMode === 'camera' ? 'Live camera optical capture' : 'Image scan'} [${mime}]${dims}, ${params.bytes.byteLength.toLocaleString('en-US')} bytes`;
  }

  const fullTextForScanning =
    mime === 'text/csv' || mime === 'application/json' || mime === 'text/plain'
      ? new TextDecoder('utf-8', { fatal: false }).decode(params.bytes)
      : rawExtract;

  const extractedRefs = extractInsuranceReferences(
    `${safeFilename} ${fullTextForScanning} ${params.investigatorNote ?? ''}`,
  );
  const docClass = classifyInsuranceDocument({
    filename: safeFilename,
    mime,
    captureMode: params.captureMode,
    textSample: fullTextForScanning.slice(0, 2000),
  });

  const { masked: maskedExtract, redactionCount: extractRedactions } =
    redactAndCountPii(rawExtract);
  const { masked: maskedNote, redactionCount: noteRedactions } =
    redactAndCountPii((params.investigatorNote ?? '').trim().slice(0, 400));

  const totalRedactions = extractRedactions + noteRedactions;
  const modeLabel =
    params.captureMode === 'camera' ? 'Camera Capture' : 'Drag-and-Drop';
  const refNote =
    extractedRefs.length > 0 ? ` · Refs: ${extractedRefs.join(', ')}` : '';
  const piiNote =
    totalRedactions > 0
      ? ` · POPIA s19 masked ${totalRedactions} PII token(s)`
      : '';
  const noteSuffix = maskedNote ? ` · Investigator note: ${maskedNote}` : '';

  const extractedSummary = `[${docClass} · ${modeLabel}] File "${safeFilename}" (${params.bytes.byteLength} B, binary SHA-256 ${params.binarySha256.slice(0, 16)}…). ${maskedExtract}${refNote}${piiNote}${noteSuffix}`;

  const suggestedTitle =
    params.captureMode === 'camera'
      ? `${docClass} — ${safeFilename}`
      : `${docClass}: ${safeFilename}`;

  return {
    meta: {
      filename: safeFilename,
      mime_type: mime,
      byte_size: params.bytes.byteLength,
      binary_sha256: params.binarySha256,
      capture_mode: params.captureMode,
      document_class: docClass,
      pii_redactions_count: totalRedactions,
      extracted_refs: extractedRefs,
      record_count: recordCount,
    },
    suggested_title: suggestedTitle.slice(0, 120),
    suggested_case_ref: extractedRefs[0] ?? null,
    extracted_summary: extractedSummary,
    sanitized_note: maskedNote,
  };
}
