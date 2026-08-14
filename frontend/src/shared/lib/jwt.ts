// Reads the claims out of a JWT WITHOUT verifying its signature.
//
// This is safe here only because the result is used for presentation
// alone — which nav links to show, which route to redirect to. A forged
// token decoded here buys nothing: every protected read and write is
// authorized by the backend against the signature it verifies itself.
// Never use this to decide whether an action is *permitted*.

export function decodeJwtPayload<T>(token: string): T | null {
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    // JWT uses base64url; atob expects standard base64.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(json) as T;
  } catch {
    // A malformed or truncated token is treated as "no session" rather
    // than an error: it is usually a stale value left in localStorage by
    // an older build, and the user should just be asked to log in again.
    return null;
  }
}

export function isExpired(expiresAtSeconds: number | undefined): boolean {
  if (expiresAtSeconds === undefined) return false;
  return expiresAtSeconds * 1000 <= Date.now();
}
