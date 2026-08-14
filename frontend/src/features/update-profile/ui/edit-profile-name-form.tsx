import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useUpdateProfile } from '../../../entities/user';
import { Button, ErrorAlert, TextField } from '../../../shared/ui';
import { updateProfileSchema } from '../model/update-profile-schema';
import type { UpdateProfileFormValues } from '../model/update-profile-schema';

export function EditProfileNameForm({
  userId,
  currentName,
}: {
  userId: string;
  currentName: string;
}) {
  const updateProfile = useUpdateProfile(userId);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: currentName },
  });

  const onSubmit = handleSubmit((values) => {
    setSavedJustNow(false);
    updateProfile.mutate(
      { name: values.name },
      { onSuccess: () => setSavedJustNow(true) },
    );
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={updateProfile.error} />
      {savedJustNow && !isDirty && (
        <p
          className="ui-badge ui-badge--success"
          style={{ marginBottom: 'var(--space-3)' }}
        >
          Saved
        </p>
      )}
      <TextField
        label="Name"
        error={errors.name?.message}
        {...register('name')}
      />
      <Button type="submit" isLoading={updateProfile.isPending}>
        Save name
      </Button>
    </form>
  );
}
