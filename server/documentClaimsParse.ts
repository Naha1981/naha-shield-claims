import { mapHeaders, CANONICAL_COLUMNS } from '../src/lib/engine/claimsFileIngest';

// Reads claims tables out of PDF exports and scanned documents.
// Digital PDFs: text extraction with the bundled pdfjs-dist (open source).
// Scans and photos: OCR with tesseract.js (open source), loaded lazily so the
// server never depends on it at startup. Table reading is best-effort: the
// File check card shows exactly which columns were understood, so a misread
// table is visible before any finding is trusted.

// Turns extracted text lines into header + row records. A line becomes the
// header when at least two of its cells are recognisable claim columns; the
// rows after it are the claims.
export function tableTextToRows(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const splitLine = (line: string): string[] => {
    // Cells are separated by pipes, tabs or runs of 2+ spaces. A plain CSV
    // line (single spaces inside values, commas between cells) also works.
    if (line.includes('|')) return line.split('|').map((c) => c.trim());
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((c) => c.trim());
    if (line.includes(',')) return line.split(',').map((c) => c.trim());
    return [line];
  };
  let headers: string[] | null = null;
  const rows: Array<Record<string, string>> = [];
  for (const line of lines) {
    const cells = splitLine(line);
    if (!headers) {
      if (cells.length >= 2) {
        const mapping = mapHeaders(cells);
        if (Object.keys(mapping.matched).length >= 2 && mapping.matched.claim_ref) {
          headers = cells;
        }
      }
      continue;
    }
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      if (h) rec[h] = v;
      if (v) any = true;
    });
    if (any && cells.length >= 2) rows.push(rec);
  }
  if (!headers) throw new Error('No claims table found in this document. A table with a claim number column is needed.');
  return { headers, rows };
}

export async function pdfToText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group text items into lines by their vertical position, order by x.
    const lines = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round((item as { transform: number[] }).transform[5] / 3);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x: (item as { transform: number[] }).transform[4], str: item.str });
    }
    const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of sorted) {
      items.sort((a, b) => a.x - b.x);
      out.push(items.map((i) => i.str.trim()).join('  '));
    }
  }
  await loadingTask.destroy();
  return out.join('\n');
}

// Rebuilds table columns from word coordinates: OCR gives every word a
// position, and a gap clearly wider than normal word spacing marks a new
// column. Cells are joined with 3 spaces so tableTextToRows can split them.
// Best-effort: the File check card shows exactly which columns were read, so
// a misread table is visible before any finding is trusted.
export function tsvToColumnText(tsv: string): string {
  type Word = { top: number; left: number; width: number; text: string };
  const lines = new Map<string, Word[]>();
  for (const raw of tsv.split('\n').slice(1)) {
    const f = raw.split('\t');
    if (f.length < 12 || f[0] !== '5') continue; // level 5 = word
    const text = f[11].trim();
    if (!text) continue;
    const key = `${f[2]}-${f[3]}-${f[4]}`; // block-par-line
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push({ top: Number(f[7]), left: Number(f[6]), width: Number(f[8]), text });
  }
  const groups = [...lines.values()].map((ws) => ws.sort((a, b) => a.left - b.left));
  groups.sort((a, b) => Math.min(...a.map((w) => w.top)) - Math.min(...b.map((w) => w.top)));
  const gaps: number[] = [];
  for (const ws of groups) {
    for (let i = 1; i < ws.length; i++) gaps.push(ws[i].left - (ws[i - 1].left + ws[i - 1].width));
  }
  const positive = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  // Typical word spacing is the first quartile; a column gap is clearly wider.
  const q1 = positive.length ? positive[Math.floor(positive.length / 4)] : 8;
  const columnGap = Math.max(q1 * 2.5, 30);
  return groups
    .map((ws) => {
      const cells: string[] = [ws[0].text];
      for (let i = 1; i < ws.length; i++) {
        const gap = ws[i].left - (ws[i - 1].left + ws[i - 1].width);
        if (gap > columnGap) cells.push(ws[i].text);
        else cells[cells.length - 1] += ' ' + ws[i].text;
      }
      return cells.join('   ');
    })
    .join('\n');
}

export async function ocrImageToText(buffer: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(buffer, {}, { tsv: true });
    const tsv = (result.data as { tsv?: string }).tsv;
    if (tsv) return tsvToColumnText(tsv);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

export type DocumentParseResult = {
  kind: 'pdf-text' | 'pdf-scan' | 'image-ocr';
  headers: string[];
  rows: Array<Record<string, string>>;
  pages_or_engine: string;
};

export async function documentToRows(buffer: Buffer, fileName: string): Promise<DocumentParseResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const text = await pdfToText(buffer);
    try {
      const table = tableTextToRows(text);
      return { kind: 'pdf-text', ...table, pages_or_engine: 'pdfjs text layer' };
    } catch {
      // A scanned PDF has no text layer: fall through to OCR page images.
      throw new Error('This PDF has no readable text layer (it is probably a scan). Export the pages as images (PNG/JPG) and upload those: OCR reads them.');
    }
  }
  if (/\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(lower)) {
    const text = await ocrImageToText(buffer);
    const table = tableTextToRows(text);
    return { kind: 'image-ocr', ...table, pages_or_engine: 'tesseract OCR' };
  }
  throw new Error('Supported documents: PDF, PNG, JPG, WEBP, TIFF.');
}
