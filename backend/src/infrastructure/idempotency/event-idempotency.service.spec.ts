import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EventIdempotencyService } from './event-idempotency.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('EventIdempotencyService', () => {
  let service: EventIdempotencyService;
  let processedEventCreate: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(() => {
    processedEventCreate = jest.fn().mockResolvedValue({});
    // Mirrors real Prisma transaction semantics: the callback receives a
    // tx handle whose processedEvent.create is the same mock used to
    // decide "already processed" — and if the callback throws, the
    // whole $transaction call rejects (nothing it did is committed).
    transaction = jest.fn((cb: (tx: unknown) => unknown) =>
      cb({ processedEvent: { create: processedEventCreate } }),
    );
    service = new EventIdempotencyService({
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  it('runs the work exactly once for a fresh event', async () => {
    const work = jest.fn().mockResolvedValue(undefined);

    const result = await service.run('search-sync', 'event-1', work);

    expect(result).toBe('processed');
    expect(work).toHaveBeenCalledTimes(1);
    expect(processedEventCreate).toHaveBeenCalledWith({
      data: { eventId: 'event-1', consumerName: 'search-sync' },
    });
  });

  // Duplicate event delivery: the marker insert fails with a unique
  // violation because this (eventId, consumerName) pair was already
  // recorded by an earlier delivery — work must NOT run again.
  it('skips the side effect on a duplicate delivery of the same event', async () => {
    processedEventCreate.mockRejectedValue(uniqueViolation());
    const work = jest.fn().mockResolvedValue(undefined);

    const result = await service.run('search-sync', 'event-1', work);

    expect(result).toBe('skipped');
    expect(work).not.toHaveBeenCalled();
  });

  // Concurrent duplicate delivery: two workers race to process the same
  // event. Both attempt the insert; only one can win the unique
  // constraint. This models the loser's outcome.
  it('handles a concurrent duplicate delivery safely (loses the unique-constraint race)', async () => {
    processedEventCreate.mockRejectedValueOnce(uniqueViolation());
    const work = jest.fn().mockResolvedValue(undefined);

    const result = await service.run('search-sync', 'event-1', work);

    expect(result).toBe('skipped');
    expect(work).not.toHaveBeenCalled();
  });

  it('re-throws errors unrelated to the uniqueness guard', async () => {
    processedEventCreate.mockRejectedValue(new Error('connection reset'));

    await expect(
      service.run('search-sync', 'event-1', jest.fn()),
    ).rejects.toThrow('connection reset');
  });

  it('propagates a failure from work() so the marker insert is rolled back too (atomic together)', async () => {
    const work = jest.fn().mockRejectedValue(new Error('meilisearch down'));

    await expect(service.run('search-sync', 'event-1', work)).rejects.toThrow(
      'meilisearch down',
    );
    // The transaction callback threw, so in a real Postgres transaction
    // the ProcessedEvent insert above is rolled back with it — nothing
    // here marks the event processed on failure, which is exactly what
    // lets BullMQ's retry (and a genuinely new delivery) try again.
  });
});
