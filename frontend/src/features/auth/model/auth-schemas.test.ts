import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth-schemas';

describe('loginSchema', () => {
  it('accepts a well-formed credential pair', () => {
    expect(
      loginSchema.safeParse({ email: 'buyer@example.com', password: 'secret' })
        .success,
    ).toBe(true);
  });

  it('rejects a malformed email and an empty password', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts a complete registration', () => {
    expect(
      registerSchema.safeParse({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'longenough',
      }).success,
    ).toBe(true);
  });

  // Mirrors RegisterDto's @MinLength(8). The backend enforces this
  // regardless; matching it here only saves the user a round trip.
  it('rejects a password shorter than the backend minimum of 8', () => {
    const result = registerSchema.safeParse({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a name that is only whitespace', () => {
    const result = registerSchema.safeParse({
      name: '   ',
      email: 'ada@example.com',
      password: 'longenough',
    });

    expect(result.success).toBe(false);
  });
});
