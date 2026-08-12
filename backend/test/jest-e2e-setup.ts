// Dummy values only — enough to satisfy env validation so the app can
// boot in e2e tests. Not a real database; nothing connects to it yet.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test_db';
process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_min_16_chars';
process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_min_16_chars';
