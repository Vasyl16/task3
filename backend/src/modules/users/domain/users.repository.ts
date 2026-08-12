import type { User } from '@prisma/client';

// Port: the users module's persistence contract. Business/service code
// depends on this abstraction, never on Prisma directly.
export abstract class UsersRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract create(data: {
    email: string;
    name: string;
    passwordHash?: string;
  }): Promise<User>;
  abstract update(
    id: string,
    data: Partial<{ name: string; avatarUrl: string }>,
  ): Promise<User>;
}
