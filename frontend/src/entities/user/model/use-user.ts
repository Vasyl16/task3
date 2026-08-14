import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateUserInput } from './user';
import { userApi, userKeys } from '../api/user-api';

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: userKeys.detail(userId ?? ''),
    queryFn: () => userApi.byId(userId as string),
    enabled: Boolean(userId),
  });
}

export function useUpdateProfile(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => userApi.update(userId, input),
    onSuccess: (user) => {
      queryClient.setQueryData(userKeys.detail(userId), user);
    },
  });
}
