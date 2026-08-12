import { Module, type Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { PrismaRefreshTokenRepository } from './infrastructure/prisma-refresh-token.repository';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

// GoogleStrategy is only registered when both env vars are actually set —
// passport-google-oauth20 throws at construction time on an empty
// clientID, which would otherwise crash app bootstrap for anyone who
// hasn't configured Google OAuth. Checked directly against process.env
// here because this decides the module's static provider list, which is
// built before Nest's DI container (and ConfigService) exists.
const googleOAuthProviders: Provider[] =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? [GoogleStrategy, GoogleAuthGuard]
    : [GoogleAuthGuard];

// The global JwtAuthGuard/RolesGuard live in CoreModule (see
// core/auth/) — this module owns only the credential/token business
// logic: registration, login, refresh rotation, Google OAuth.
@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    ...googleOAuthProviders,
    { provide: RefreshTokenRepository, useClass: PrismaRefreshTokenRepository },
  ],
  exports: [AuthService],
})
export class AuthModule {}
