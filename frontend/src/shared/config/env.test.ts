import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads VITE_API_URL and VITE_WS_URL when present', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    vi.stubEnv('VITE_WS_URL', 'ws://localhost:3000');

    const { env } = await import('./env');

    expect(env.apiUrl).toBe('http://localhost:3000');
    expect(env.wsUrl).toBe('ws://localhost:3000');
  });

  it('throws a clear error when a required var is missing', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_WS_URL', 'ws://localhost:3000');

    await expect(import('./env')).rejects.toThrow(
      'Missing required environment variable: VITE_API_URL',
    );
  });
});
