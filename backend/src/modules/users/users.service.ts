import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type Prisma, type User } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { UsersRepository } from './domain/users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// Never return the raw Prisma User to a client — it carries
// passwordHash, which has no business leaving the server under any
// circumstance (not even to the user it belongs to).
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicUser(user: User): PublicUser {
  const { id, email, name, avatarUrl, role, createdAt, updatedAt } = user;
  return { id, email, name, avatarUrl, role, createdAt, updatedAt };
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  create(dto: CreateUserDto): Promise<User> {
    return this.usersRepository.create(dto);
  }

  update(id: string, dto: UpdateUserDto): Promise<User> {
    return this.usersRepository.update(id, dto);
  }

  // Only ever called from within SellersService.review's transaction —
  // role is never set directly from a controller.
  updateRole(
    tx: Prisma.TransactionClient,
    id: string,
    role: UserRole,
  ): Promise<User> {
    return this.usersRepository.updateRole(tx, id, role);
  }

  // ---- Client-facing entry points (UsersController only) ----
  //
  // Authorization AND response sanitization live here, not in the
  // controller — same shape as OrdersService.findById(id, caller). This
  // is the fix for a real IDOR: JwtAuthGuard (global) only ever proved
  // the caller holds a valid token, never that they own the id in the
  // URL. A valid token from ANY account used to be enough to read or
  // edit ANY other user's profile.

  // ADMIN may look up any profile (support/investigation); no one else
  // may look up anyone but themselves.
  async findByIdForCaller(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<PublicUser> {
    if (caller.role !== UserRole.ADMIN && caller.id !== id) {
      // 404, not 403 — same reasoning as OrdersService.findById: a 403
      // would confirm this user id exists at all to someone with no
      // business knowing that.
      throw new NotFoundException(`User ${id} not found`);
    }
    return toPublicUser(await this.findById(id));
  }

  // Self only, even for ADMIN — there's no product requirement for an
  // admin to edit someone else's name/avatar, so no exception is carved
  // out for it here.
  async updateForCaller(
    id: string,
    dto: UpdateUserDto,
    caller: AuthenticatedUser,
  ): Promise<PublicUser> {
    if (caller.id !== id) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return toPublicUser(await this.update(id, dto));
  }
}
