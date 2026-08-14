import { useMutation, useQueryClient } from '@tanstack/react-query';
import { disputeApi, disputeKeys } from '../../../entities/dispute';
import type { CreateDisputeInput } from '../../../entities/dispute';

export function useRaiseDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDisputeInput) => disputeApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.all });
    },
  });
}
