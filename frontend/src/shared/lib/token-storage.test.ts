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
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => tokenStorage.set(tokens)).not.toThrow();
    expect(tokenStorage.getAccessToken()).toBeNull();
  });
});
