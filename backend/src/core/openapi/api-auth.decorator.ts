import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import type { UserRole } from '@prisma/client';
import { BEARER_AUTH } from './swagger.setup';

// Documents the auth contract for a route in one place, so the 401/403
// responses can't drift apart between endpoints or be forgotten on a new
// one. Pass the roles the route is gated on (matching its @Roles(...));
// pass none for "any authenticated caller".
//
// This is documentation only — it does NOT enforce anything. Enforcement
// stays with the real guards (@Roles + the global JwtAuthGuard) and the
// per-service ownership checks. Deliberately kept separate: a decorator
// that both documented and enforced would make it possible to weaken a
// real access rule while editing docs.
export function ApiAuth(...roles: UserRole[]) {
  const decorators = [
    ApiBearerAuth(BEARER_AUTH),
    ApiResponse({
      status: 401,
      description: 'Missing, malformed, or expired access token.',
    }),
  ];

  if (roles.length > 0) {
    decorators.push(
      ApiResponse({
        status: 403,
        description: `Requires the ${roles.join(' or ')} role.`,
      }),
    );
  }

  return applyDecorators(...decorators);
}

// For a route where the caller's role is right but the record may not be
// theirs. Spelled out because the 404 is a deliberate choice, not an
// accident, and a reviewer probing the API will otherwise read it as a
// bug.
export function ApiOwnership(entity: string) {
  return ApiResponse({
    status: 404,
    description:
      `${entity} not found — returned both when it genuinely does not ` +
      `exist and when it belongs to someone else, so the endpoint cannot ` +
      `be used to discover which ids are real.`,
  });
}
