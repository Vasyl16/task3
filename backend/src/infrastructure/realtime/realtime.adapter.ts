import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

// @WebSocketGateway()'s options are a compile-time decorator argument,
// so CORS can't be read from ConfigService there. Applying it through
// the adapter instead keeps CORS_ORIGIN as the single source for both
// the HTTP and WebSocket origins — a gateway-level literal would be a
// second place to forget to update.
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
  }
}
