import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error.',
    };
  }

  override componentDidCatch(error: Error): void {
    console.error('[NahaShield ErrorBoundary]', error);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  override render() {
    if (this.state.hasError) {
      let friendlyMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed?.error) {
          friendlyMessage = `Database permission or sync error (${parsed.operationType ?? 'operation'} at ${parsed.path ?? 'unknown'}): ${parsed.error}`;
        }
      } catch {
        // Plain error message
      }

      return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-md bg-[#131C31] border border-red-500/40 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold text-white">
                  Workspace Recovery Triggered
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {friendlyMessage}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="px-3.5 py-2 rounded border border-emerald-500/40 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 text-xs font-semibold inline-flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
