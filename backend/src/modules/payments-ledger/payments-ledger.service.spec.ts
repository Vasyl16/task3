import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import type { OrdersService } from '../orders/orders.service';
import type { SellersService } from '../sellers/sellers.service';
import type { PaymentsLedgerRepository } from './domain/payments-ledger.repository';
import { PaymentsLedgerService } from './payments-ledger.service';

// Every case here is a regression test for a real hole: this controller
// shipped with NO authorization at all, so any authenticated account
// could read any seller's revenue ledger and read any refund.
describe('PaymentsLedgerService (authorization)', () => {
  const OWN_SELLER_ID = 'seller-own';
  const OTHER_SELLER_ID = 'seller-other';

  const customer: AuthenticatedUser = {
    id: 'user-customer',
    email: 'c@test',
    role: UserRole.CUSTOMER,
  };
  const seller: AuthenticatedUser = {
    id: 'user-seller',
    email: 's@test',
    role: UserRole.SELLER,
  };
  const admin: AuthenticatedUser = {
    id: 'user-admin',
    email: 'a@test',
    role: UserRole.ADMIN,
  };

  let repository: jest.Mocked<
    Pick<PaymentsLedgerRepository, 'listLedgerForSeller' | 'findRefundById'>
  >;
  let sellersService: jest.Mocked<
    Pick<SellersService, 'findById' | 'findByUserId'> & {
      getOwnApprovedSellerProfileOrThrow: jest.Mock;
    }
  >;
  let ordersService: jest.Mocked<
    Pick<OrdersService, 'findSellerOrderById' | 'findSellerOrderAsBuyer'>
  >;
  let service: PaymentsLedgerService;

  beforeEach(() => {
    repository = {
      listLedgerForSeller: jest.fn().mockResolvedValue([{ id: 'entry-1' }]),
      findRefundById: jest
        .fn()
        .mockResolvedValue({ id: 'refund-1', sellerOrderId: 'so-1' }),
    };
    sellersService = {
      findById: jest.fn().mockResolvedValue({ id: OWN_SELLER_ID }),
      findByUserId: jest.fn().mockResolvedValue({ id: OWN_SELLER_ID }),
      getOwnApprovedSellerProfileOrThrow: jest
        .fn()
        .mockResolvedValue({ id: OWN_SELLER_ID }),
    };
    ordersService = {
      findSellerOrderById: jest
        .fn()
        .mockResolvedValue({ id: 'so-1', sellerId: OWN_SELLER_ID }),
      findSellerOrderAsBuyer: jest.fn().mockResolvedValue({ id: 'so-1' }),
    };

    service = new PaymentsLedgerService(
      repository as unknown as PaymentsLedgerRepository,
      sellersService as unknown as SellersService,
      ordersService as unknown as OrdersService,
      {} as never, // outbox — saga paths only, not exercised here
      {} as never, // correlationId
      {} as never, // prisma
    );
  });

  describe('listLedgerForSeller', () => {
    it('lets a seller read their own ledger', async () => {
      await expect(
        service.listLedgerForSeller(OWN_SELLER_ID, seller),
      ).resolves.toEqual([{ id: 'entry-1' }]);
    });

    // The core IDOR: the :sellerId in the URL is not proof of anything.
    it('refuses a seller reading a DIFFERENT seller’s ledger', async () => {
      await expect(
        service.listLedgerForSeller(OTHER_SELLER_ID, seller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.listLedgerForSeller).not.toHaveBeenCalled();
    });

    it('refuses a customer with no seller profile at all', async () => {
      sellersService.getOwnApprovedSellerProfileOrThrow.mockRejectedValue(
        new ForbiddenException('No approved seller profile for this account'),
      );
      await expect(
        service.listLedgerForSeller(OTHER_SELLER_ID, customer),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.listLedgerForSeller).not.toHaveBeenCalled();
    });

    it('lets an ADMIN read any seller’s ledger', async () => {
      await expect(
        service.listLedgerForSeller(OTHER_SELLER_ID, admin),
      ).resolves.toEqual([{ id: 'entry-1' }]);
      expect(
        sellersService.getOwnApprovedSellerProfileOrThrow,
      ).not.toHaveBeenCalled();
    });
  });

  describe('findRefundByIdForCaller', () => {
    it('lets the buyer read their own refund', async () => {
      sellersService.findByUserId.mockResolvedValue(null);
      await expect(
        service.findRefundByIdForCaller('refund-1', customer),
      ).resolves.toMatchObject({ id: 'refund-1' });
    });

    it('lets the seller whose sale it reverses read it', async () => {
      await expect(
        service.findRefundByIdForCaller('refund-1', seller),
      ).resolves.toMatchObject({ id: 'refund-1' });
      // Resolved via the seller branch — never had to be the buyer.
      expect(ordersService.findSellerOrderAsBuyer).not.toHaveBeenCalled();
    });

    it('lets an ADMIN read any refund', async () => {
      await expect(
        service.findRefundByIdForCaller('refund-1', admin),
      ).resolves.toMatchObject({ id: 'refund-1' });
    });

    it('404s for an unrelated user — neither buyer nor seller', async () => {
      sellersService.findByUserId.mockResolvedValue(null);
      ordersService.findSellerOrderAsBuyer.mockRejectedValue(
        new NotFoundException('SellerOrder so-1 not found'),
      );
      await expect(
        service.findRefundByIdForCaller('refund-1', customer),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // The 404 must not name the SellerOrder the refund belongs to —
    // that would turn a refund id into a lookup for someone else's order
    // id, which is exactly the correlation the 404 exists to withhold.
    it('does not disclose the underlying SellerOrder id in the 404', async () => {
      sellersService.findByUserId.mockResolvedValue(null);
      ordersService.findSellerOrderAsBuyer.mockRejectedValue(
        new NotFoundException('SellerOrder so-1 not found'),
      );
      await expect(
        service.findRefundByIdForCaller('refund-1', customer),
      ).rejects.toThrow('Refund refund-1 not found');
    });

    it('404s for a refund that does not exist', async () => {
      repository.findRefundById.mockResolvedValue(null);
      await expect(
        service.findRefundByIdForCaller('nope', admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
