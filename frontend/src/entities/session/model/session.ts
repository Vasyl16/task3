import { decodeJwtPayload } from '../../../shared/lib/jwt';

// Mirrors the backend's UserRole enum. A union of string literals rather
// than a TS enum because tsconfig sets `erasableSyntaxOnly`, which bans
// enums — and because the values arrive as plain JSON strings anyway.
export type UserRole = 'CUSTOMER' | 'SELLER' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
}

// The claims the backend puts in an access token (see
// AuthService.issueTokens): { sub, email, role } plus the standard
// registered claims.
interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  exp?: number;
}

// Identity is read out of the access token instead of from a /me
// request, because the backend already puts it there and an extra
// round trip on every page load would buy nothing. The signature is not
// checked here — see shared/lib/jwt — so this is only ever used to
// decide what to DISPLAY. Every actual permission is enforced server
// side against the token's verified signature.
export function readSessionUser(accessToken: string): SessionUser | null {
  const claims = decodeJwtPayload<AccessTokenClaims>(accessToken);
  if (!claims?.sub || !claims.email || !claims.role) return null;

  return { id: claims.sub, email: claims.email, role: claims.role };
}

export function readAccessTokenExpiry(accessToken: string): number | undefined {
  return decodeJwtPayload<AccessTokenClaims>(accessToken)?.exp;
}
