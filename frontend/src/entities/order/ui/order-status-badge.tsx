import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { OrderStatus } from '../model/order';

const VARIANT: Record<OrderStatus, BadgeVariant> = {
  NEW: 'info',
  PROCESSING: 'info',
  PARTIALLY_SHIPPED: 'accent',
  SHIPPED: 'accent',
  COMPLETED: 'success',
  PARTIALLY_CANCELLED: 'danger',
  CANCELLED: 'danger',
};

const LABEL: Record<OrderStatus, string> = {
  NEW: 'New',
  PROCESSING: 'Processing',
  PARTIALLY_SHIPPED: 'Partially shipped',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  PARTIALLY_CANCELLED: 'Partially cancelled',
  CANCELLED: 'Cancelled',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
