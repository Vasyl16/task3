import { sessionApi } from '../../../entities/session';
import { configureHttpClient } from '../../../shared/api';
import { tokenStorage } from '../../../shared/lib';
import { configureRealtimeAuth } from '../../../shared/realtime';

// Wires the auth feature's concrete behaviour into the generic HTTP
// client and the realtime socket. This is the seam that keeps `shared/`
// from having to know anything about auth: the client calls these, it
// doesn't import them.

async function performRefresh(): Promise<boolean> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) return false;

  try {
    tokenStorage.set(await sessionApi.refresh(refreshToken));
    return true;
  } catch {
    // Any failure here is terminal for the session — an expired token, a
    // revoked one, or one the backend flagged as reused (which revokes
    // the whole family). Clearing rather than leaving the dead token in
    // place is what stops every later request from retrying it.
    tokenStorage.clear();
    return false;
  }
}

export function installAuthIntoHttpClient(): void {
  configureHttpClient({
    getAccessToken: () => tokenStorage.getAccessToken(),
    refresh: performRefresh,
    onAuthFailure: () => tokenStorage.clear(),
  });
  configureRealtimeAuth({
    getAccessToken: () => tokenStorage.getAccessToken(),
  });
}
