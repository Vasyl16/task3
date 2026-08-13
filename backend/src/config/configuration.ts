export interface AppConfig {
  env: string;
  port: number;
  corsOrigin: string;
  database: {
    url: string | undefined;
  };
  redis: {
    url: string;
  };
  meilisearch: {
    host: string;
    masterKey: string | undefined;
  };
  log: {
    level: string;
    // Mirror of the JSON log lines for Promtail to tail. Empty string
    // disables the file sink — set it that way anywhere the process's
    // stdout is already being collected.
    file: string;
  };
  jwt: {
    accessSecret: string | undefined;
    accessExpiresIn: string;
    refreshSecret: string | undefined;
    refreshExpiresIn: string;
  };
  googleOAuth: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    callbackUrl: string | undefined;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  database: {
    // PostgreSQL is remote — never defaulted to a local address.
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  meilisearch: {
    host: process.env.MEILISEARCH_HOST ?? 'http://localhost:7700',
    masterKey: process.env.MEILI_MASTER_KEY,
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    file: process.env.LOG_FILE ?? 'logs/app.log',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
});
