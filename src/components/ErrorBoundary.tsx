import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-[60vh] items-center justify-center px-4">
            <div className="max-w-md rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center">
              <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {this.state.error?.message ?? "An unexpected error occurred while rendering this page."}
              </p>
              <button
                className="mt-4 rounded-lg border border-border/60 px-4 py-2 text-sm text-foreground hover:bg-background/40"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reload
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

