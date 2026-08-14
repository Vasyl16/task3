import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProductInput,
  UpdateProductInput,
} from '../../../entities/product';
import { productApi, productKeys } from '../../../entities/product';

// Ownership is enforced entirely server-side (see .claude/rules/backend.md
// — sellerId is resolved from the caller's own approved profile, never
// accepted from this form). These mutations don't send or trust one.

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => productApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

export function useUpdateProduct(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProductInput) =>
      productApi.update(productId, input),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(productId), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

export function useArchiveProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => productApi.archive(productId),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(product.id), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useRestoreProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => productApi.restore(productId),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(product.id), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      // The seller's own list is a separate key — it is the one showing
      // the archived row that just changed state.
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useUploadProductImage(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => productApi.uploadImage(productId, file),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(productId), product);
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}
