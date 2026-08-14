import * as Joi from 'joi';

// Validated once at bootstrap (see ConfigModule.forRoot in app.module.ts).
// No default here means the var is required and has no safe fallback —
// the app fails fast at startup rather than limping along misconfigured.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),

  // PostgreSQL — remote, always required, never defaulted to a local address.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  // Concurrent-write ceiling, not a performance knob — see
  // PrismaService. Keep it under whatever the database itself allows.
  DATABASE_POOL_MAX: Joi.number().min(1).max(200).default(10),

  // Redis — BullMQ's backing store, provided by docker-compose locally.
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),

  // Meilisearch — search/read index, provided by docker-compose locally.
  MEILISEARCH_HOST: Joi.string().uri().default('http://localhost:7700'),
  MEILI_MASTER_KEY: Joi.string().min(1).default('changeme_dev_master_key'),

  // Structured logging (see core/logging/app-logger.service.ts).
  // LOG_FILE is what Promtail tails; allow '' to turn the file sink off.
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  LOG_FILE: Joi.string().allow('').default('logs/app.log'),

  // JWT — required, no safe default for a secret.
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Google OAuth — not wired up yet, optional placeholders.
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().allow('').optional(),

  // Email (Resend) — optional. An unset RESEND_API_KEY means
  // EmailService logs and skips sending rather than failing checkout;
  // see modules/email/email.service.ts.
  RESEND_API_KEY: Joi.string().allow('').optional(),
  EMAIL_FROM_ADDRESS: Joi.string().email().default('no-reply@marketplace.test'),

  // Mock payment gateway — see MockPaymentGatewayService. Only a test/
  // demo knob: it makes refunds fail on purpose so the saga's escalation
  // path can be exercised without editing code.
  PAYMENT_GATEWAY_FAILURE_RATE: Joi.number().min(0).max(1).default(0),

  // Rate limiting (see core/core.module.ts). Per client IP, per window.
  // Raise THROTTLE_LIMIT for load testing — see the load-test section of
  // ../README.md, which measures the concurrency strategy, not the
  // throttle.
  THROTTLE_TTL_SECONDS: Joi.number().min(1).default(60),
  THROTTLE_LIMIT: Joi.number().min(1).default(300),
  THROTTLE_AUTH_LIMIT: Joi.number().min(1).default(10),
})
  .unknown(true) // process.env has many unrelated vars (PATH, HOME, ...)
  .required();
