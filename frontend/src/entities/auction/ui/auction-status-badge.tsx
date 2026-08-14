import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { AuctionStatus } from '../model/auction';

const VARIANT: Record<AuctionStatus, BadgeVariant> = {
  SCHEDULED: 'info',
  ACTIVE: 'success',
  ENDED: 'accent',
  COMPLETED: 'neutral',
  EXPIRED: 'danger',
  CANCELLED: 'danger',
};

const LABEL: Record<AuctionStatus, string> = {
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Live',
  ENDED: 'Ended — awaiting checkout',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export function AuctionStatusBadge({ status }: { status: AuctionStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
