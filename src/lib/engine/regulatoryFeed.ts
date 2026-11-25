export type RegulatoryTopic = 'all' | 'fsca' | 'popia';
export type RegulatorAuthority = 'FSCA' | 'POPIA' | 'Joint / ASISA';

export interface RegulatorySourceLink {
  uri: string;
  title: string;
}

export interface RegulatoryFeedItem {
  id: string;
  authority: RegulatorAuthority;
  title: string;
  published_period: string;
  summary: string;
  insurance_impact: string;
  source_url?: string;
  source_title?: string;
}

export type RegulatorySourceMode =
  | 'gemini-search-grounding'
  | 'open-source-rss-fallback';

export interface RegulatoryFeedResponse {
  topic: RegulatoryTopic;
  fetched_at: string;
  model: string;
  source_mode: RegulatorySourceMode;
  source_label: string;
  fallback_reason?: string;
  items: RegulatoryFeedItem[];
  sources: RegulatorySourceLink[];
  search_queries: string[];
}

export function normalizeRegulatoryTopic(raw: unknown): RegulatoryTopic {
  const val = String(raw || '').toLowerCase().trim();
  if (val === 'fsca') return 'fsca';
  if (val === 'popia') return 'popia';
  return 'all';
}

export function normalizeAuthority(
  raw: unknown,
  fallbackTopic: RegulatoryTopic,
): RegulatorAuthority {
  const s = String(raw || '').toUpperCase();
  if (s.includes('POPIA') || s.includes('INFORMATION REGULATOR') || s.includes('INFOREG')) {
    return 'POPIA';
  }
  if (s.includes('FSCA') || s.includes('PPR') || s.includes('CONDUCT')) {
    return 'FSCA';
  }
  if (s.includes('JOINT') || s.includes('ASISA') || s.includes('PA')) {
    return 'Joint / ASISA';
  }
  if (fallbackTopic === 'popia') return 'POPIA';
  if (fallbackTopic === 'fsca') return 'FSCA';
  return 'Joint / ASISA';
}

export function buildRegulatoryFeedPrompt(
  topic: RegulatoryTopic,
  asOfIsoDate: string,
): string {
  const focusClause =
    topic === 'fsca'
      ? 'Focus specifically on Financial Sector Conduct Authority (FSCA) updates, Policyholder Protection Rules (PPR), Conduct Standards, COFI Bill developments, Joint Standards (cybersecurity/IT governance), and FSCA funeral/life insurance notices in South Africa.'
      : topic === 'popia'
        ? 'Focus specifically on South Africa Information Regulator and POPIA updates (Protection of Personal Information Act regulations, direct marketing guidance, biometric/automated decision-making s71, cross-border data transfers s72, s57/58 prior authorisation, enforcement notices) affecting South African insurers.'
        : 'Cover both Financial Sector Conduct Authority (FSCA) updates (PPR, Conduct Standards, COFI, Joint Standards, funeral/life claims) AND South Africa Information Regulator / POPIA updates (regulations, direct marketing, s71 automated decisions, s57/58, data breaches) relevant to South African insurance companies.';

  return [
    `Today's date is ${asOfIsoDate}. Using Google Search, retrieve the latest verified South African insurance regulatory news and official updates from 2025 and 2026.`,
    focusClause,
    'Return ONLY a valid JSON array (no markdown commentary before or after) containing 4 to 5 recent, distinct items.',
    'Each object in the JSON array MUST use these exact keys:',
    '- "authority": one of "FSCA", "POPIA", or "Joint / ASISA"',
    '- "title": concise headline (max 14 words)',
    '- "published_period": publication date or month/year found in search results (e.g. "Oct 2026" or "2026-09-18")',
    '- "summary": 1-2 factual sentences summarizing the regulatory update without fabricating citations',
    '- "insurance_impact": 1 concise sentence explaining the operational impact on SA life/funeral insurers (claims, consent, fraud, IT governance, or data privacy)',
    '- "source_index": 0-based integer matching the primary search source if known, or null',
  ].join('\n');
}

export function extractGroundingMetadata(groundingMetadata: unknown): {
  sources: RegulatorySourceLink[];
  searchQueries: string[];
} {
  const meta = groundingMetadata as {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    webSearchQueries?: string[];
  } | null | undefined;

  const seen = new Set<string>();
  const sources: RegulatorySourceLink[] = [];
  for (const chunk of meta?.groundingChunks ?? []) {
    const uri = chunk?.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      uri,
      title: chunk?.web?.title?.trim() || uri,
    });
  }

  const searchQueries = (meta?.webSearchQueries ?? [])
    .map((q) => String(q).trim())
    .filter(Boolean);

  return { sources: sources.slice(0, 8), searchQueries };
}

function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return trimmed;
}

