import type { RefreshToken } from '@prisma/client';

export abstract class RefreshTokenRepository {
  abstract create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken>;
  abstract findByHash(tokenHash: string): Promise<RefreshToken | null>;
  abstract revoke(id: string): Promise<void>;
  abstract revokeAllForUser(userId: string): Promise<void>;
}
