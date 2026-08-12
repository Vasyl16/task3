import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserRole } from '@prisma/client';
import type { AppConfig } from '../../../config/configuration';
import type { AuthenticatedUser } from '../../../core/auth/authenticated-user.interface';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

function getAccessSecret(
  configService: ConfigService<AppConfig, true>,
): string {
  const secret = configService.get('jwt.accessSecret', { infer: true });
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is required but was not resolved');
  }
  return secret;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getAccessSecret(configService),
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
