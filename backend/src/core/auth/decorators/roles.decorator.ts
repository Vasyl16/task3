import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

// @Roles(UserRole.ADMIN) — checked by RolesGuard against req.user.role.
// Never sufficient on its own for a resource-scoped action (see
// ownership checks in each service) — this only gates by role.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
