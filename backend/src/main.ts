import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { AppLogger } from './core/logging/app-logger.service';
import { setupSwagger, SWAGGER_PATH } from './core/openapi/swagger.setup';
import { ConfiguredIoAdapter } from './infrastructure/realtime/realtime.adapter';

async function bootstrap() {
  // bufferLogs holds Nest's own bootstrap logs until useLogger() below,
  // so even framework startup lines come out as structured JSON rather
  // than the default pretty format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));

  const configService = app.get(ConfigService<AppConfig, true>);

  const corsOrigin = configService.get('corsOrigin', { infer: true });
  app.enableCors({ origin: corsOrigin });
  // Same origin policy for the Socket.IO handshake as for REST — see
  // ConfiguredIoAdapter for why this isn't on the gateway decorator.
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, corsOrigin));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Registered after the global pipe so the documented request shapes
  // match what validation actually accepts.
  setupSwagger(app);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  app
    .get(AppLogger)
    .log({ event: 'app.started', port, docs: `/${SWAGGER_PATH}` });
}
// void: bootstrap() is the process entrypoint — there is no caller to
// hand the promise to, and an unhandled rejection here should crash.
void bootstrap();
