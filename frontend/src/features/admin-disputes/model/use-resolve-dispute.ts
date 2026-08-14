import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ResolveDisputeInput } from '../../../entities/dispute';
import { disputeApi, disputeKeys } from '../../../entities/dispute';

export function useResolveDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      input,
    }: {
      disputeId: string;
      input: ResolveDisputeInput;
    }) => disputeApi.adminResolve(disputeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: disputeKeys.adminLists(),
      });
    },
  });
}
