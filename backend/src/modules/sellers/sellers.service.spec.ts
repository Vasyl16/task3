import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SellerProfileStatus,
  UserRole,
  type SellerProfile,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SellersRepository } from './domain/sellers.repository';
import { SellersService } from './sellers.service';

const NOW = new Date();

function buildProfile(overrides: Partial<SellerProfile> = {}): SellerProfile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    businessName: 'Alice Shop',
    description: null,
    status: SellerProfileStatus.PENDING,
    reviewedByUserId: null,
    reviewedAt: null,
    appliedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('SellersService', () => {
  let sellersService: SellersService;
  let sellersRepository: jest.Mocked<SellersRepository>;
  let usersService: jest.Mocked<Pick<UsersService, 'updateRole'>>;
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    sellersRepository = {
      findById: jest.fn(),
      findByUserId: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    usersService = {
      updateRole: jest.fn(),
    };
    prisma = {
      // Runs the callback with a fake tx — good enough for unit tests
      // that only assert which repository methods get called with it.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({}),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SellersService,
        { provide: SellersRepository, useValue: sellersRepository },
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    sellersService = moduleRef.get(SellersService);
  });

  describe('apply', () => {
    it('creates a PENDING application for a user with no existing one', async () => {
      sellersRepository.findByUserId.mockResolvedValue(null);
      sellersRepository.create.mockResolvedValue(buildProfile());

      await sellersService.apply('user-1', { businessName: 'Alice Shop' });

      expect(sellersRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        businessName: 'Alice Shop',
      });
    });

    it('rejects a second application from the same user', async () => {
      sellersRepository.findByUserId.mockResolvedValue(buildProfile());

      await expect(
        sellersService.apply('user-1', { businessName: 'Alice Shop' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sellersRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('review', () => {
    it('approving grants SELLER role, atomically with the status change', async () => {
      sellersRepository.findById.mockResolvedValue(buildProfile());
      sellersRepository.updateStatus.mockResolvedValue(
        buildProfile({ status: SellerProfileStatus.APPROVED }),
      );

      await sellersService.review('profile-1', 'admin-1', {
        status: SellerProfileStatus.APPROVED,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(sellersRepository.updateStatus).toHaveBeenCalledWith(
        {},
        'profile-1',
        SellerProfileStatus.APPROVED,
        'admin-1',
      );
      expect(usersService.updateRole).toHaveBeenCalledWith(
        {},
        'user-1',
        UserRole.SELLER,
      );
    });

    it('rejecting reverts the role to CUSTOMER', async () => {
      sellersRepository.findById.mockResolvedValue(
        buildProfile({ status: SellerProfileStatus.APPROVED }),
      );
      sellersRepository.updateStatus.mockResolvedValue(
        buildProfile({ status: SellerProfileStatus.REJECTED }),
      );

      await sellersService.review('profile-1', 'admin-1', {
        status: SellerProfileStatus.REJECTED,
      });

      expect(usersService.updateRole).toHaveBeenCalledWith(
        {},
        'user-1',
        UserRole.CUSTOMER,
      );
    });

    it('the reviewer identity always comes from the caller argument, never the profile', async () => {
      sellersRepository.findById.mockResolvedValue(buildProfile());
      sellersRepository.updateStatus.mockResolvedValue(buildProfile());

      await sellersService.review('profile-1', 'admin-42', {
        status: SellerProfileStatus.APPROVED,
      });

      expect(sellersRepository.updateStatus).toHaveBeenCalledWith(
        {},
        'profile-1',
        SellerProfileStatus.APPROVED,
        'admin-42',
      );
    });
  });

  describe('getOwnApprovedSellerProfileOrThrow', () => {
    it('returns the profile when APPROVED', async () => {
      sellersRepository.findByUserId.mockResolvedValue(
        buildProfile({ status: SellerProfileStatus.APPROVED }),
      );

      const profile =
        await sellersService.getOwnApprovedSellerProfileOrThrow('user-1');
      expect(profile.status).toBe(SellerProfileStatus.APPROVED);
    });

    it('throws Forbidden when the profile is still PENDING', async () => {
      sellersRepository.findByUserId.mockResolvedValue(
        buildProfile({ status: SellerProfileStatus.PENDING }),
      );

      await expect(
        sellersService.getOwnApprovedSellerProfileOrThrow('user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Forbidden when there is no seller profile at all (IDOR-adjacent: no impersonation possible)', async () => {
      sellersRepository.findByUserId.mockResolvedValue(null);

      await expect(
        sellersService.getOwnApprovedSellerProfileOrThrow('user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
