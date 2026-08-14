import { useState } from 'react';
import type { SellerOrderStatus } from '../../../entities/order';
import { SELLER_ORDER_NEXT_STATUS } from '../../../entities/order';
import { Button, ErrorAlert } from '../../../shared/ui';
import { useUpdateSellerOrderStatus } from '../model/use-update-seller-order-status';

export function SellerOrderStatusControl({
  sellerOrderId,
  status,
}: {
  sellerOrderId: string;
  status: SellerOrderStatus;
}) {
  const nextStatuses = SELLER_ORDER_NEXT_STATUS[status];
  const updateStatus = useUpdateSellerOrderStatus();
  const [pendingStatus, setPendingStatus] = useState<SellerOrderStatus | null>(
    null,
  );

  if (nextStatuses.length === 0) {
    return null;
  }

  return (
    <div>
      <ErrorAlert error={updateStatus.error} />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {nextStatuses.map((next) => (
          <Button
            key={next}
            variant={next === 'CANCELLED' ? 'danger' : 'secondary'}
            isLoading={updateStatus.isPending && pendingStatus === next}
            disabled={updateStatus.isPending}
            onClick={() => {
              setPendingStatus(next);
              updateStatus.mutate({ sellerOrderId, status: next });
            }}
          >
            Mark as {next.toLowerCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}
