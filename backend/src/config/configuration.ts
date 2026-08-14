export interface AppConfig {
  env: string;
  port: number;
  corsOrigin: string;
  database: {
    url: string | undefined;
    poolMax: number;
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
  email: {
    resendApiKey: string | undefined;
    fromEmail: string;
  };
  payments: {
    gatewayFailureRate: number;
  };
  throttle: {
    ttlSeconds: number;
    limit: number;
    authLimit: number;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  database: {
    // PostgreSQL is remote — never defaulted to a local address.
    url: process.env.DATABASE_URL,
    // node-postgres' own default is 10. Every interactive transaction
    // holds a connection for its full duration, so this is the real cap
    // on concurrent writes — see PrismaService.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
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
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.EMAIL_FROM_ADDRESS ?? 'no-reply@marketplace.test',
  },
  payments: {
    // 0..1 — the mock gateway's simulated decline rate. 0 in normal use;
    // raise it to exercise the refund saga's retry/escalation path.
    gatewayFailureRate: Number(process.env.PAYMENT_GATEWAY_FAILURE_RATE ?? 0),
  },
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    // Deliberately generous: a shopper browsing a catalogue fires a lot
    // of requests, and several users behind one NAT share this bucket.
    // This is the "stop a script hammering the API" limit, not the
    // anti-brute-force one — that's authLimit.
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '300', 10),
    // Credential endpoints only. Low on purpose: no human logs in ten
    // times a minute, and this is the one place where an unlimited
    // request rate converts directly into compromised accounts.
    authLimit: parseInt(process.env.THROTTLE_AUTH_LIMIT ?? '10', 10),
  },
});
