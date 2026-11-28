import React from 'react';

/**
 * Inline cross-reference link used inside prose. Consistent accent, offset
 * underline, and hover/focus states so it reads as a designed control rather
 * than a raw browser link. Renders as a real link-styled button for in-app
 * navigation callbacks.
 */
export const InlineNavLink: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
}> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline font-medium text-sky-400 underline decoration-sky-500/40 underline-offset-2 rounded-sm transition-colors hover:text-sky-300 hover:decoration-sky-300 focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-2"
  >
    {children}
  </button>
);
