import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Guard rejection happens before any DB access, so this doesn't need a
// real database — see backend/test/jest-e2e-setup.ts.
describe('Global auth guard (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's bootstrap() — e2e tests build their own
    // application instance and don't go through main.ts, so anything
    // registered there (global pipes, CORS, ...) must be repeated here.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('rejects a protected route with no token', () => {
    return request(app.getHttpServer()).get('/users/some-id').expect(401);
  });

  it('rejects a protected route with a garbage token', () => {
    return request(app.getHttpServer())
      .get('/users/some-id')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('allows a @Public() route with no token (not a 401 — DB connectivity is separate)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .then((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  it('rejects register with an invalid payload (DTO validation)', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', password: '123', name: '' })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
