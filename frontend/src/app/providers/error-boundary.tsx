import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from '../../shared/ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// The last line of defence, for errors thrown while RENDERING — a bug in
// a component, not a failed request. Failed requests are handled by
// TanStack Query and shown as ErrorState/ErrorAlert; if one of those
// reaches here, that is itself the bug.
//
// Still a class component: React provides no hook equivalent of
// componentDidCatch.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error-reporting service is wired up yet, so the console is the
    // only sink. Kept explicit rather than dropped, so a white screen in
    // development always leaves a trace to follow.
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="ui-centered-state" role="alert">
        <p>
          <strong>Something went wrong.</strong>
        </p>
        {/* A full reload rather than clearing the error state: the
            component tree that threw is of unknown validity, and
            re-rendering it usually just throws again. */}
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    );
  }
}
