import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { closeApp } from './support/close-app';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Covers the HTTP end of the correlation chain and the metrics endpoint
// over real HTTP. The worker end (a job re-entering the same context) is
// asserted in domain-event.consumer.spec.ts, and the logger's own
// behaviour in app-logger.service.spec.ts — together those three cover
// HTTP -> service -> outbox -> queue -> worker -> handler.
describe('Observability (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
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

  describe('correlation id', () => {
    it('honours a client-supplied X-Correlation-ID and echoes it back', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('X-Correlation-ID', 'client-supplied-id-123');

      expect(res.headers['x-correlation-id']).toBe('client-supplied-id-123');
    });

    it('generates a UUID when the client supplies none', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(res.headers['x-correlation-id']).toMatch(UUID_PATTERN);
    });

    it('gives two separate requests two different generated ids', async () => {
      const [first, second] = await Promise.all([
        request(app.getHttpServer()).get('/health'),
        request(app.getHttpServer()).get('/health'),
      ]);

      expect(first.headers['x-correlation-id']).not.toBe(
        second.headers['x-correlation-id'],
      );
    });

    // The header is set by middleware, which runs before routing — so
    // even a request that matches no route is traceable.
    it('still returns a correlation id on an unmatched route', async () => {
      const res = await request(app.getHttpServer()).get('/no-such-route');

      expect(res.status).toBe(404);
      expect(res.headers['x-correlation-id']).toMatch(UUID_PATTERN);
    });
  });

  describe('GET /metrics', () => {
    it('is scrapeable without authentication, as Prometheus requires', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('exposes Node process metrics', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');

      expect(res.text).toContain('process_cpu_user_seconds_total');
      expect(res.text).toContain('nodejs_eventloop_lag_seconds');
    });

    it('declares the business metrics the spec asks for', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');

      for (const metric of [
        'marketplace_checkout_attempts_total',
        'marketplace_orders_placed_total',
        'marketplace_bids_total',
        'marketplace_inventory_units_total',
        'queue_jobs_total',
        'outbox_events_published_total',
        'websocket_connections_current',
      ]) {
        expect(res.text).toContain(metric);
      }
    });

    it('counts HTTP traffic, labelled by route pattern', async () => {
      await request(app.getHttpServer()).get('/health');

      const res = await request(app.getHttpServer()).get('/metrics');

      expect(res.text).toContain('http_requests_total{');
      expect(res.text).toMatch(/route="\/health"/);
      expect(res.text).toContain('http_request_duration_seconds_bucket');
    });

    // Guards the cardinality rule: an id in the URL must never become
    // part of a metric label.
    it('does not leak a path parameter value into a label', async () => {
      await request(app.getHttpServer()).get(
        '/products/1111aaaa-2222-bbbb-3333-cccccccccccc',
      );

      const res = await request(app.getHttpServer()).get('/metrics');

      expect(res.text).not.toContain('1111aaaa-2222-bbbb-3333-cccccccccccc');
      expect(res.text).toMatch(/route="\/products\/:id"/);
    });
  });
});
