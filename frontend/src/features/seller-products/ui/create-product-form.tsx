import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useCategories } from '../../../entities/category';
import { productApi } from '../../../entities/product';
import {
  Button,
  ErrorAlert,
  Select,
  Textarea,
  TextField,
} from '../../../shared/ui';
import { createProductSchema } from '../model/product-schema';
import type { CreateProductFormValues } from '../model/product-schema';
import { useCreateProduct } from '../model/use-product-mutations';

type ImageSource = 'none' | 'upload' | 'url';

// Kept out of the react-hook-form/Zod schema deliberately: a File isn't
// a serializable form value, and the URL field only needs to exist (and
// be validated) while "url" mode is selected — neither fits the
// always-present-field shape the rest of the form uses, so both live in
// plain component state instead.
export function CreateProductForm({
  onSuccess,
}: {
  onSuccess: (productId: string) => void;
}) {
  const { data: categories } = useCategories();
  const createProduct = useCreateProduct();
  const [imageSource, setImageSource] = useState<ImageSource>('none');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUploadError, setImageUploadError] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateProductFormValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      categoryId: '',
      name: '',
      slug: '',
      description: '',
      basePrice: 0,
      type: 'FIXED_PRICE',
      initialQuantity: 0,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setImageUploadError(null);
    const trimmedUrl = imageUrlInput.trim();

    createProduct.mutate(
      {
        ...values,
        imageUrl: imageSource === 'url' && trimmedUrl ? trimmedUrl : undefined,
      },
      {
        onSuccess: (product) => {
          // The upload route needs a product id, which doesn't exist
          // until creation succeeds — so this is a second request, not
          // part of the create payload. The product itself is already
          // saved at this point regardless of how the upload goes; a
          // failure here is surfaced but doesn't block navigating to
          // the new product (its image can always be added from the
          // edit page). void: onSuccess itself must stay synchronous
          // for TanStack Query's MutateOptions typing.
          void (async () => {
            if (imageSource === 'upload' && imageFile) {
              try {
                await productApi.uploadImage(product.id, imageFile);
              } catch (err) {
                setImageUploadError(err);
              }
            }
            onSuccess(product.id);
          })();
        },
      },
    );
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={createProduct.error} />
      {imageUploadError != null && <ErrorAlert error={imageUploadError} />}

      <Select
        label="Category"
        error={errors.categoryId?.message}
        {...register('categoryId')}
      >
        <option value="">Select a category</option>
        {categories?.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>

      <TextField
        label="Name"
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label="URL slug"
        error={errors.slug?.message}
        {...register('slug')}
      />
      <Textarea
        label="Description"
        error={errors.description?.message}
        {...register('description')}
      />

      <div className="ui-field">
        <span className="ui-field__label">Product image (optional)</span>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <Button
            type="button"
            variant={imageSource === 'upload' ? 'primary' : 'secondary'}
            onClick={() =>
              setImageSource(imageSource === 'upload' ? 'none' : 'upload')
            }
          >
            Upload a file
          </Button>
          <Button
            type="button"
            variant={imageSource === 'url' ? 'primary' : 'secondary'}
            onClick={() =>
              setImageSource(imageSource === 'url' ? 'none' : 'url')
            }
          >
            Use an image URL
          </Button>
        </div>

        {imageSource === 'upload' && (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              {imageFile ? imageFile.name : 'Choose a file'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) =>
                setImageFile(event.target.files?.[0] ?? null)
              }
            />
            <p
              style={{
                margin: 'var(--space-2) 0 0',
                fontSize: '0.8125rem',
                color: 'var(--color-text-muted)',
              }}
            >
              JPEG, PNG, or WebP — up to 5MB. Uploaded right after the product
              is created.
            </p>
          </div>
        )}

        {imageSource === 'url' && (
          <TextField
            label="Image URL"
            type="url"
            placeholder="https://…"
            value={imageUrlInput}
            onChange={(event) => setImageUrlInput(event.target.value)}
          />
        )}
      </div>

      <Select
        label="Listing type"
        error={errors.type?.message}
        {...register('type')}
      >
        <option value="FIXED_PRICE">Fixed price</option>
        <option value="AUCTION">Auction</option>
      </Select>
      <TextField
        label="Base price ($)"
        type="number"
        step="0.01"
        min={0.01}
        error={errors.basePrice?.message}
        {...register('basePrice', { valueAsNumber: true })}
      />
      <TextField
        label="Initial stock quantity"
        type="number"
        min={0}
        step={1}
        error={errors.initialQuantity?.message}
        {...register('initialQuantity', { valueAsNumber: true })}
      />

      <Button type="submit" isLoading={createProduct.isPending}>
        Create product
      </Button>
    </form>
  );
}
