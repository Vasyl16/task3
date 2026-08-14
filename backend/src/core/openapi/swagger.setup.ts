import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';
export const BEARER_AUTH = 'access-token';

// Written for someone who has just cloned the repo and wants to drive the
// API by hand. The description below is the orientation they need before
// the endpoint list makes sense — which token to get, how roles work, and
// which two mechanisms are NOT interchangeable (Idempotency-Key for
// retried commands vs. the outbox's own event dedupe).
const DESCRIPTION = `
Multi-vendor marketplace API — a NestJS modular monolith over PostgreSQL,
with Redis/BullMQ for async work and Meilisearch as a search read model.

### Getting a token

1. \`POST /auth/register\` or \`POST /auth/login\` returns
   \`{ accessToken, refreshToken }\`.
2. Click **Authorize** and paste the \`accessToken\`.
3. Access tokens expire (15m by default). \`POST /auth/refresh\` rotates
   the pair; presenting an already-rotated refresh token is treated as a
   compromise and revokes every session for that user.

Seeded accounts share the password \`SeedPass123!\` — see
\`backend/prisma/seed.ts\`.

### Authentication and authorization

Every route requires a valid access token unless marked as public. Roles
(\`CUSTOMER\` / \`SELLER\` / \`ADMIN\`) gate *which* endpoints a caller may
reach; they never decide *which records* a caller may touch. Ownership is
enforced separately, inside each service — so a \`SELLER\` token gets you
to \`PATCH /products/{id}\`, but only your own products come back 200.

A note on the status codes you will see when probing someone else's data:
routes return **404, not 403**, for a record that exists but isn't yours.
That is deliberate — a 403 would confirm the id exists to someone with no
business knowing that. A 403 means "your role is wrong", not "this isn't
yours".

### Idempotency

Two distinct mechanisms, deliberately not interchangeable:

- **\`Idempotency-Key\` header** (this API) — guards a *client* retrying a
  command. Send one on \`POST /orders/checkout\` and on bids; a retry with
  the same key returns the original response instead of acting twice.
- **Event dedupe** (internal) — guards a *queue* redelivering an event to
  a consumer. Not visible over HTTP.

### Rate limiting

Credential endpoints (\`/auth/register\`, \`/auth/login\`, \`/auth/refresh\`)
carry a strict per-IP limit; everything else gets a much more generous
one. Exceeding either returns **429**.
`;

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Multi-Vendor Marketplace API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Paste the accessToken from /auth/login (no "Bearer " prefix).',
      },
      BEARER_AUTH,
    )
    .addTag('auth', 'Registration, login, refresh-token rotation, logout')
    .addTag(
      'products',
      'Catalogue browsing and seller-owned product management',
    )
    .addTag('categories', 'Category tree (admin-managed)')
    .addTag(
      'search',
      'Full-text / faceted product search (Meilisearch read model)',
    )
    .addTag('cart', 'The caller’s own cart — multi-vendor by nature')
    .addTag('orders', 'Checkout, order history, seller fulfilment')
    .addTag('auctions', 'Auction lots and bidding')
    .addTag('sellers', 'Becoming a seller; seller profiles')
    .addTag('users', 'User profiles — self, or ADMIN')
    .addTag('payments-ledger', 'Seller ledgers and refunds')
    .addTag('disputes', 'Customer-raised disputes')
    .addTag('notifications', 'The caller’s own notifications')
    .addTag('analytics', 'Seller-facing analytics')
    .addTag('admin', 'Admin-only: moderation, disputes, platform analytics')
    .addTag('health', 'Liveness and Prometheus metrics')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: {
      // Survives a page reload, so a reviewer isn't re-pasting a token
      // after every navigation.
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Marketplace API docs',
  });
}
