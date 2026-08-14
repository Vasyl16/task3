import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { closeApp } from './support/close-app';

// jest-e2e-setup.ts disables throttling for every other e2e file (they
// register and log in far more often than a human would). This file
// re-enables it with deliberately tiny limits, set BEFORE AppModule is
// imported and compiled — ConfigModule reads process.env at module
// initialization, so the values have to be in place first.
const AUTH_LIMIT = 3;
const DEFAULT_LIMIT = 20;

process.env.THROTTLE_TTL_SECONDS = '60';
process.env.THROTTLE_AUTH_LIMIT = String(AUTH_LIMIT);
process.env.THROTTLE_LIMIT = String(DEFAULT_LIMIT);

/* eslint-disable @typescript-eslint/no-require-imports */
const { AppModule } = require('../src/app.module') as {
  AppModule: new () => unknown;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Rate limiting exists for one reason: without it, an attacker gets
// unlimited guesses at a password. The two limits are separate on
// purpose — a shopper browsing a catalogue legitimately fires far more
// requests than anyone legitimately logs in.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Same pipe main.ts installs — without it a malformed registration
    // would reach the service and actually create a user.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await closeApp(app);
  });

  function http() {
    return request(app.getHttpServer());
  }

  describe('credential endpoints (strict limit)', () => {
    it('stops password guessing after the strict limit, with 429 not 401', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_LIMIT + 3; i++) {
        const res = await http()
          .post('/auth/login')
          .send({ email: 'nobody@example.com', password: 'WrongPassword1!' });
        statuses.push(res.status);
      }

      // The first few are honest credential rejections; everything past
      // the limit is refused without the app doing any bcrypt work.
      expect(statuses.slice(0, AUTH_LIMIT).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(AUTH_LIMIT).every((s) => s === 429)).toBe(true);
    });

    // Buckets are per handler, not per controller — exhausting login
    // does not pre-emptively lock refresh. That is the right shape here:
    // login is the endpoint where guesses convert into a compromised
    // password, and each of the other credential routes carries the same
    // strict limit on its own account rather than borrowing login's.
    it('gives refresh its own strict limit, independent of login’s', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_LIMIT + 2; i++) {
        const res = await http()
          .post('/auth/refresh')
          .send({ refreshToken: 'not-a-real-token' });
        statuses.push(res.status);
      }

      // Not throttled from the outset (login's exhausted bucket is a
      // different one), but throttled once its own is spent.
      expect(statuses[0]).not.toBe(429);
      expect(statuses.at(-1)).toBe(429);
    });

    // The limiter runs ahead of the validation pipe, so a flood of
    // malformed bodies is refused just as fast as a flood of valid ones
    // — an attacker can't buy extra attempts by sending junk.
    it('throttles register before the payload is even validated', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_LIMIT + 2; i++) {
        const res = await http()
          .post('/auth/register')
          .send({ email: 'not-an-email', password: 'x', name: '' });
        statuses.push(res.status);
      }

      expect(statuses[0]).toBe(400);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  describe('everything else (generous default limit)', () => {
    // A limit low enough to protect credentials would break ordinary
    // browsing, so the two are configured independently. This asserts
    // the catalogue really does get the generous bucket, not the strict
    // one — the bug that a single shared limiter would introduce.
    it('serves more catalogue requests than the strict auth limit allows', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < AUTH_LIMIT + 4; i++) {
        const res = await http().get('/products');
        statuses.push(res.status);
      }
      expect(statuses.every((s) => s !== 429)).toBe(true);
    });

    it('still refuses once the default limit is genuinely exhausted', async () => {
      let sawLimit = false;
      for (let i = 0; i < DEFAULT_LIMIT + 5; i++) {
        const res = await http().get('/products');
        if (res.status === 429) {
          sawLimit = true;
          break;
        }
      }
      expect(sawLimit).toBe(true);
    });
  });
});
