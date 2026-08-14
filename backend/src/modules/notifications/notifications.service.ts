import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Notification } from '@prisma/client';
import {
  CreateNotificationInput,
  NotificationsRepository,
} from './domain/notifications.repository';

// This is the resync-on-reconnect source of truth per ../../CLAUDE.md:
// WebSocket delivery (not implemented yet — needs @nestjs/websockets) is
// best-effort only; a client can always rebuild full current state from
// this REST surface.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  findForUser(
    userId: string,
    filter?: { unreadOnly?: boolean },
  ): Promise<Notification[]> {
    return this.notificationsRepository.findForUser(userId, filter);
  }

  // Someone else's notification is indistinguishable from a missing one:
  // the response body carries the notification's title/body/data, so
  // without this check a valid token from any account was enough to read
  // another user's notification content by id.
  async markRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.notificationsRepository.findById(id);
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return this.notificationsRepository.markRead(id);
  }

  // Called by NotificationsConsumer, inside the transaction
  // EventIdempotencyService opened for its ProcessedEvent marker — see
  // domain/notifications.repository.ts.
  create(
    tx: Prisma.TransactionClient,
    data: CreateNotificationInput,
  ): Promise<Notification> {
    return this.notificationsRepository.create(tx, data);
  }
}
