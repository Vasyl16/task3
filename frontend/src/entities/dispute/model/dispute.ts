export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';

export interface Dispute {
  id: string;
  sellerOrderId: string;
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
