import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const OPTIONAL_AUTH_KEY = 'optionalAuth';

// Pairs with @Public(): the route stays open to anonymous callers, but a
// caller who DOES present a valid token is identified, so the handler can
// personalise the response.
//
// The alternative would be a second authenticated endpoint returning
// "your status on this thing", which means two round trips to render one
// page and two places for the projection rules to drift apart.
//
// An invalid or expired token on an @OptionalAuth() route is treated as
// no token at all rather than a 401 — the route is public, and failing it
// would make an expired session break pages that never needed one.
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

export function isOptionalAuth(context: ExecutionContext): boolean {
  return (
    new Reflector().getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? false
  );
}
