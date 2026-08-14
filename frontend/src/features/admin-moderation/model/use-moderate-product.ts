import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ModerateProductInput } from '../../../entities/product';
import { productApi, productKeys } from '../../../entities/product';

export function useModerateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      input,
    }: {
      productId: string;
      input: ModerateProductInput;
    }) => productApi.adminModerate(productId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: productKeys.adminLists(),
      });
    },
  });
}
