import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Product } from '../../../entities/product';
import { resolveAssetUrl } from '../../../shared/lib';
import { Button, ErrorAlert } from '../../../shared/ui';
import { useUploadProductImage } from '../model/use-product-mutations';
import './product-image-upload.css';

// A native <input type="file"> hidden behind a styled Button — the
// native control's own appearance can't be restyled consistently across
// browsers, but its click()/change behaviour works fine driven
// programmatically, which is the usual pattern for a "custom-looking"
// file picker without a heavier drag-and-drop library.
export function ProductImageUpload({ product }: { product: Product }) {
  const upload = useUploadProductImage(product.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageUrl = resolveAssetUrl(product.imageUrl);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    upload.mutate(file, {
      onSettled: () => {
        // Lets the same file be re-selected immediately after a failed
        // upload — without resetting, a browser won't fire `change` for
        // an identical file path twice in a row.
        if (inputRef.current) inputRef.current.value = '';
      },
    });
  };

  return (
    <div className="product-image-upload">
      <div className="product-image-upload__preview">
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} />
        ) : (
          <span
            className="product-image-upload__placeholder"
            aria-hidden="true"
          >
            {product.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="product-image-upload__controls">
        <ErrorAlert error={upload.error} />
        <Button
          type="button"
          variant="secondary"
          isLoading={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {product.imageUrl ? 'Change image' : 'Upload image'}
        </Button>
        <p
          style={{
            margin: 'var(--space-2) 0 0',
            fontSize: '0.8125rem',
            color: 'var(--color-text-muted)',
          }}
        >
          JPEG, PNG, or WebP — up to 5MB.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
