import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  Newspaper,
  RefreshCw,
} from 'lucide-react';
import type {
  RegulatorAuthority,
  RegulatoryFeedResponse,
  RegulatoryTopic,
} from '../lib/engine/regulatoryFeed';
import type { RoleId } from '../lib/engine/types';
import { apiFetch } from '../utils/format';
import type { NavRoute } from './LayoutShell';

interface RegulatoryNewsFeedWidgetProps {
  activeRole: RoleId;
  onNavigate?: (route: NavRoute) => void;
  onSynced?: () => Promise<void>;
}

const TOPIC_TABS: Array<{ id: RegulatoryTopic; label: string }> = [
  { id: 'all', label: 'All Updates' },
  { id: 'fsca', label: 'FSCA & PPR' },
  { id: 'popia', label: 'POPIA & InfoReg' },
];

function getAuthorityTone(authority: RegulatorAuthority): string {
  if (authority === 'FSCA') return 'text-emerald-400';
  if (authority === 'POPIA') return 'text-amber-300';
  return 'text-sky-300';
}

export const RegulatoryNewsFeedWidget: React.FC<
  RegulatoryNewsFeedWidgetProps
> = ({ activeRole, onNavigate, onSynced }) => {
  const [topic, setTopic] = React.useState<RegulatoryTopic>('all');
  const [feed, setFeed] = React.useState<RegulatoryFeedResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchFeed = React.useCallback(
    async (selectedTopic: RegulatoryTopic, forceRefresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ topic: selectedTopic });
        if (forceRefresh) qs.set('refresh', '1');
        const data = await apiFetch<RegulatoryFeedResponse>(
          `/api/ai/regulatory-feed?${qs.toString()}`,
          activeRole,
        );
        setFeed(data);
        if (forceRefresh && onSynced) {
          await onSynced();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to fetch live FSCA & POPIA regulatory updates.',
        );
      } finally {
        setLoading(false);
      }
    },
    [activeRole, onSynced],
  );

  React.useEffect(() => {
    fetchFeed(topic, false);
  }, [topic, fetchFeed]);

  const fetchedTimeLabel = feed?.fetched_at
    ? `${feed.fetched_at.slice(0, 10)} ${feed.fetched_at.slice(11, 16)}Z`
    : null;

  return (
    <section
      aria-label="Regulatory News Feed"
      className="rounded-md bg-[#131C31] border border-slate-800 p-4 sm:p-5 space-y-4"
    >
      {/* Header + Topic Filter + Refresh Action */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Newspaper className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base font-semibold text-white">
              Regulatory News Feed
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span>
              Live FSCA &amp; POPIA updates for South African insurers
            </span>
            {feed?.source_label && !loading && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    feed.source_mode === 'open-source-rss-fallback'
                      ? 'text-sky-300 font-medium'
                      : 'text-emerald-400 font-medium'
                  }
                >
                  {feed.source_label}
                </span>
              </>
            )}
            {fetchedTimeLabel && !loading && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  Synced {fetchedTimeLabel}
                </span>
              </>
            )}
          </div>
          {feed?.source_mode === 'open-source-rss-fallback' &&
            feed.fallback_reason &&
            !loading && (
              <p className="text-[11px] text-slate-400">
                Using free open-source public RSS feeds (Information Regulator SA &amp; Google News ZA RSS). Primary Gemini grounding paused: {feed.fallback_reason}
              </p>
            )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div
            role="group"
            aria-label="Filter regulatory feed by authority"
            className="inline-flex items-center gap-1 p-1 rounded-md bg-slate-900 border border-slate-800"
          >
            {TOPIC_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                disabled={loading}
                onClick={() => setTopic(tab.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  topic === tab.id
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => fetchFeed(topic, true)}
            aria-label={loading?'Syncing...':'Refresh'}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${loading ? 'animate-spin' : ''}`}
            />
            {loading ? 'Syncing...' : 'Refresh Feed'}
          </button>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {loading && (
        <div
          aria-busy="true"
          role="status" aria-label="Loading regulatory updates"
          className="grid grid-cols-1 lg:grid-cols-2 gap-3"
        >
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 space-y-2.5 animate-pulse"
            >
              <div className="h-3 w-36 bg-slate-800 rounded" />
              <div className="h-4 w-3/4 bg-slate-800 rounded" />
              <div className="h-3 w-full bg-slate-800/80 rounded" />
              <div className="h-3 w-5/6 bg-slate-800/70 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Explicit Error State (never masked with mock items) */}
      {!loading && error && (
        <div
          role="alert"
          className="p-4 rounded-md bg-amber-950/40 border border-amber-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-100">
                Live Regulatory Search Unavailable
              </div>
              <p className="text-amber-200/90 mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchFeed(topic, true)}
            className="px-3 py-1.5 rounded border border-amber-500/50 bg-amber-900/50 hover:bg-amber-900 text-amber-100 font-medium whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            Retry Sync
          </button>
        </div>
      )}

      {/* Populated Regulatory Items */}
      {!loading && !error && feed && (
        <>
          {feed.items.length === 0 ? (
            <div className="p-4 rounded-md bg-[#0F172A] border border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>No regulatory updates matched the selected filter.</span>
              <button
                type="button"
                onClick={() => setTopic('all')}
                className="text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap"
              >
                Show All Updates
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {feed.items.map((item) => (
                <article
                  key={item.id}
                  className="p-3.5 rounded-md bg-[#0F172A] border border-slate-800 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1.5">
                    {/* Unboxed typographic metadata (Zero-Pill discipline) */}
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`font-mono font-semibold ${getAuthorityTone(item.authority)}`}
                        >
                          {item.authority}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-slate-400 tabular-nums">
                          {item.published_period}
                        </span>
                      </div>
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open source for ${item.title}`}
                          className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                        >
                          <span>Source</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <h3 className="text-sm font-semibold text-white leading-snug">
                      {item.title}
                    </h3>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {item.summary}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                    <span className="text-slate-300 font-medium">
                      SA Insurer Impact:{' '}
                    </span>
                    {item.insurance_impact}
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Grounded Source Links & Compliance Research Shortcut */}
          <div className="pt-2 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400 min-w-0">
              <span className="font-medium text-slate-300 shrink-0">
                Grounded sources ({feed.sources.length}):
              </span>
              {feed.sources.length === 0 ? (
                <span>Search metadata verified</span>
              ) : (
                feed.sources.slice(0, 4).map((src) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-400 hover:underline max-w-[220px] truncate"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="truncate">{src.title || src.uri}</span>
                  </a>
                ))
              )}
            </div>

            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/compliance')}
                className="text-xs font-medium text-slate-300 hover:text-white inline-flex items-center gap-1 whitespace-nowrap shrink-0 self-start lg:self-auto"
              >
                <span>Open Regulatory Research</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
