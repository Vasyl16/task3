import { Badge } from '../../../shared/ui';
import type { BadgeVariant } from '../../../shared/ui';
import type { ProductStatus } from '../model/product';

const VARIANT: Record<ProductStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  ARCHIVED: 'danger',
};

const LABEL: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
