import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// The app's env module throws at import time when these are missing, so
// the suite must not depend on a developer's local .env file existing.
// Only filled in when absent, so a real value still wins.
if (!import.meta.env.VITE_API_URL) {
  vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
}
if (!import.meta.env.VITE_WS_URL) {
  vi.stubEnv('VITE_WS_URL', 'ws://localhost:3000');
}

// This jsdom build exposes `window.localStorage` as a bare object with
// none of the Storage methods on it, so any call throws. Real browsers
// are fine; without a stand-in, every storage-backed test would exercise
// only tokenStorage's "storage unavailable" fallback and prove nothing.
if (typeof window.localStorage?.getItem !== 'function') {
  const entries = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) =>
        void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => [...entries.keys()][index] ?? null,
      get length() {
        return entries.size;
      },
    },
  });
}
