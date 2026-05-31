import React, { Component, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-cp-cream flex items-center justify-center p-8">
          <div className="bg-cp-paper border border-cp-line rounded-2xl p-8 max-w-md text-center shadow-lg">
            <AlertCircle className="w-12 h-12 text-cp-clay mx-auto mb-4" />
            <h1 className="text-xl font-serif font-bold text-cp-ink mb-2">שגיאה בלתי צפויה</h1>
            <p className="text-sm text-cp-ink-2 mb-4">
              משהו השתבש. נסו לרענן את הדף.
            </p>
            <p className="text-xs text-cp-ink-3 font-mono bg-cp-sand p-3 rounded-lg text-left" dir="ltr">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 bg-cp-clay hover:bg-cp-clay-deep text-white font-semibold py-2 px-6 rounded-full text-sm transition cursor-pointer"
            >
              רענן דף
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
