import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UsersRepository } from '../domain/users.repository';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: {
    email: string;
    name: string;
    passwordHash?: string;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  update(
    id: string,
    data: Partial<{ name: string; avatarUrl: string }>,
  ): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
}
