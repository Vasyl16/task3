import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../../shared/api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying a 4xx is pointless — a 404 stays a 404, and a 403
        // stays a 403 no matter how many times it's asked. 401 is
        // excluded too: the HTTP client already refreshes and retries it
        // once, so a 401 reaching here means the session is genuinely
        // gone. Only 5xx and network failures are worth another attempt.
        retry: (failureCount, error) => {
          if (
            isApiError(error) &&
            !error.isNetworkError &&
            error.status < 500
          ) {
            return false;
          }
          return failureCount < 2;
        },
        // Short rather than zero. This marketplace has stock and bids
        // that move underneath the user, so data goes stale quickly and
        // individual queries are expected to shorten this further or be
        // invalidated by a WebSocket event.
        staleTime: 10_000,
      },
      mutations: {
        // Never automatic. A retried checkout or bid is a second
        // business action, and deciding it is safe requires the
        // Idempotency-Key the backend supports — which is a per-call
        // decision, not a global default.
        retry: false,
      },
    },
  });
}
