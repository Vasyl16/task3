import { ConflictException, Injectable } from '@nestjs/common';
import { IdempotencyKeyStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export type IdempotencyBeginResult =
  | { outcome: 'proceed' }
  | { outcome: 'replay'; responseStatus: number; responseBody: unknown };

// API idempotency: a client may retry the same command (checkout,
// refund, bid, ...) — e.g. after a timeout where it never saw the
// response — and must not cause the operation to happen twice. This is
// NOT event-consumer idempotency (see EventIdempotencyService); this
// guards a client's retried HTTP request, not a queue's redelivered job.
//
// This is the reusable mechanism only — no controller wires it up yet
// (see the Idempotency-Key task: "do not implement business-specific
// checkout/bid logic yet"). A future command endpoint uses it via
// IdempotencyInterceptor.
@Injectable()
export class IdempotencyKeyService {
  constructor(private readonly prisma: PrismaService) {}

  // Call before executing the command. 'proceed' means this is the
  // first time this key has been seen — go ahead and run the operation,
  // then call complete(). 'replay' means a prior request with this key
  // already finished — return its stored result instead of re-running
  // anything.
  //
  // Concurrency: the unique (key, userId) constraint is what makes this
  // safe under a genuine race — two requests with the same key inserting
  // "PROCESSING" simultaneously can't both succeed; the database, not
  // application logic, decides who goes first.
  async begin(
    key: string,
    userId: string,
    requestHash: string,
  ): Promise<IdempotencyBeginResult> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          userId,
          requestHash,
          status: IdempotencyKeyStatus.PROCESSING,
        },
      });
      return { outcome: 'proceed' };
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) {
        throw err;
      }

      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { key_userId: { key, userId } },
      });
      if (!existing) {
        // Row that caused the conflict is gone already (e.g. cleaned up
        // after a failed attempt) — safe to let the caller retry fresh.
        throw new ConflictException(
          'Idempotency-Key is being processed concurrently — retry shortly',
        );
      }
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different request',
        );
      }
      if (existing.status === IdempotencyKeyStatus.COMPLETED) {
        return {
          outcome: 'replay',
          responseStatus: existing.responseStatus ?? 200,
          responseBody: existing.responseBody,
        };
      }
      // Same key, same request, still PROCESSING: a genuinely concurrent
      // duplicate. We don't block-and-wait for the first one to finish —
      // tell the client to retry rather than adding queueing complexity
      // here.
      throw new ConflictException(
        'A request with this Idempotency-Key is already being processed',
      );
    }
  }

  async complete(
    key: string,
    userId: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key_userId: { key, userId } },
      data: {
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus,
        responseBody: responseBody ?? Prisma.JsonNull,
        completedAt: new Date(),
      },
    });
  }

  // Called when the wrapped operation throws — removes the PROCESSING
  // marker so a legitimate retry (same key, same request) isn't
  // permanently stuck behind a failed first attempt.
  async release(key: string, userId: string): Promise<void> {
    await this.prisma.idempotencyKey
      .delete({ where: { key_userId: { key, userId } } })
      .catch(() => undefined); // already gone / already completed — fine
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
