import type { Prisma, User, UserRole } from '@prisma/client';

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
  // Takes the caller's transaction client — role changes only ever
  // happen alongside a SellerProfile status change (see
  // SellersService.review), atomically.
  abstract updateRole(
    tx: Prisma.TransactionClient,
    id: string,
    role: UserRole,
  ): Promise<User>;
}
