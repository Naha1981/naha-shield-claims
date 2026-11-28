import React from 'react';

// Branded first paint: shown by the server-rendered HTML before the bundle
// loads, and reused by App while workspace data loads, so a visitor sees one
// continuous branded loading state, then the dashboard. No landing page in
// between. Theme follows the inline data-theme script in index.html; the
// claimtrace-mark mask tints per theme in index.css.
export function BootSplash() {
  return (
    <div
      className="min-h-screen bg-[#0B1120] flex flex-col items-center justify-center gap-4 p-6"
      role="status"
      aria-label="Loading ClaimTrace"
    >
      <span aria-hidden="true" className="claimtrace-mark" style={{width: 56, height: 56}} />
      <div className="font-display text-xl font-bold tracking-tight text-white">ClaimTrace</div>
      <div className="text-sm text-slate-400">Loading your workspace…</div>
      <noscript>
        <p className="text-sm text-slate-400 text-center max-w-xs">
          JavaScript is off.{' '}
          <a className="underline text-sky-300" href="/review">
            Open the readable public review
          </a>
          .
        </p>
      </noscript>
    </div>
  );
}
