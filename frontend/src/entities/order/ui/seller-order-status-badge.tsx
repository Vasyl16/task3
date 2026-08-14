import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { SellerOrderStatus } from '../model/order';

const VARIANT: Record<SellerOrderStatus, BadgeVariant> = {
  NEW: 'info',
  PROCESSING: 'info',
  SHIPPED: 'accent',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'neutral',
};

const LABEL: Record<SellerOrderStatus, string> = {
  NEW: 'New',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function SellerOrderStatusBadge({
  status,
}: {
  status: SellerOrderStatus;
}) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
