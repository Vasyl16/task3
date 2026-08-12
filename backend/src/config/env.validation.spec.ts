import { envValidationSchema } from './env.validation';

interface ValidatedEnv {
  PORT: number;
  REDIS_URL: string;
  MEILI_MASTER_KEY: string;
}

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@remote-host:5432/marketplace',
  JWT_ACCESS_SECRET: 'a'.repeat(16),
  JWT_REFRESH_SECRET: 'b'.repeat(16),
};

describe('envValidationSchema', () => {
  it('accepts a minimal valid env and fills in defaults', () => {
    const result = envValidationSchema.validate(validEnv, {
      abortEarly: false,
    });
    const value = result.value as ValidatedEnv;

    expect(result.error).toBeUndefined();
    expect(value.PORT).toBe(3000);
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
    expect(value.MEILI_MASTER_KEY).toBe('changeme_dev_master_key');
  });

  it('rejects a missing DATABASE_URL', () => {
    const rest: Record<string, string> = { ...validEnv };
    delete rest.DATABASE_URL;
    const { error } = envValidationSchema.validate(rest, {
      abortEarly: false,
    });

    expect(error?.message).toContain('DATABASE_URL');
  });

  it('rejects a DATABASE_URL pointing at a non-postgres scheme', () => {
    const { error } = envValidationSchema.validate(
      { ...validEnv, DATABASE_URL: 'mysql://user:pass@host:3306/db' },
      { abortEarly: false },
    );

    expect(error?.message).toContain('DATABASE_URL');
  });

  it('rejects a JWT secret that is too short', () => {
    const { error } = envValidationSchema.validate(
      { ...validEnv, JWT_ACCESS_SECRET: 'short' },
      { abortEarly: false },
    );

    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });
});
