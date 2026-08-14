import { z } from 'zod';

// Mirrors CreateProductDto — see .claude/rules/frontend.md, the backend
// re-validates every one of these and is the authority. Plain z.number()
// rather than z.coerce.number(): RHF's `valueAsNumber` on the input does
// the string->number conversion before validation, keeping the schema's
// input/output types identical (z.coerce's input type is `unknown`,
// which breaks zodResolver's generic inference against useForm<T>).
export const createProductSchema = z.object({
  categoryId: z.uuid('Choose a category'),
  name: z.string().trim().min(1, 'Enter a product name'),
  slug: z
    .string()
    .trim()
    .min(1, 'Enter a URL slug')
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  description: z.string().trim().optional(),
  basePrice: z.number().min(0.01, 'Price must be at least $0.01'),
  type: z.enum(['FIXED_PRICE', 'AUCTION']),
  initialQuantity: z
    .number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity cannot be negative'),
});

export type CreateProductFormValues = z.infer<typeof createProductSchema>;

// Mirrors UpdateProductDto — a deliberately smaller surface than create:
// the backend doesn't allow changing category, slug, or type through
// this route. quantityAvailable is optional here (not just per Zod, but
// as a matter of UX): EditProductForm only renders that field once the
// realtime stock snapshot has arrived (see use-product-stock.ts), so a
// submit before it loads must still validate.
export const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Enter a product name'),
  description: z.string().trim().optional(),
  basePrice: z.number().min(0.01, 'Price must be at least $0.01'),
  quantityAvailable: z
    .number()
    .int('Stock must be a whole number')
    .min(0, 'Stock cannot be negative')
    .optional(),
});

export type UpdateProductFormValues = z.infer<typeof updateProductSchema>;
