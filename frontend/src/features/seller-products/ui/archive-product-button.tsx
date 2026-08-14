import { useState } from 'react';
import { Button } from '../../../shared/ui';
import { useArchiveProduct } from '../model/use-product-mutations';

export function ArchiveProductButton({ productId }: { productId: string }) {
  const archiveProduct = useArchiveProduct();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Archive listing
      </Button>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 'var(--space-2)',
        alignItems: 'center',
      }}
    >
      <span>Archive this listing? It will no longer be purchasable.</span>
      <Button
        variant="danger"
        isLoading={archiveProduct.isPending}
        onClick={() => archiveProduct.mutate(productId)}
      >
        Confirm
      </Button>
      <Button variant="secondary" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}
