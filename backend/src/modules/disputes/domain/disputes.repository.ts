import type { Dispute, DisputeComment, DisputeStatus } from '@prisma/client';

// A dispute plus the purchase it is about. Both sides need this: an
// admin cannot rule on "item was damaged" without seeing which item,
// and the buyer needs to recognise which of their orders it refers to.
// Assembled in one query rather than making the client stitch a dispute
// to an order it may not even be allowed to read.
export interface DisputeWithOrderContext extends Dispute {
  sellerOrder: {
    id: string;
    status: string;
    subtotal: unknown;
    orderId: string;
    items: {
      id: string;
      quantity: number;
      unitPrice: unknown;
      productId: string;
      product: {
        id: string;
        name: string;
        slug: string;
        imageUrl: string | null;
      };
    }[];
  };
}

export interface DisputeListFilter {
  status?: DisputeStatus;
  raisedById?: string;
  sellerOrderId?: string;
}

export abstract class DisputesRepository {
  abstract findById(id: string): Promise<Dispute | null>;
  abstract findByIdWithOrder(
    id: string,
  ): Promise<DisputeWithOrderContext | null>;
  abstract findMany(filter: DisputeListFilter): Promise<Dispute[]>;
  // "Already being argued about" — an OPEN or UNDER_REVIEW dispute for
  // this exact scope. Scoped to the LINE when orderItemId is given, so
  // disputing item A does not block disputing item B on the same order;
  // scoped to the whole SellerOrder when it is not.
  abstract findActiveFor(scope: {
    sellerOrderId: string;
    orderItemId?: string | null;
  }): Promise<Dispute | null>;
  // The line item, if any, that this SellerOrder contains. Returns null
  // when the item belongs to a different order — which is what stops a
  // buyer attaching their complaint to somebody else's line.
  abstract findOrderItemInSellerOrder(
    sellerOrderId: string,
    orderItemId: string,
  ): Promise<{ id: string } | null>;
  abstract create(data: {
    sellerOrderId: string;
    orderItemId?: string | null;
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

  // Oldest first: a dispute thread is read as a conversation, not as a
  // feed. This is the opposite of how disputes themselves are listed.
  abstract findComments(disputeId: string): Promise<DisputeComment[]>;
  abstract addComment(data: {
    disputeId: string;
    authorId: string;
    body: string;
  }): Promise<DisputeComment>;
}
