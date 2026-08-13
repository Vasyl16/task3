import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { AppConfig } from '../config/configuration';
import { CorrelationIdMiddleware } from './correlation-id/correlation-id.middleware';
import { CorrelationIdService } from './correlation-id/correlation-id.service';
import { AppLogger } from './logging/app-logger.service';
import { HttpObservabilityInterceptor } from './observability/http-observability.interceptor';
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
    // Built here rather than with @Injectable() alone because it needs
    // config (level, file sink) at construction. Installed globally in
    // main.ts via app.useLogger().
    {
      provide: AppLogger,
      inject: [CorrelationIdService, ConfigService],
      useFactory: (
        correlationIdService: CorrelationIdService,
        config: ConfigService<AppConfig, true>,
      ) =>
        new AppLogger(correlationIdService, {
          level: config.get('log.level', { infer: true }),
          filePath: config.get('log.file', { infer: true }),
        }),
    },
    JwtAuthGuard,
    RolesGuard,
    // Order matters: JwtAuthGuard populates req.user before RolesGuard
    // reads it. JwtAuthGuard relies on JwtAccessStrategy (registered by
    // AuthModule) being loaded somewhere in the app.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Emits the per-request metric AND access log. Runs after the
    // guards, so req.user is populated and the log line can carry the
    // authenticated userId.
    { provide: APP_INTERCEPTOR, useClass: HttpObservabilityInterceptor },
  ],
  exports: [CorrelationIdService, AppLogger],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
