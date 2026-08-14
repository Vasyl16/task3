import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole, type User } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { UsersRepository } from './domain/users.repository';
import { UsersService } from './users.service';

const NOW = new Date();

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    passwordHash: 'bcrypt-hash-should-never-leave-the-server',
    name: 'User One',
    avatarUrl: null,
    role: UserRole.CUSTOMER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildCaller(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    role: UserRole.CUSTOMER,
    ...overrides,
  };
}

describe('UsersService', () => {
  let usersService: UsersService;
  let usersRepository: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    usersRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateRole: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
      ],
    }).compile();

    usersService = moduleRef.get(UsersService);
  });

  describe('findByIdForCaller', () => {
    it('returns the profile for its own owner', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());

      const result = await usersService.findByIdForCaller(
        'user-1',
        buildCaller(),
      );

      expect(result.id).toBe('user-1');
    });

    it('IDOR: 404s (not 403) for a different, non-admin caller', async () => {
      usersRepository.findById.mockResolvedValue(buildUser({ id: 'user-1' }));

      await expect(
        usersService.findByIdForCaller(
          'user-1',
          buildCaller({ id: 'attacker' }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ADMIN can look up any profile', async () => {
      usersRepository.findById.mockResolvedValue(buildUser({ id: 'user-1' }));

      const result = await usersService.findByIdForCaller(
        'user-1',
        buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
      );

      expect(result.id).toBe('user-1');
    });

    it('never leaks passwordHash to the caller, even for their own profile', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());

      const result = await usersService.findByIdForCaller(
        'user-1',
        buildCaller(),
      );

      expect(result).not.toHaveProperty('passwordHash');
      expect(Object.keys(result).sort()).toEqual(
        [
          'avatarUrl',
          'createdAt',
          'email',
          'id',
          'name',
          'role',
          'updatedAt',
        ].sort(),
      );
    });
  });

  describe('updateForCaller', () => {
    it('lets a user update their own profile', async () => {
      usersRepository.update.mockResolvedValue(buildUser({ name: 'New Name' }));

      const result = await usersService.updateForCaller(
        'user-1',
        { name: 'New Name' },
        buildCaller(),
      );

      expect(result.name).toBe('New Name');
      expect(usersRepository.update).toHaveBeenCalledWith('user-1', {
        name: 'New Name',
      });
    });

    it('IDOR: rejects editing a different user, even for ADMIN', async () => {
      await expect(
        usersService.updateForCaller(
          'user-1',
          { name: 'Hijacked' },
          buildCaller({ id: 'admin-1', role: UserRole.ADMIN }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(usersRepository.update).not.toHaveBeenCalled();
    });
  });
});
