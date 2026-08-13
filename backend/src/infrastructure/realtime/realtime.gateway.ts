import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { UserRole } from '@prisma/client';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import type { AppConfig } from '../../config/configuration';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { SubscribeRoomDto } from './dto/subscribe-room.dto';
import {
  CONNECTED_EVENT,
  parseRoom,
  REALTIME_NAMESPACE,
  RESYNC_MESSAGE,
  SUBSCRIBE_MESSAGE,
  UNSUBSCRIBE_MESSAGE,
  type ParsedRoom,
} from './realtime.constants';
import {
  RealtimeAckError,
  type RealtimeAck,
  type RealtimeEnvelope,
} from './realtime-message.interface';
import { RealtimeRoomsService } from './realtime-rooms.service';
import { MetricsService } from '../metrics/metrics.service';

interface RealtimeSocketData {
  user: AuthenticatedUser | null;
}

type RealtimeSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  RealtimeSocketData
>;

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

// The ONLY component in the app that knows Socket.IO exists. Business
// services never inject it and never emit anything; the sole caller of
// broadcast() is RealtimeConsumer, which is driven by the outbox/BullMQ
// pipeline (see consumers/realtime.consumer.ts). That is what keeps the
// WebSocket layer separable from business logic: delete this directory
// and every domain rule still works, unchanged.
//
// Nothing here writes to Postgres. A client cannot mutate state over the
// socket — the only messages accepted are subscribe/unsubscribe/resync,
// all read-only. Every state change still goes through the authenticated,
// validated, transactional REST path.
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly rooms: RealtimeRoomsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly metrics: MetricsService,
  ) {}

  // Anonymous connections are allowed on purpose — public rooms
  // (product/auction) carry data that is already public over REST, and
  // requiring a token would mean a logged-out visitor watching an
  // auction gets no live price. Identity is established here when a
  // token IS supplied, and every private room re-checks it at subscribe
  // time; a connection is never trusted for more than what its verified
  // identity allows.
  async handleConnection(client: RealtimeSocket): Promise<void> {
    this.metrics.recordWebsocketConnection(1);
    const token = extractToken(client);
    if (!token) {
      client.data.user = null;
      client.emit(CONNECTED_EVENT, { authenticated: false });
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: this.accessSecret() },
      );
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      client.emit(CONNECTED_EVENT, {
        authenticated: true,
        userId: payload.sub,
      });
    } catch {
      // Deliberately a disconnect rather than a silent downgrade to
      // anonymous: an access token expiring mid-session is routine, and
      // a client that quietly kept an anonymous socket open would stop
      // receiving its order updates with no signal that anything was
      // wrong. Closing the socket makes the client refresh and
      // reconnect, which re-runs the resync path anyway.
      client.emit(CONNECTED_EVENT, {
        authenticated: false,
        error: 'INVALID_TOKEN',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: RealtimeSocket): void {
    this.metrics.recordWebsocketConnection(-1);
    // Socket.IO removes the socket from all its rooms itself; there is
    // no server-side subscription state to clean up, which is precisely
    // why a reconnect can be handled by re-subscribing from scratch.
    this.logger.debug(
      `realtime client disconnected (userId=${client.data.user?.id ?? 'anonymous'})`,
    );
  }

  // Join + fetch-current-state in ONE round trip. A reconnecting client
  // re-sends this for each room it cares about and is immediately back
  // in sync — it does not need to know what it missed, ask for a replay,
  // or trust any cached value it held across the gap. This is the
  // reconnect strategy: state is re-read from Postgres, not replayed
  // from a message log.
  @SubscribeMessage(SUBSCRIBE_MESSAGE)
  async subscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() dto: SubscribeRoomDto,
  ): Promise<RealtimeAck> {
    const resolved = await this.resolveAndAuthorize(client, dto.room);
    if (!resolved.ok) {
      return resolved.ack;
    }

    const snapshot = await this.rooms.snapshot(resolved.room);
    if (!snapshot) {
      return {
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
        message: `${resolved.room.name} does not exist`,
      };
    }

    await client.join(resolved.room.name);
    this.metrics.recordWebsocketSubscription(resolved.room.type, 'allowed');
    return { ok: true, snapshot };
  }

  @SubscribeMessage(UNSUBSCRIBE_MESSAGE)
  async unsubscribe(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() dto: SubscribeRoomDto,
  ): Promise<RealtimeAck> {
    const room = parseRoom(dto.room);
    if (!room) {
      return invalidRoomAck(dto.room);
    }
    await client.leave(room.name);
    return { ok: true };
  }

  // Same snapshot as subscribe, without re-joining — for a client that
  // is still connected but suspects it drifted (tab was backgrounded, a
  // render was dropped, a broadcast arrived out of order). Re-authorized
  // every time: membership granted earlier is never taken as proof of
  // continued access.
  @SubscribeMessage(RESYNC_MESSAGE)
  async resync(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() dto: SubscribeRoomDto,
  ): Promise<RealtimeAck> {
    const resolved = await this.resolveAndAuthorize(client, dto.room);
    if (!resolved.ok) {
      return resolved.ack;
    }
    const snapshot = await this.rooms.snapshot(resolved.room);
    if (!snapshot) {
      return {
        ok: false,
        error: RealtimeAckError.NOT_FOUND,
        message: `${resolved.room.name} does not exist`,
      };
    }
    return { ok: true, snapshot };
  }

  // Called only by RealtimeConsumer. Fire-and-forget by nature: emitting
  // to a room with no members is a no-op, and there is no delivery
  // acknowledgement to wait for — which is exactly why no business
  // decision may ever depend on this having happened.
  broadcast(envelope: RealtimeEnvelope): void {
    if (!this.server) {
      // The socket server isn't up yet (a queued job beat gateway
      // initialization). Throwing lets BullMQ retry with backoff, which
      // is the one case where a retry genuinely helps — unlike a normal
      // broadcast failure, nothing was delivered to anyone.
      throw new Error('Realtime server is not initialized yet');
    }
    this.server.to(envelope.room).emit(envelope.event, envelope);
  }

  private async resolveAndAuthorize(
    client: RealtimeSocket,
    rawRoom: string,
  ): Promise<{ ok: true; room: ParsedRoom } | { ok: false; ack: RealtimeAck }> {
    const room = parseRoom(rawRoom);
    if (!room) {
      return { ok: false, ack: invalidRoomAck(rawRoom) };
    }
    const decision = await this.rooms.authorize(room, client.data.user ?? null);
    if (!decision.allowed) {
      this.metrics.recordWebsocketSubscription(room.type, 'denied');
      return {
        ok: false,
        ack: {
          ok: false,
          error: decision.error,
          message: decision.message,
        },
      };
    }
    return { ok: true, room };
  }

  private accessSecret(): string {
    const secret = this.configService.get('jwt.accessSecret', { infer: true });
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required but was not resolved');
    }
    return secret;
  }
}

function invalidRoomAck(room: string): RealtimeAck {
  return {
    ok: false,
    error: RealtimeAckError.INVALID_ROOM,
    message: `"${room}" is not a valid room name`,
  };
}

// Browsers can't set headers on a WebSocket handshake, so socket.io's
// `auth` payload is the primary channel; the Authorization header is
// accepted too for non-browser clients (and for tests).
function extractToken(client: RealtimeSocket): string | null {
  const auth = client.handshake.auth as { token?: unknown };
  if (typeof auth.token === 'string' && auth.token.length > 0) {
    return auth.token.replace(/^Bearer /i, '');
  }
  const header = client.handshake.headers.authorization;
  if (
    typeof header === 'string' &&
    header.toLowerCase().startsWith('bearer ')
  ) {
    return header.slice(7);
  }
  return null;
}
