import { Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { NotificationsRepository } from './domain/notifications.repository';

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

  async markRead(id: string): Promise<Notification> {
    const notification = await this.notificationsRepository.findById(id);
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return this.notificationsRepository.markRead(id);
  }
}
