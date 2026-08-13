import type { Dispute, DisputeStatus } from '@prisma/client';

export interface DisputeListFilter {
  status?: DisputeStatus;
  raisedById?: string;
  sellerOrderId?: string;
}

export abstract class DisputesRepository {
  abstract findById(id: string): Promise<Dispute | null>;
  abstract findMany(filter: DisputeListFilter): Promise<Dispute[]>;
  // "Already being argued about" — an OPEN or UNDER_REVIEW dispute for
  // this SellerOrder. Used to reject a duplicate rather than letting a
  // buyer open the same complaint repeatedly.
  abstract findActiveForSellerOrder(
    sellerOrderId: string,
  ): Promise<Dispute | null>;
  abstract create(data: {
    sellerOrderId: string;
    raisedById: string;
    reason: string;
  }): Promise<Dispute>;
  abstract resolve(
    id: string,
    data: {
      status: DisputeStatus;
      resolution?: string;
      resolvedById: string;
    },
  ): Promise<Dispute>;
}
