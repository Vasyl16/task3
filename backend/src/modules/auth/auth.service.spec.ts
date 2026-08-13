import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './domain/refresh-token.repository';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    passwordHash: null,
    name: 'Alice',
    avatarUrl: null,
    role: 'CUSTOMER',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findById' | 'create'>
  >;
  let refreshTokenRepository: jest.Mocked<RefreshTokenRepository>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify' | 'decode'>>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    refreshTokenRepository = {
      create: jest.fn(),
      findByHash: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
      verify: jest.fn(),
      decode: jest.fn().mockReturnValue({
        exp: Math.floor(NOW.getTime() / 1000) + 3600,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: RefreshTokenRepository, useValue: refreshTokenRepository },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const values: Record<string, string> = {
                'jwt.accessSecret': 'access-secret-min-16-chars',
                'jwt.refreshSecret': 'refresh-secret-min-16-chars',
                'jwt.accessExpiresIn': '15m',
                'jwt.refreshExpiresIn': '7d',
              };
              return values[key];
            },
          },
        },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('creates a user with a hashed password and issues tokens', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(buildUser());

      const result = await authService.register({
        email: 'alice@example.com',
        password: 'password123',
        name: 'Alice',
      });

      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'signed.jwt.token',
      });
      const createArg = usersService.create.mock.calls[0][0];
      expect(createArg.passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', createArg.passwordHash!)).toBe(
        true,
      );
      expect(refreshTokenRepository.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a duplicate email', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      await expect(
        authService.register({
          email: 'alice@example.com',
          password: 'password123',
          name: 'Alice',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a Google-only account (no passwordHash)', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ passwordHash: null }),
      );

      await expect(
        authService.login({ email: 'alice@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail.mockResolvedValue(buildUser({ passwordHash }));

      await expect(
        authService.login({
          email: 'alice@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues tokens for a correct password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail.mockResolvedValue(buildUser({ passwordHash }));

      const result = await authService.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(refreshTokenRepository.create).toHaveBeenCalledTimes(1);
    });

    // Regression: the refresh payload used to be just { sub }, and JWT's
    // iat/exp are second-granular — so logging in twice within the same
    // second signed a byte-identical token whose hash collided with the
    // tokenHash unique index, surfacing as a 500. A unique jti per issue
    // is what keeps two same-second logins distinct.
    it('gives every issued refresh token a unique jti, so same-second logins cannot collide', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail.mockResolvedValue(buildUser({ passwordHash }));

      await authService.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });
      await authService.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      const refreshPayloads = jwtService.sign.mock.calls
        .map(([payload]) => payload as { sub: string; jti?: string })
        .filter((payload) => payload.jti !== undefined);

      expect(refreshPayloads).toHaveLength(2);
      expect(refreshPayloads[0].jti).not.toBe(refreshPayloads[1].jti);
    });
  });

  describe('refresh', () => {
    it('rotates a valid, unrevoked token and issues a new pair', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });
      refreshTokenRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        revokedAt: null,
        createdAt: NOW,
      });
      usersService.findById.mockResolvedValue(buildUser());

      const result = await authService.refresh({
        refreshToken: 'presented-token',
      });

      expect(refreshTokenRepository.revoke).toHaveBeenCalledWith('rt-1');
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('rejects an invalid JWT signature', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(
        authService.refresh({ refreshToken: 'garbage' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects and revokes the whole session family on reuse of a revoked token', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });
      refreshTokenRepository.findByHash.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash',
        expiresAt: new Date(NOW.getTime() + 1000 * 60 * 60),
        revokedAt: new Date(NOW.getTime() - 1000),
        createdAt: NOW,
      });

      await expect(
        authService.refresh({ refreshToken: 'already-used-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('rejects a token not found in the database', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });
      refreshTokenRepository.findByHash.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: 'unknown-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes every active refresh token for the user', async () => {
      await authService.logout('user-1');
      expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
    });
  });
});
