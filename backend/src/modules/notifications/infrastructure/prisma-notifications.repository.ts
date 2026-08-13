import { Injectable } from '@nestjs/common';
import type { Prisma, Notification } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateNotificationInput,
  NotificationsRepository,
} from '../domain/notifications.repository';

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

  create(
    tx: Prisma.TransactionClient,
    data: CreateNotificationInput,
  ): Promise<Notification> {
    return tx.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        data: data.data as Prisma.InputJsonValue,
      },
    });
  }
}
