import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../authenticated-user.interface';

// Registered globally in CoreModule, after JwtAuthGuard. Routes with no
// @Roles() decorator are allowed for any authenticated user. This checks
// ROLE only — it never checks resource ownership, which stays each
// service's responsibility (see .claude/rules/backend.md and the
// sellers/products services).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!user) {
      return false;
    }
    return requiredRoles.includes(user.role);
  }
}
