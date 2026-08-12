import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CorrelationIdMiddleware } from './correlation-id/correlation-id.middleware';
import { CorrelationIdService } from './correlation-id/correlation-id.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

// Global: CorrelationIdService, @Public()/@Roles()/@CurrentUser(), and
// the two global guards are all usable anywhere without importing this
// module. auth/ lives here (not in modules/auth/) specifically so
// infrastructure/ and every module can depend on the guard/decorator
// primitives without depending on the auth module's actual credential
// business logic (AuthService, strategies) — see
// .claude/skills/backend-architecture.
@Global()
@Module({
  providers: [
    CorrelationIdService,
    CorrelationIdMiddleware,
    JwtAuthGuard,
    RolesGuard,
    // Order matters: JwtAuthGuard populates req.user before RolesGuard
    // reads it. JwtAuthGuard relies on JwtAccessStrategy (registered by
    // AuthModule) being loaded somewhere in the app.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [CorrelationIdService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
