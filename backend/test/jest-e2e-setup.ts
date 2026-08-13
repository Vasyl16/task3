import * as dotenv from 'dotenv';

// Loads backend/.env if present — the same file `npm run start:dev` uses
// — so e2e tests that need real integration (checkout, bidding
// concurrency: see checkout.e2e-spec.ts, bidding-concurrency.e2e-spec.ts)
// run against the real configured DATABASE_URL, not a stand-in. dotenv
// never overrides an already-set process.env var, so this is a no-op in
// any environment that already provides these (e.g. CI secrets).
dotenv.config();

// Fallback dummies ONLY if no real .env / real values were available —
// this is what keeps the guard-only tests (auth.e2e-spec.ts: rejecting
// unauthenticated/invalid requests, which never reach the database)
// runnable with zero setup, in any environment.
// Unconditionally off (not ??=): the file sink exists to feed Promtail,
// and a test run must never append to the log stream a developer is
// watching in Grafana — nor create files as a side effect of testing.
process.env.LOG_FILE = '';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test_db';
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_min_16_chars';
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_min_16_chars';
