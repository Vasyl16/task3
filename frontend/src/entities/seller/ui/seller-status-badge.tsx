import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { SellerProfileStatus } from '../model/seller';

const VARIANT: Record<SellerProfileStatus, BadgeVariant> = {
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

export function SellerStatusBadge({ status }: { status: SellerProfileStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
