import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { DisputeStatus } from '../model/dispute';

const VARIANT: Record<DisputeStatus, BadgeVariant> = {
  OPEN: 'info',
  UNDER_REVIEW: 'accent',
  RESOLVED: 'success',
  REJECTED: 'danger',
};

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  return <Badge variant={VARIANT[status]}>{status.replace('_', ' ')}</Badge>;
}
