import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, ErrorAlert, TextField } from '../../../shared/ui';
import { registerSchema } from '../model/auth-schemas';
import type { RegisterFormValues } from '../model/auth-schemas';
import { useAuth } from '../model/use-auth';

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { register: registerAccount } = useAuth();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await registerAccount(values);
      onSuccess();
    } catch (error) {
      // A duplicate email comes back as a 409 with the backend's own
      // wording, which ErrorAlert shows as-is — restating it here would
      // mean maintaining the same sentence in two places.
      setSubmitError(error);
    }
  });

  return (
    // void: handleSubmit returns a promise, and onSubmit expects a void
    // return. Rejections are already caught inside the handler.
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={submitError} />

      <TextField
        label="Name"
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Button type="submit" isLoading={isSubmitting}>
        Create account
      </Button>
    </form>
  );
}
