import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useProductStock, type Product } from '../../../entities/product';
import { Button, ErrorAlert, Textarea, TextField } from '../../../shared/ui';
import { updateProductSchema } from '../model/product-schema';
import type { UpdateProductFormValues } from '../model/product-schema';
import { useUpdateProduct } from '../model/use-product-mutations';

export function EditProductForm({ product }: { product: Product }) {
  const updateProduct = useUpdateProduct(product.id);
  // Stock lives on Inventory, not Product (see product.ts) — the only
  // source for a current value to prefill is the same realtime snapshot
  // product-detail-page reads. The field below is registered only once
  // it arrives (see the conditional render), so there's no stale/zero
  // default to accidentally submit before then.
  const { stock } = useProductStock(product.id);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UpdateProductFormValues>({
    resolver: zodResolver(updateProductSchema),
    defaultValues: {
      name: product.name,
      description: product.description ?? '',
      basePrice: Number(product.basePrice),
    },
  });

  const onSubmit = handleSubmit((values) => {
    updateProduct.mutate(values);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={updateProduct.error} />
      {updateProduct.isSuccess && !isDirty && (
        <p className="ui-badge ui-badge--success">Saved</p>
      )}

      <TextField
        label="Name"
        error={errors.name?.message}
        {...register('name')}
      />
      <Textarea
        label="Description"
        error={errors.description?.message}
        {...register('description')}
      />
      <TextField
        label="Base price ($)"
        type="number"
        step="0.01"
        min={0.01}
        error={errors.basePrice?.message}
        {...register('basePrice', { valueAsNumber: true })}
      />

      {stock === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          Loading current stock…
        </p>
      ) : (
        <TextField
          label="Stock"
          type="number"
          min={0}
          step={1}
          defaultValue={stock.quantityAvailable}
          error={errors.quantityAvailable?.message}
          {...register('quantityAvailable', { valueAsNumber: true })}
        />
      )}

      <Button type="submit" isLoading={updateProduct.isPending}>
        Save changes
      </Button>
    </form>
  );
}
