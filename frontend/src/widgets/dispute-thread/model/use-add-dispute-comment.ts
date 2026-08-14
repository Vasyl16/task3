import { useMutation, useQueryClient } from '@tanstack/react-query';
import { disputeApi, disputeKeys } from '../../../entities/dispute';

export function useAddDisputeComment(disputeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => disputeApi.addComment(disputeId, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: disputeKeys.comments(disputeId),
      });
    },
  });
}
