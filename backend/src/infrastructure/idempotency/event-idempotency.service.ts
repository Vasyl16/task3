import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export type EventIdempotencyResult = 'processed' | 'skipped';

// Event-CONSUMER idempotency: at-least-once delivery means a worker may
// see the same BullMQ job (and the same OutboxEvent) more than once —
// either because the Outbox Publisher republished it after a crash, or
// because BullMQ redelivers a job that failed/timed out. Processing it
// twice must not duplicate the side effect.
//
// This is NOT the same thing as API idempotency (see
// idempotency-key.service.ts) — that guards against a *client* retrying
// the same command; this guards against a *queue* redelivering the same
// event to the same handler.
//
// Why an in-handler "if not already processed" check is not enough on
// its own: that check-then-act is itself racy under concurrent delivery
// (two workers can both read "not processed yet" before either writes),
// and if the process crashes between the check and the side effect,
// there is nothing recording that it started. The only way to make this
// safe is a single atomic operation the database enforces, not
// application logic layered on top of it.
@Injectable()
export class EventIdempotencyService {
  private readonly logger = new Logger(EventIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Runs `work` at most once per (eventId, consumerName), even under
  // concurrent duplicate delivery. Uniqueness is enforced at the
  // database level (ProcessedEvent's @@unique([eventId, consumerName])),
  // not by an application-level check — inserting the marker row FIRST,
  // in the same transaction as the side effect, means a concurrent
  // duplicate's insert fails with a unique violation before it can run
  // `work` at all, and a crash mid-`work` rolls the marker back too
  // (state change and processed-event record are atomic together).
  async run(
    consumerName: string,
    eventId: string,
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<EventIdempotencyResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { eventId, consumerName } });
        await work(tx);
      });
      return 'processed';
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        this.logger.debug(
          `Skipping duplicate delivery of event ${eventId} to ${consumerName} (already processed)`,
        );
        return 'skipped';
      }
      throw err;
    }
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
