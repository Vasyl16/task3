import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, ErrorAlert, TextField } from '../../../shared/ui';
import { loginSchema } from '../model/auth-schemas';
import type { LoginFormValues } from '../model/auth-schemas';
import { useAuth } from '../model/use-auth';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth();
  // Server-side failures are held separately from field errors: a "wrong
  // email or password" 401 belongs to the form as a whole, not to one
  // input, and clearing it on the next submit is the desired behaviour.
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values);
      onSuccess();
    } catch (error) {
      setSubmitError(error);
    }
  });

  return (
    // void: handleSubmit returns a promise, and onSubmit expects a void
    // return. Rejections are already caught inside the handler.
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={submitError} />

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
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Button type="submit" isLoading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
