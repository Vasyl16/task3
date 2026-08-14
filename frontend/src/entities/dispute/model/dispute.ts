export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';

export interface Dispute {
  id: string;
  sellerOrderId: string;
  // The disputed LINE, or null when the complaint is about the whole
  // shipment rather than one item.
  orderItemId: string | null;
  raisedById: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface CreateDisputeInput {
  sellerOrderId: string;
  // Omit to dispute the whole shipment; name a line to dispute just
  // that item. The backend validates the line belongs to the order.
  orderItemId?: string;
  reason: string;
}

export interface ListDisputesParams {
  status?: DisputeStatus;
  sellerOrderId?: string;
}

export interface ResolveDisputeInput {
  status: DisputeStatus;
  // Required by the backend when moving to RESOLVED/REJECTED, optional
  // for UNDER_REVIEW.
  resolution?: string;
}

// One message in a dispute thread. Both the buyer who raised it and the
// admin handling it post here; the backend closes the thread once a
// ruling is made.
export interface DisputeComment {
  id: string;
  disputeId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface AddDisputeCommentInput {
  body: string;
}

// A dispute plus the purchase it is about — what GET /disputes/:id
// returns. Both the buyer and the admin get exactly this, because both
// need to see which item is being argued over.
export interface DisputeWithOrder extends Dispute {
  sellerOrder: {
    id: string;
    orderId: string;
    status: string;
    subtotal: string;
    items: {
      id: string;
      quantity: number;
      unitPrice: string;
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
