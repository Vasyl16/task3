import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function buildContext(user?: { role: UserRole }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function buildGuard(requiredRoles: UserRole[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows any authenticated user when no roles are required', () => {
    const guard = buildGuard(undefined);
    expect(guard.canActivate(buildContext({ role: UserRole.CUSTOMER }))).toBe(
      true,
    );
  });

  it('allows a user whose role matches', () => {
    const guard = buildGuard([UserRole.ADMIN]);
    expect(guard.canActivate(buildContext({ role: UserRole.ADMIN }))).toBe(
      true,
    );
  });

  it('denies a user whose role does not match', () => {
    const guard = buildGuard([UserRole.ADMIN]);
    expect(guard.canActivate(buildContext({ role: UserRole.CUSTOMER }))).toBe(
      false,
    );
  });

  it('denies when there is no authenticated user at all', () => {
    const guard = buildGuard([UserRole.ADMIN]);
    expect(guard.canActivate(buildContext(undefined))).toBe(false);
  });

  it('allows when the user has one of several accepted roles', () => {
    const guard = buildGuard([UserRole.ADMIN, UserRole.SELLER]);
    expect(guard.canActivate(buildContext({ role: UserRole.SELLER }))).toBe(
      true,
    );
  });
});
