import { z } from 'zod';

export const applySellerSchema = z.object({
  businessName: z.string().trim().min(1, 'Enter your business name'),
  description: z.string().trim().optional(),
});

export type ApplySellerFormValues = z.infer<typeof applySellerSchema>;
