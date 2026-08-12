import type { UserRole } from '@prisma/client';

// The shape of req.user once JwtAuthGuard has run — derived from the
// access token payload, never from a request body/param.
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}
