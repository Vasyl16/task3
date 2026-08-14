import {
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { isOptionalAuth } from '../decorators/optional-auth.decorator';

// Registered globally in CoreModule — every route requires a valid
// access token unless marked @Public(). Relies on JwtAccessStrategy
// (registered by AuthModule) being loaded somewhere in the app for the
// 'jwt' Passport strategy name to resolve.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isPublic) {
      return (await super.canActivate(context)) as boolean;
    }

    // Public, but marked @OptionalAuth(): try to identify the caller and
    // carry on regardless. Passport attaches req.user on success; on
    // failure handleRequest below returns undefined instead of throwing,
    // so the handler simply sees an anonymous request.
    if (isOptionalAuth(context)) {
      try {
        await super.canActivate(context);
      } catch {
        // An unusable token on a public route is not an error.
      }
    }
    return true;
  }

  // Passport's default throws when no user was resolved. On an
  // @OptionalAuth() route that is the normal anonymous case, so it must
  // yield undefined rather than a 401.
  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (isOptionalAuth(context)) {
      return (err ? undefined : user) as TUser;
    }
    if (err) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
