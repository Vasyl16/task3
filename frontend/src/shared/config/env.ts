type PublicEnvVar = 'VITE_API_URL' | 'VITE_WS_URL';

function readRequiredEnvVar(key: PublicEnvVar): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

// Public, browser-exposed configuration only — never put a secret here.
export const env = {
  apiUrl: readRequiredEnvVar('VITE_API_URL'),
  wsUrl: readRequiredEnvVar('VITE_WS_URL'),
} as const;
