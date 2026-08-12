import type { Notification } from '@prisma/client';

export abstract class NotificationsRepository {
  abstract findForUser(
    userId: string,
    filter?: { unreadOnly?: boolean },
  ): Promise<Notification[]>;
  abstract findById(id: string): Promise<Notification | null>;
  abstract markRead(id: string): Promise<Notification>;
}
