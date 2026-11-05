import { Component, type ErrorInfo, type ReactNode } from 'react';

type RouteErrorBoundaryProps = {
  /** Changing this (the current path) clears a caught error, so navigating away recovers. */
  readonly resetKey: string;
  readonly children: ReactNode;
};

type RouteErrorBoundaryState = {
  readonly error: Error | null;
  readonly resetKey: string;
};

/**
 * Keeps a render error in one route (for example a Convex `useQuery` that
 * throws) from blanking the whole app, and offers a way back.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<RouteErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Route render failed:', error, info.componentStack);
  }

  private readonly retry = () => this.setState({ error: null });

  override render() {
    if (!this.state.error) return this.props.children;
    return <RouteErrorFallback onRetry={this.retry} />;
  }
}

export function RouteErrorFallback({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div role="alert" className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-[420px] mx-4 bg-surface border border-border rounded-default p-6 text-center">
        <h1 className="text-[15px] font-semibold text-text mb-2">Something went wrong</h1>
        <p className="text-[13px] text-secondary mb-4">
          This page hit an unexpected error. Try again, or head back to your dashboard.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="text-[13px] px-3.5 py-1.5 rounded-default border-none bg-text text-bg cursor-pointer font-medium"
          >
            Try again
          </button>
          {/* A full load, not a client navigation: it also rebuilds whatever
            client state (Convex, auth) the failing render left behind. */}
          <a
            href="/dashboard"
            className="text-[13px] px-3.5 py-1.5 rounded-default border border-border bg-transparent text-text font-medium no-underline transition-colors duration-150 hover:bg-hover"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
