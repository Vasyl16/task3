import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LoginRequest, RegisterRequest } from '../../../entities/session';
import {
  readAccessTokenExpiry,
  readSessionUser,
  sessionApi,
} from '../../../entities/session';
import { refreshAuthOnce } from '../../../shared/api';
import { isExpired, tokenStorage } from '../../../shared/lib';
import { reconnectRealtimeSocket } from '../../../shared/realtime';
import { AuthContext } from './auth-context';
import type { AuthContextValue } from './auth-context';

// A session is worth trying to restore when there's a refresh token but
// the access token is missing or already expired. Checked before the
// first paint so a reload lands on the page the user asked for, instead
// of bouncing through /login and back.
function needsRestore(): boolean {
  if (!tokenStorage.getRefreshToken()) return false;
  const accessToken = tokenStorage.getAccessToken();
  return !accessToken || isExpired(readAccessTokenExpiry(accessToken));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Tokens live in module-level storage, not React state, because the
  // HTTP client reads them outside of React. Subscribing here keeps the
  // UI in step with them — including when the change came from ANOTHER
  // tab, which is what makes logging out in one tab log out the rest.
  const accessToken = useSyncExternalStore(
    tokenStorage.subscribe,
    tokenStorage.getAccessToken,
  );

  const user = useMemo(
    () => (accessToken ? readSessionUser(accessToken) : null),
    [accessToken],
  );

  const [isRestoring, setIsRestoring] = useState(needsRestore);

  useEffect(() => {
    if (!needsRestore()) {
      setIsRestoring(false);
      return;
    }
    let cancelled = false;
    void refreshAuthOnce().finally(() => {
      if (!cancelled) setIsRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Whenever the identity changes — login, logout, or a session lost to
  // a failed refresh — drop every cached query and force a fresh socket
  // handshake. Without the cache clear, one user's orders would still be
  // sitting in the cache when the next user signs in on the same
  // browser; without the socket reconnect, the realtime connection would
  // keep using the PREVIOUS identity's token (or lack of one), silently
  // denying access to the new user's own private rooms.
  const previousUserId = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (previousUserId.current !== currentUserId) {
      previousUserId.current = currentUserId;
      queryClient.clear();
      reconnectRealtimeSocket();
    }
  }, [user?.id, queryClient]);

  const login = useCallback(async (credentials: LoginRequest) => {
    tokenStorage.set(await sessionApi.login(credentials));
  }, []);

  const register = useCallback(async (details: RegisterRequest) => {
    tokenStorage.set(await sessionApi.register(details));
  }, []);

  const logout = useCallback(async () => {
    try {
      await sessionApi.logout();
    } catch {
      // Best effort. The local session is cleared regardless — a user
      // who clicks "log out" while offline must still end up logged out
      // on this device, even though the server-side tokens survive until
      // they expire.
    } finally {
      tokenStorage.clear();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: isRestoring ? 'restoring' : user ? 'authenticated' : 'anonymous',
      user,
      login,
      register,
      logout,
    }),
    [isRestoring, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
