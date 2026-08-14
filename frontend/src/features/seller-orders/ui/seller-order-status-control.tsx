import { useState } from 'react';
import type { SellerOrderStatus } from '../../../entities/order';
import { SELLER_ORDER_NEXT_STATUS } from '../../../entities/order';
import { Button, ErrorAlert } from '../../../shared/ui';
import { useUpdateSellerOrderStatus } from '../model/use-update-seller-order-status';

// SHIPPED/COMPLETED offer nothing further in the ordinary table — a
// seller cannot cancel a shipment that already went out. An admin can,
// which is what makes a dispute ruling enactable rather than merely
// recorded, so this is added on top rather than changing the table
// itself (which still governs what a seller may do).
const ADMIN_FORCE_CANCELLABLE: SellerOrderStatus[] = ['SHIPPED', 'COMPLETED'];

export function SellerOrderStatusControl({
  sellerOrderId,
  status,
  isAdmin = false,
}: {
  sellerOrderId: string;
  status: SellerOrderStatus;
  // Set only on the admin order queue. The seller's own order pages
  // never pass this, so they never see the override.
  isAdmin?: boolean;
}) {
  const nextStatuses = SELLER_ORDER_NEXT_STATUS[status];
  const canForceCancel =
    isAdmin &&
    ADMIN_FORCE_CANCELLABLE.includes(status) &&
    !nextStatuses.includes('CANCELLED');
  const updateStatus = useUpdateSellerOrderStatus();
  const [pendingStatus, setPendingStatus] = useState<SellerOrderStatus | null>(
    null,
  );

  if (nextStatuses.length === 0 && !canForceCancel) {
    return null;
  }

  return (
    <div>
      <ErrorAlert error={updateStatus.error} />
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
        {canForceCancel && (
          <Button
            variant="danger"
            isLoading={updateStatus.isPending && pendingStatus === 'CANCELLED'}
            disabled={updateStatus.isPending}
            onClick={() => {
              setPendingStatus('CANCELLED');
              updateStatus.mutate({
                sellerOrderId,
                status: 'CANCELLED',
              });
            }}
          >
            {/* Distinct label from the seller's own "Mark as cancelled":
                this is the one case where cancelling restocks the item
                rather than releasing a hold, because the units already
                left quantityReserved at shipment. */}
            Force cancel &amp; restock
          </Button>
        )}
      </div>
    </div>
  );
}
