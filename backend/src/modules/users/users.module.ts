import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './domain/users.repository';
import { PrismaUsersRepository } from './infrastructure/prisma-users.repository';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
