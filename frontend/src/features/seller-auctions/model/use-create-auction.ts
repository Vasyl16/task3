import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateAuctionInput } from '../../../entities/auction';
import { auctionApi, auctionKeys } from '../../../entities/auction';

export function useCreateAuction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAuctionInput) => auctionApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: auctionKeys.lists() });
    },
  });
}
