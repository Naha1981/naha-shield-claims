// Fixed official sources only. User queries never become fetch URLs.
export const OFFICIAL_RESEARCH_SOURCES = [
  { match: /popia|personal information|automat|privacy|s(?:ection)?\s*71|consent/i, uri: 'https://justice.gov.za/legislation/acts/2013-004.pdf', title: 'Department of Justice: Protection of Personal Information Act 4 of 2013 (official published text)' },
  { match: /criminal|cpa|s300|s297|compensation|restitution/i, uri: 'https://justice.gov.za/legislation/acts/1977-051.pdf', title: 'Department of Justice: Criminal Procedure Act 51 of 1977 (official published text; amendments must be checked)' },
  { match: /fic|money laundering|s29|s53|suspicious/i, uri: 'https://www.fic.gov.za/wp-content/uploads/2023/10/Financial-Intelligence-Centre-Act-2001-Act-38-of-2001.pdf', title: 'Financial Intelligence Centre: FIC Act (published version; amendments must be checked)' },
  { match: /insurance|ppr|policyholder|funeral|claim/i, uri: 'https://www.gov.za/sites/default/files/gcis_document/201712/41321gon1407.pdf', title: 'Government Gazette: Long-term Policyholder Protection Rules, 2017 (original rules, not a current consolidation)' },
];

export function selectOfficialSources(query: string) {
  return OFFICIAL_RESEARCH_SOURCES.filter((s) => s.match.test(query)).slice(0, 2);
}

export async function fetchOfficialResearch(query: string) {
  const selected = selectOfficialSources(query);
  if (!selected.length) throw new Error('No matching official source is configured for this topic. Try POPIA, PPR, FIC Act or Criminal Procedure Act. No unsupported legal answer was generated.');
  const sources: Array<{ uri: string; title: string; fetched_at: string }> = [];
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const source of selected) {
    try {
      const response = await fetch(source.uri, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok || !response.body) continue;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 6 * 1024 * 1024) { await reader.cancel(); throw new Error('Official document exceeds safe fetch limit'); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) continue;
      parts.push({ inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } });
      sources.push({ uri: source.uri, title: source.title, fetched_at: new Date().toISOString() });
    } catch { /* A failed source is not represented as evidence. */ }
  }
  if (!sources.length) throw new Error('Official sources could not be fetched. No unsourced research answer was generated. Try again later.');
  return { sources, parts };
}

export async function extractResearchText(parts: Array<{ inlineData: { mimeType: string; data: string } }>, query: string) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const terms = query.toLowerCase().match(/[a-z]{4,}|\b\d{1,3}\b/g) || [];
  const passages: Array<{ text: string; score: number }> = [];
  for (const [documentIndex, part] of parts.entries()) {
    const loading = getDocument({ data: new Uint8Array(Buffer.from(part.inlineData.data, 'base64')), useSystemFonts: true, useWorkerFetch: false });
    const pdf = await loading.promise;
    try {
      for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 260); pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ');
        for (let start = 0; start < text.length; start += 1800) {
          const passage = text.slice(start, start + 2600);
          const lower = passage.toLowerCase();
          const score = terms.reduce((n, term) => n + (lower.includes(term) ? (/^\d+$/.test(term) ? (new RegExp('(?:^|\\s)' + term + '\\s').test(passage) ? 12 : 1) : (term === 'automated' || term === 'decisions' ? 5 : 1)) : 0), 0);
          passages.push({ text: `Source manifest item ${documentIndex + 1}, page ${pageNo}: ${passage}`, score });
        }
      }
    } finally { await loading.destroy(); }
  }
  return passages.sort((a, b) => b.score - a.score).slice(0, 5).map((p) => p.text).join('\n\n').slice(0, 14000);
}

// Never transmit raw user text to a free provider. Only a catalogue topic and optional statutory section leave the server.
export function safeResearchQuestion(query: string) {
  const topics = selectOfficialSources(query).map(s => s.title);
  if (!topics.length) throw new Error('No supported official topic found.');
  const section = query.match(/\b(?:section|s)\s*(\d{1,3})\b/i)?.[1];
  return 'Summarise the statutory requirements in ' + topics.join('; ') + (section ? ', section ' + Number(section) : '') + '. Research only, with citations and limitations. Do not decide a claim.';
}
