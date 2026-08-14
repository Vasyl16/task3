import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button, ErrorAlert, Textarea, TextField } from '../../../shared/ui';
import { applySellerSchema } from '../model/apply-seller-schema';
import type { ApplySellerFormValues } from '../model/apply-seller-schema';
import { useApplySeller } from '../model/use-apply-seller';

export function ApplySellerForm() {
  const applySeller = useApplySeller();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ApplySellerFormValues>({
    resolver: zodResolver(applySellerSchema),
    defaultValues: { businessName: '', description: '' },
  });

  const onSubmit = handleSubmit((values) => {
    applySeller.mutate(values);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <ErrorAlert error={applySeller.error} />
      <TextField
        label="Business name"
        error={errors.businessName?.message}
        {...register('businessName')}
      />
      <Textarea
        label="Tell us about your business (optional)"
        error={errors.description?.message}
        {...register('description')}
      />
      <Button type="submit" isLoading={applySeller.isPending}>
        Submit application
      </Button>
    </form>
  );
}
