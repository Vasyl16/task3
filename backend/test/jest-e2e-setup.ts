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

// Rate limiting off for e2e. A test file registers and logs in far more
// often than any human would — all from one IP — so the real limits
// would reject requests for reasons unrelated to what is being tested
// and make failures look like product bugs. throttling.e2e-spec.ts sets
// its own low limits before compiling its module, so the limiter itself
// is still covered.
//
// Unconditional (not ??=), like LOG_FILE above, and for the same kind of
// reason: dotenv.config() has already run, so a developer's own
// THROTTLE_* values in backend/.env would otherwise win and decide
// whether the concurrency suites pass. That is exactly what happened —
// the suite was green only because a local .env carried inflated limits,
// and would have failed in CI, which sets none.
process.env.THROTTLE_LIMIT = '1000000';
process.env.THROTTLE_AUTH_LIMIT = '1000000';
