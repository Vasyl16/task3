import { SetMetadata, type ExecutionContext } from '@nestjs/common';

export const AUTH_THROTTLE_KEY = 'authThrottle';

// Opts a route into the strict credential rate limit (see CoreModule).
// Applied to login/register/refresh: the endpoints where an unlimited
// request rate converts directly into compromised accounts.
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE_KEY, true);

// The strict limiter is defined globally (a ThrottlerModule definition
// applies to every route by default), so it is skipped everywhere the
// decorator above is absent. Reading the metadata here — rather than
// matching on request paths — keeps the rule attached to the handler it
// governs, so a renamed route can't silently lose its limit.
export function isAuthThrottled(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(AUTH_THROTTLE_KEY, context.getHandler()) === true ||
    Reflect.getMetadata(AUTH_THROTTLE_KEY, context.getClass()) === true
  );
}
