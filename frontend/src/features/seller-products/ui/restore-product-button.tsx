import { Button } from '../../../shared/ui';
import { useRestoreProduct } from '../model/use-product-mutations';

interface RestoreProductButtonProps {
  productId: string;
  // An admin takedown carries this stamp. A seller cannot undo one from
  // their own dashboard — the backend refuses it too — so the button is
  // not offered where it would only fail.
  moderatedAt?: string | null;
}

export function RestoreProductButton({
  productId,
  moderatedAt,
}: RestoreProductButtonProps) {
  const restore = useRestoreProduct();

  if (moderatedAt) {
    return (
      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
        Removed by a moderator
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      disabled={restore.isPending}
      onClick={() => restore.mutate(productId)}
    >
      {restore.isPending ? 'Restoring…' : 'Restore'}
    </Button>
  );
}
