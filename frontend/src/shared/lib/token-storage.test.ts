import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStorage } from './token-storage';

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tokenStorage', () => {
  it('round-trips tokens and clears them', () => {
    tokenStorage.set(tokens);

    expect(tokenStorage.getAccessToken()).toBe('access-1');
    expect(tokenStorage.getRefreshToken()).toBe('refresh-1');

    tokenStorage.clear();

    expect(tokenStorage.getAccessToken()).toBeNull();
    expect(tokenStorage.getRefreshToken()).toBeNull();
  });

  it('notifies subscribers on set and clear', () => {
    const listener = vi.fn();
    const unsubscribe = tokenStorage.subscribe(listener);

    tokenStorage.set(tokens);
    tokenStorage.clear();

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    tokenStorage.set(tokens);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers when another tab writes tokens', () => {
    const listener = vi.fn();
    const unsubscribe = tokenStorage.subscribe(listener);

    // The `storage` event only fires in OTHER tabs. This is what makes
    // signing out in one tab take effect in the rest.
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'marketplace.accessToken' }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = tokenStorage.subscribe(listener);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'some.other.key' }),
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('degrades to a memory-less session when storage is unavailable', () => {
    // Safari private mode and locked-down browsers throw on access.
    // Booting without a persisted session beats crashing on load.
    //
    // Swaps the whole object rather than spying on its methods. The
    // polyfill in src/test/setup.ts is installed only on jsdom builds
    // whose localStorage is unusable, so on other builds the methods
    // live on Storage.prototype and an instance spy silently fails to
    // take effect — the storage would keep working and this test would
    // pass or fail depending on which machine ran it.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const unavailable = () => {
      throw new Error('storage disabled');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: unavailable,
        setItem: unavailable,
        removeItem: unavailable,
        clear: unavailable,
        key: unavailable,
        get length(): number {
          return unavailable();
        },
      },
    });

    try {
      expect(() => tokenStorage.set(tokens)).not.toThrow();
      expect(tokenStorage.getAccessToken()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });
});
