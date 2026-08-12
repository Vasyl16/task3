import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationsRepository } from '../domain/notifications.repository';

@Injectable()
export class PrismaNotificationsRepository implements NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForUser(
    userId: string,
    filter?: { unreadOnly?: boolean },
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        userId,
        readAt: filter?.unreadOnly ? null : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  markRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