export function parseRegulatoryFeedResponse(
  rawText: string,
  sources: RegulatorySourceLink[],
  topic: RegulatoryTopic,
): RegulatoryFeedItem[] {
  const cleaned = stripJsonCodeFences(rawText);
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

    if (list && list.length > 0) {
      const normalized: RegulatoryFeedItem[] = [];
      for (let i = 0; i < list.length; i++) {
        const entry = list[i] as Record<string, unknown>;
        const title = String(entry?.title ?? '').trim();
        const summary = String(entry?.summary ?? '').trim();
        if (!title || !summary) continue;

        const srcIdx =
          typeof entry?.source_index === 'number' &&
          Number.isInteger(entry.source_index) &&
          entry.source_index >= 0 &&
          entry.source_index < sources.length
            ? entry.source_index
            : i < sources.length
              ? i
              : -1;
        const matchedSource = srcIdx >= 0 ? sources[srcIdx] : undefined;

        normalized.push({
          id: `REG-${topic.toUpperCase()}-${i + 1}`,
          authority: normalizeAuthority(
            entry?.authority ?? `${title} ${summary}`,
            topic,
          ),
          title,
          published_period: String(
            entry?.published_period ?? 'Recent Update',
          ).trim(),
          summary,
          insurance_impact: String(
            entry?.insurance_impact ??
              'Review against insurer compliance controls and policyholder workflows.',
          ).trim(),
          source_url: matchedSource?.uri,
          source_title: matchedSource?.title,
        });
      }
      if (normalized.length > 0) {
        return normalized.slice(0, 6);
      }
    }
  } catch {
    // Fall back to structured prose line parsing if model returned plain markdown
  }

  const blocks = rawText
    .split(/\n{2,}/)
    .map((b) => b.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((b) => b.length > 25);

  return blocks.slice(0, 5).map((block, idx) => {
    const firstSentenceEnd = block.search(/[.!?]\s|\n/);
    const rawTitle =
      firstSentenceEnd > 10 && firstSentenceEnd < 110
        ? block.slice(0, firstSentenceEnd).replace(/\*\*/g, '').trim()
        : `Regulatory Update ${idx + 1}`;
    const body = block.replace(/\*\*/g, '').trim();
    const matchedSource = sources[idx];

    return {
      id: `REG-${topic.toUpperCase()}-${idx + 1}`,
      authority: normalizeAuthority(body, topic),
      title: rawTitle,
      published_period: 'Live Search Result',
      summary: body,
      insurance_impact:
        'Assess alignment with FSCA Policyholder Protection Rules and POPIA governance.',
      source_url: matchedSource?.uri,
      source_title: matchedSource?.title,
    };
  });
}

export function formatRegulatoryFeedError(err: unknown): {
  statusCode: number;
  message: string;
} {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Failed to retrieve regulatory news feed.';

  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      const code = parsed?.error?.code;
      const status = parsed?.error?.status;
      const innerMessage = parsed?.error?.message?.trim();

      if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
        return {
          statusCode: 429,
          message:
            'Google Search grounding quota reached (429 RESOURCE_EXHAUSTED). Verify Gemini API quota or wait briefly, then click Retry Sync.',
        };
      }
      if (innerMessage) {
        return {
          statusCode: typeof code === 'number' && code >= 400 && code < 600 ? code : 502,
          message: innerMessage,
        };
      }
    } catch {
      // Non-JSON error message; fall through cleanly
    }
  }

  return {
    statusCode: 502,
    message: trimmed || 'Failed to retrieve regulatory news feed.',
  };
}

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

