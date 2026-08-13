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
})
  .unknown(true) // process.env has many unrelated vars (PATH, HOME, ...)
  .required();
