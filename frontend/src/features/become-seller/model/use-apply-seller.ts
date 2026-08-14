import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApplySellerInput } from '../../../entities/seller';
import { sellerApi, sellerKeys } from '../../../entities/seller';

export function useApplySeller() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplySellerInput) => sellerApi.apply(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(sellerKeys.myProfile(), profile);
    },
  });
}
