import React from 'react';

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
      message: error?.message || 'An unexpected error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#FAFBFD] p-6 text-[#1C1D33]">
          <div className="w-full max-w-md rounded-2xl border border-[#E2E4F0] bg-white p-7">
            <p className="text-xs font-semibold text-[#9B2B22]">Application error</p>
            <h1 className="mt-1.5 text-xl font-bold text-[#1C1D33]">Something went wrong</h1>
            <p className="mt-2 break-words text-sm leading-relaxed text-[#555870]">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 h-10 w-full rounded-xl bg-[#5B42DC] text-sm font-semibold text-white hover:bg-[#4931C2] cursor-pointer"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
