import { z } from 'zod';

// Mirrors UpdateUserDto (@IsOptional @IsString name) — purely for UX,
// the backend re-validates and is the authority.
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
});

export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;
