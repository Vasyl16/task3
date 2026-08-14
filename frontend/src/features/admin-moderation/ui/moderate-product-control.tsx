import { useState } from 'react';
import type {
  Product,
  ProductModerationAction,
} from '../../../entities/product';
import { Button, ErrorAlert, Textarea } from '../../../shared/ui';
import { useModerateProduct } from '../model/use-moderate-product';

export function ModerateProductControl({ product }: { product: Product }) {
  const moderateProduct = useModerateProduct();
  const [note, setNote] = useState('');
  const [action, setAction] = useState<ProductModerationAction | null>(null);

  const action_ = product.status === 'ARCHIVED' ? 'REINSTATE' : 'TAKE_DOWN';

  const submit = (chosen: ProductModerationAction) => {
    if (note.trim().length < 3) {
      setAction(chosen);
      return;
    }
    moderateProduct.mutate({
      productId: product.id,
      input: { action: chosen, note },
    });
  };

  return (
    <div>
      <ErrorAlert error={moderateProduct.error} />
      <Textarea
        label="Moderation note (required)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={
          action && note.trim().length < 3
            ? 'Note must be at least 3 characters'
            : undefined
        }
      />
      <Button
        variant={action_ === 'TAKE_DOWN' ? 'danger' : 'primary'}
        isLoading={moderateProduct.isPending}
        onClick={() => submit(action_)}
      >
        {action_ === 'TAKE_DOWN' ? 'Take down listing' : 'Reinstate listing'}
      </Button>
    </div>
  );
}