export function stripHtmlToPlainText(raw: string): string {
  const decoded = decodeXmlEntities(raw);
  return decodeXmlEntities(decoded.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeExternalHttpUrl(rawUrl: string): string | undefined {
  const trimmed = decodeXmlEntities(rawUrl).trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractXmlTag(block: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(regex);
  return match?.[1] ?? '';
}

function formatPubDateToPeriod(pubDateRaw: string): {
  label: string;
  timestampMs: number;
} {
  const cleaned = stripHtmlToPlainText(pubDateRaw);
  if (!cleaned) return { label: 'Recent Update', timestampMs: 0 };
  const ms = Date.parse(cleaned);
  if (!Number.isFinite(ms)) {
    return { label: cleaned.slice(0, 24), timestampMs: 0 };
  }
  return {
    label: new Date(ms).toISOString().slice(0, 10),
    timestampMs: ms,
  };
}

function deriveInsurerImpact(
  authority: RegulatorAuthority,
  text: string,
): string {
  const lower = text.toLowerCase();
  if (authority === 'POPIA') {
    if (lower.includes('security') || lower.includes('compromise') || lower.includes('breach')) {
      return 'Validate POPIA s22 security-compromise notification workflows and evidence-vault access controls.';
    }
    if (lower.includes('direct marketing') || lower.includes('consent') || lower.includes('paia')) {
      return 'Align out-of-band policyholder consent records, contact provenance, and PAIA reporting duties.';
    }
    return 'Review insurer lawful-basis records, s71 human-in-the-loop controls, and cross-border transfer rules.';
  }
  if (authority === 'FSCA') {
    if (lower.includes('claim') || lower.includes('funeral') || lower.includes('unauthorised')) {
      return 'Assess alignment with FSCA Policyholder Protection Rules (PPR), funeral claims SLAs, and intermediary oversight.';
    }
    if (lower.includes('cyber') || lower.includes('joint standard') || lower.includes('it ')) {
      return 'Benchmark insurer IT governance, forensic custody logs, and Joint Standard operational resilience.';
    }
    return 'Review FSCA conduct standards, treating-customers-fairly outcomes, and COFI transition readiness.';
  }
  return 'Cross-check against insurer compliance guardrails covering FSCA PPR, POPIA, and FIC Act governance.';
}

export interface ParsedRssCandidate extends RegulatoryFeedItem {
  timestamp_ms: number;
}

export function parseRssFeedXml(
  xml: string,
  defaultAuthority: RegulatorAuthority,
  feedSourceTitle: string,
): ParsedRssCandidate[] {
  const itemMatches = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  const results: ParsedRssCandidate[] = [];

  for (let i = 0; i < itemMatches.length; i++) {
    const block = itemMatches[i][1];
    const rawTitle = stripHtmlToPlainText(extractXmlTag(block, 'title'));
    const link = sanitizeExternalHttpUrl(extractXmlTag(block, 'link'));
    const pubDateRaw = extractXmlTag(block, 'pubDate');
    const sourcePublisher = stripHtmlToPlainText(extractXmlTag(block, 'source'));
    const rawDesc = stripHtmlToPlainText(extractXmlTag(block, 'description'));

    if (!rawTitle || rawTitle.length < 8) continue;

    // Clean trailing " - Publisher" from Google News titles when publisher is known
    let cleanTitle = rawTitle;
    if (sourcePublisher && cleanTitle.endsWith(` - ${sourcePublisher}`)) {
      cleanTitle = cleanTitle.slice(0, -(` - ${sourcePublisher}`.length)).trim();
    }

    const { label: publishedPeriod, timestampMs } =
      formatPubDateToPeriod(pubDateRaw);

    const combinedText = `${cleanTitle} ${rawDesc}`;
    const authority = normalizeAuthority(
      combinedText,
      defaultAuthority === 'POPIA'
        ? 'popia'
        : defaultAuthority === 'FSCA'
          ? 'fsca'
          : 'all',
    );

    let cleanedDesc = rawDesc;
    if (cleanedDesc.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
      cleanedDesc = cleanedDesc.slice(cleanTitle.length).trim();
    }
    if (
      sourcePublisher &&
      cleanedDesc.toLowerCase() === sourcePublisher.toLowerCase()
    ) {
      cleanedDesc = '';
    }

    const summaryText =
      cleanedDesc.length > 20
        ? cleanedDesc.length > 240
          ? `${cleanedDesc.slice(0, 237).trim()}...`
          : cleanedDesc
        : `Published by ${sourcePublisher || feedSourceTitle} · South African ${authority === 'POPIA' ? 'POPIA / Information Regulator' : authority === 'FSCA' ? 'FSCA / insurance conduct' : 'insurance regulatory'} coverage.`;

    results.push({
      id: `RSS-${authority.replace(/[^A-Z]/g, '')}-${i + 1}`,
      authority,
      title: cleanTitle,
      published_period: publishedPeriod,
      summary: summaryText,
      insurance_impact: deriveInsurerImpact(authority, combinedText),
      source_url: link,
      source_title: sourcePublisher || feedSourceTitle,
      timestamp_ms: timestampMs,
    });
  }

  return results;
}

interface OpenSourceFeedSource {
  url: string;
  label: string;
  defaultAuthority: RegulatorAuthority;
  topics: RegulatoryTopic[];
  requireInsuranceOrRegKeyword?: boolean;
}

const OPEN_SOURCE_FEEDS: OpenSourceFeedSource[] = [
  {
    url: 'https://inforegulator.org.za/feed/',
    label: 'Information Regulator SA (Official RSS)',
    defaultAuthority: 'POPIA',
    topics: ['all', 'popia'],
  },
  {
    url: 'https://news.google.com/rss/search?q=FSCA+South+Africa+insurance+OR+PPR&hl=en-ZA&gl=ZA&ceid=ZA:en',
    label: 'Google News ZA — FSCA & Insurance RSS',
    defaultAuthority: 'FSCA',
    topics: ['all', 'fsca'],
  },
  {
    url: 'https://news.google.com/rss/search?q=POPIA+%22Information+Regulator%22+South+Africa+insurance+OR+compliance&hl=en-ZA&gl=ZA&ceid=ZA:en',
    label: 'Google News ZA — POPIA & InfoReg RSS',
    defaultAuthority: 'POPIA',
    topics: ['all', 'popia'],
  },
  {
    url: 'https://www.gov.za/rss.xml',
    label: 'South African Government News (RSS)',
    defaultAuthority: 'Joint / ASISA',
    topics: ['all', 'fsca', 'popia'],
    requireInsuranceOrRegKeyword: true,
  },
];

export async function fetchOpenSourceRegulatoryFeed(
  topic: RegulatoryTopic,
  fallbackReason?: string,
): Promise<RegulatoryFeedResponse> {
  const selectedFeeds = OPEN_SOURCE_FEEDS.filter((f) =>
    f.topics.includes(topic),
  );

  const settled = await Promise.allSettled(
    selectedFeeds.map(async (feed) => {
      const resp = await fetch(feed.url, {
        headers: {
          'User-Agent': 'NahaShield-RegFeed/1.0 (+open-source-rss-fallback)',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) {
        throw new Error(`Feed ${feed.label} returned HTTP ${resp.status}`);
      }
      const xml = await resp.text();
      let parsed = parseRssFeedXml(xml, feed.defaultAuthority, feed.label);
      if (feed.requireInsuranceOrRegKeyword) {
        parsed = parsed.filter((item) =>
          /\b(fsca|popia|information regulator|insurance|insurer|financial sector|conduct authority|paia|fic act)\b/i.test(
            `${item.title} ${item.summary}`,
          ),
        );
      }
      return { feed, items: parsed };
    }),
  );

  const successfulFeeds: Array<{
    feed: OpenSourceFeedSource;
    items: ParsedRssCandidate[];
  }> = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value.items.length > 0) {
      successfulFeeds.push(res.value);
    }
  }

  if (successfulFeeds.length === 0) {
    throw new Error(
      'Both Gemini Google Search grounding and open-source public RSS feeds are currently unreachable.',
    );
  }

  const seenTitles = new Set<string>();
  const deduped: ParsedRssCandidate[] = [];

  for (const { items } of successfulFeeds) {
    const sorted = [...items].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    for (const item of sorted.slice(0, 6)) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      deduped.push(item);
    }
  }

  let finalItems: ParsedRssCandidate[] = [];
  if (topic === 'all') {
    const fscaItems = deduped
      .filter((i) => i.authority === 'FSCA')
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    const popiaItems = deduped
      .filter((i) => i.authority === 'POPIA')
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    const otherItems = deduped
      .filter((i) => i.authority === 'Joint / ASISA')
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms);

    const picked: ParsedRssCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      if (fscaItems[i]) picked.push(fscaItems[i]);
      if (popiaItems[i]) picked.push(popiaItems[i]);
    }
    for (const item of [...otherItems, ...deduped]) {
      if (picked.length >= 6) break;
      if (!picked.includes(item)) picked.push(item);
    }
    finalItems = picked.slice(0, 6);
  } else {
    const matching = deduped
      .filter((i) =>
        topic === 'fsca' ? i.authority === 'FSCA' : i.authority === 'POPIA',
      )
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    finalItems = (matching.length > 0 ? matching : deduped).slice(0, 6);
  }

  const cleanItems: RegulatoryFeedItem[] = finalItems.map(
    ({ timestamp_ms: _ts, ...rest }, idx) => ({
      ...rest,
      id: `OSS-${topic.toUpperCase()}-${idx + 1}`,
    }),
  );

  const sources: RegulatorySourceLink[] = [];
  const seenUris = new Set<string>();
  for (const item of cleanItems) {
    if (item.source_url && !seenUris.has(item.source_url)) {
      seenUris.add(item.source_url);
      sources.push({
        uri: item.source_url,
        title: item.source_title || item.title,
      });
    }
  }
  for (const { feed } of successfulFeeds) {
    if (!seenUris.has(feed.url) && sources.length < 6) {
      seenUris.add(feed.url);
      sources.push({ uri: feed.url, title: feed.label });
    }
  }

  return {
    topic,
    fetched_at: new Date().toISOString(),
    model: 'open-source-rss-aggregator',
    source_mode: 'open-source-rss-fallback',
    source_label: 'Open-Source RSS Fallback (InfoReg SA & ZA News)',
    fallback_reason: fallbackReason,
    items: cleanItems,
    sources: sources.slice(0, 6),
    search_queries: successfulFeeds.map((s) => s.feed.label),
  };
}


