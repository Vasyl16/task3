export type SellerProfileStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface SellerProfile {
  id: string;
  userId: string;
  businessName: string;
  description: string | null;
  status: SellerProfileStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplySellerInput {
  businessName: string;
  description?: string;
}

export interface ReviewSellerInput {
  status: SellerProfileStatus;
}

export interface ListSellerApplicationsParams {
  status?: SellerProfileStatus;
}
