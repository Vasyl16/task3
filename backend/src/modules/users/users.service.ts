import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { UsersRepository } from './domain/users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
}
