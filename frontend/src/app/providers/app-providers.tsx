import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AuthProvider, installAuthIntoHttpClient } from '../../features/auth';
import { ToastProvider } from '../../shared/ui';
import { createQueryClient } from './query-client';
import { ErrorBoundary } from './error-boundary';

// Runs once at module load, before any component can issue a request.
// Doing it here rather than inside a component's effect means there is
// no window in which an early query could fire without an auth header.
installAuthIntoHttpClient();

// Provider order matters: AuthProvider calls useQueryClient (to drop
// cached data when the identity changes), so it must sit inside
// QueryClientProvider. ToastProvider sits above AuthProvider so a toast
// can in principle survive a logout/login transition; the router goes
// innermost because ProtectedRoute reads auth state.
export function AppProviders({ children }: { children: ReactNode }) {
  // Created in state, not at module scope, so each mounted app gets its
  // own client — otherwise tests would share one cache and leak data
  // between cases.
  const [queryClient] = useState(createQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
