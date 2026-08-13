import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { QueueName } from '../queue/queue.constants';
import { RealtimeConsumer } from './consumers/realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeRoomsService } from './realtime-rooms.service';

// Self-contained by design: no business module imports this, and this
// imports no business module. It learns about domain facts exclusively
// through the outbox -> BullMQ pipeline, which is what lets the whole
// real-time layer be added, changed, or removed without touching a
// single business rule.
//
// JwtModule.register({}) gives this module its own JwtService for
// verifying handshake tokens — the secret is passed explicitly at verify
// time (see RealtimeGateway.accessSecret), from the same config value
// JwtAccessStrategy uses, so HTTP and WebSocket can never drift onto
// different keys.
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.REALTIME }),
    JwtModule.register({}),
  ],
  providers: [RealtimeGateway, RealtimeRoomsService, RealtimeConsumer],
})
export class RealtimeModule {}
