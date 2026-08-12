import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { OutboxEventInput } from './outbox-event.interface';

@Injectable()
export class OutboxService {
  // tx must be the SAME transaction client used for the domain write this
  // event describes — that's what makes the outbox pattern atomic. Never
  // call this with the top-level PrismaService outside a transaction.
  record(tx: Prisma.TransactionClient, event: OutboxEventInput) {
    return tx.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId: event.correlationId,
      },
    });
  }
}
