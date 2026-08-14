import { z } from 'zod';

// These mirror the backend's LoginDto/RegisterDto constraints, and exist
// purely so a user gets told about an empty field without a round trip.
// They are NOT the enforcement: the backend re-validates every one of
// these with class-validator, and it is that check which is
// authoritative. Where the two ever disagree, the backend wins and its
// message is what gets shown.

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.email('Enter a valid email address'),
  // Matches RegisterDto's @MinLength(8).
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
