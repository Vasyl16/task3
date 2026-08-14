import { useState } from 'react';
import type { SellerOrderStatus } from '../../../entities/order';
import { Alert, Button, Textarea } from '../../../shared/ui';
import { useRaiseDispute } from '../model/use-raise-dispute';

interface RaiseDisputeButtonProps {
  sellerOrderId: string;
  // Omit for a whole-shipment complaint; pass a line to dispute just
  // that item. The label changes to match, so a buyer can tell which
  // one they are opening.
  orderItemId?: string;
  itemName?: string;
  sellerOrderStatus: SellerOrderStatus;
}

// Mirrors the backend rule rather than replacing it: there is nothing to
// dispute before a seller has begun fulfilling, and the API is the thing
// that actually decides. Kept as a UI hint so the button is not offered
// where it would only ever fail.
const DISPUTABLE: SellerOrderStatus[] = ['PROCESSING', 'SHIPPED', 'COMPLETED'];

export function RaiseDisputeButton({
  sellerOrderId,
  orderItemId,
  itemName,
  sellerOrderStatus,
}: RaiseDisputeButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const raiseDispute = useRaiseDispute();

  if (!DISPUTABLE.includes(sellerOrderStatus)) return null;

  if (raiseDispute.isSuccess) {
    return (
      <Alert variant="info">
        Dispute opened — support will follow up on the thread.
      </Alert>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {orderItemId ? 'Report a problem with this item' : 'Report a problem'}
      </Button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        raiseDispute.mutate({
          sellerOrderId,
          orderItemId,
          reason: reason.trim(),
        });
      }}
      style={{ display: 'grid', gap: 'var(--space-2)', maxWidth: '32rem' }}
    >
      <Textarea
        label={
          itemName ? `What went wrong with ${itemName}?` : 'What went wrong?'
        }
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        placeholder="Describe the problem — the more specific, the faster it gets resolved."
      />
      {raiseDispute.isError && (
        <Alert variant="error">
          {raiseDispute.error instanceof Error
            ? raiseDispute.error.message
            : 'Could not open the dispute.'}
        </Alert>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          type="submit"

          // The backend requires at least 10 characters; enforcing it
          // here turns a 400 into a disabled button.
          disabled={reason.trim().length < 10 || raiseDispute.isPending}
        >
          {raiseDispute.isPending ? 'Opening…' : 'Open dispute'}
        </Button>
        <Button
          type="button"
          variant="ghost"

          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
