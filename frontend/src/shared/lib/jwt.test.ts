import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isExpired } from './jwt';

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

describe('decodeJwtPayload', () => {
  it('reads the claims out of a token', () => {
    const token = makeToken({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'SELLER',
    });

    expect(decodeJwtPayload(token)).toEqual({
      sub: 'user-1',
      email: 'a@b.com',
      role: 'SELLER',
    });
  });

  it('handles base64url payloads containing - and _', () => {
    // Chosen so the base64 encoding contains both characters that
    // base64url substitutes; decoding without translating them back
    // throws instead of returning the claims.
    const token = makeToken({ sub: 'a>b?c>d?e' });

    expect(decodeJwtPayload<{ sub: string }>(token)?.sub).toBe('a>b?c>d?e');
  });

  it('decodes non-ASCII claims', () => {
    const token = makeToken({ sub: 'user-1', name: 'Ann Ostrowska' });

    expect(decodeJwtPayload<{ name: string }>(token)?.name).toBe(
      'Ann Ostrowska',
    );
  });

  it('returns null for a malformed token rather than throwing', () => {
    // A stale value left in localStorage by an older build must degrade
    // to "no session", not crash the app on boot.
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('a.!!!not-base64!!!.c')).toBeNull();
  });
});

describe('isExpired', () => {
  it('treats a past exp as expired and a future one as valid', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(isExpired(nowSeconds - 1)).toBe(true);
    expect(isExpired(nowSeconds + 60)).toBe(false);
  });

  it('treats a missing exp as not expired', () => {
    // A token without exp cannot be judged locally; the backend decides.
    expect(isExpired(undefined)).toBe(false);
  });
});
