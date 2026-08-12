import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { UsersService } from '../users/users.service';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import type { AuthTokens } from './domain/auth-tokens.interface';
import type { LoginDto } from './dto/login.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.usersService.findByEmail(dto.email);
    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was.
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify<{ sub: string }>(dto.refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.refreshTokenRepository.findByHash(tokenHash);
    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // A revoked token being presented again means it was either reused
      // after rotation or stolen. Treat as compromise: kill every active
      // session for this user, not just this one token.
      await this.refreshTokenRepository.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions have been revoked',
      );
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Rotate: consume the presented token, issue a brand new pair.
    await this.refreshTokenRepository.revoke(stored.id);
    const user = await this.usersService.findById(stored.userId);
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUser(userId);
  }

  // Google OAuth: find-or-create by email, then issue our own tokens —
  // Google's tokens never leave GoogleStrategy.
  async loginWithGoogleProfile(profile: {
    email: string;
    name: string;
  }): Promise<AuthTokens> {
    let user = await this.usersService.findByEmail(profile.email);
    if (!user) {
      user = await this.usersService.create({
        email: profile.email,
        name: profile.name,
      });
    }
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: this.getAccessSecret(),
        expiresIn: this.configService.get('jwt.accessExpiresIn', {
          infer: true,
        }),
      },
    );
    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.configService.get('jwt.refreshExpiresIn', {
          infer: true,
        }),
      },
    );

    const decoded = this.jwtService.decode<{ exp: number }>(refreshToken);
    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(decoded.exp * 1000),
    });

    return { accessToken, refreshToken };
  }

  // Refresh tokens are never stored in plaintext — only this hash. A DB
  // read (e.g. a leaked backup) can't be turned into a usable token.
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getAccessSecret(): string {
    const secret = this.configService.get('jwt.accessSecret', {
      infer: true,
    });
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required but was not resolved');
    }
    return secret;
  }

  private getRefreshSecret(): string {
    const secret = this.configService.get('jwt.refreshSecret', {
      infer: true,
    });
    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET is required but was not resolved');
    }
    return secret;
  }
}
