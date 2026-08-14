// The single source of truth for the current session's tokens.
//
// It lives in `shared/` rather than in the auth feature because the HTTP
// client needs to read tokens on every request, and `shared/` may not
// import upward from `features/`. Keeping the tokens here — and having
// React subscribe to them rather than own them — is what lets the layer
// direction stay one-way.
//
// localStorage rather than an httpOnly cookie is a deliberate trade-off:
// the backend issues bearer tokens over CORS with no cookie/CSRF
// machinery, so a cookie would require backend changes. The cost is that
// a successful XSS can read the tokens; the mitigations that matter are
// therefore short access-token lifetimes (15m) and refresh rotation with
// reuse detection, both of which the backend already implements.

const ACCESS_TOKEN_KEY = 'marketplace.accessToken';
const REFRESH_TOKEN_KEY = 'marketplace.refreshToken';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Fires on writes from OTHER tabs only (the `storage` event never fires
// in the tab that made the change), which is exactly what's needed to
// keep a second tab from continuing to render a logged-in UI after this
// one logs out. Same-tab writes notify through set/clear below.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === ACCESS_TOKEN_KEY || event.key === REFRESH_TOKEN_KEY) {
      notify();
    }
  });
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari in private mode, and any browser with storage disabled,
    // throws on access. Degrading to a memory-less session is better
    // than crashing the app on boot.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // See read() — a failed persist means the session won't survive a
    // reload, which is recoverable; throwing here would not be.
  }
}

// Arrow properties rather than shorthand methods throughout: these get
// passed around detached (useSyncExternalStore takes `subscribe` and
// `getAccessToken` as bare references), and a method that relied on
// `this` would break the moment it was.
export const tokenStorage = {
  getAccessToken: (): string | null => read(ACCESS_TOKEN_KEY),
  getRefreshToken: (): string | null => read(REFRESH_TOKEN_KEY),

  set: (tokens: AuthTokens): void => {
    write(ACCESS_TOKEN_KEY, tokens.accessToken);
    write(REFRESH_TOKEN_KEY, tokens.refreshToken);
    notify();
  },

  clear: (): void => {
    write(ACCESS_TOKEN_KEY, null);
    write(REFRESH_TOKEN_KEY, null);
    notify();
  },

  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
