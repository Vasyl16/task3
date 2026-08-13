import type { Prisma, Notification } from '@prisma/client';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export abstract class NotificationsRepository {
  abstract findForUser(
    userId: string,
    filter?: { unreadOnly?: boolean },
  ): Promise<Notification[]>;
  abstract findById(id: string): Promise<Notification | null>;
  abstract markRead(id: string): Promise<Notification>;
  // Takes the caller's transaction client — NotificationsConsumer creates
  // this in the same transaction as its ProcessedEvent idempotency
  // marker (see EventIdempotencyService).
  abstract create(
    tx: Prisma.TransactionClient,
    data: CreateNotificationInput,
  ): Promise<Notification>;
}
