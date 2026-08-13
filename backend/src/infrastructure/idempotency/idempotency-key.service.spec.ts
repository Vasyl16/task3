import { ConflictException } from '@nestjs/common';
import { IdempotencyKeyStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { IdempotencyKeyService } from './idempotency-key.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('IdempotencyKeyService', () => {
  let service: IdempotencyKeyService;
  let create: jest.Mock;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let del: jest.Mock;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    findUnique = jest.fn();
    update = jest.fn().mockResolvedValue({});
    del = jest.fn().mockResolvedValue({});
    service = new IdempotencyKeyService({
      idempotencyKey: { create, findUnique, update, delete: del },
    } as unknown as PrismaService);
  });

  it('proceeds on the first request for a key', async () => {
    const result = await service.begin('key-1', 'user-1', 'hash-1');

    expect(result).toEqual({ outcome: 'proceed' });
    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'key-1',
        userId: 'user-1',
        requestHash: 'hash-1',
        status: IdempotencyKeyStatus.PROCESSING,
      },
    });
  });

  it('replays the stored response for a key whose request already completed', async () => {
    create.mockRejectedValue(uniqueViolation());
    findUnique.mockResolvedValue({
      requestHash: 'hash-1',
      status: IdempotencyKeyStatus.COMPLETED,
      responseStatus: 201,
      responseBody: { id: 'order-1' },
    });

    const result = await service.begin('key-1', 'user-1', 'hash-1');

    expect(result).toEqual({
      outcome: 'replay',
      responseStatus: 201,
      responseBody: { id: 'order-1' },
    });
  });

  // Concurrent duplicate requests: two requests with the same key race
  // to insert; the loser must not re-run the operation, and — since the
  // winner hasn't finished yet — there is no stored response to replay
  // either. It gets a clear "try again" signal instead.
  it('rejects a concurrent duplicate request that is still processing', async () => {
    create.mockRejectedValue(uniqueViolation());
    findUnique.mockResolvedValue({
      requestHash: 'hash-1',
      status: IdempotencyKeyStatus.PROCESSING,
      responseStatus: null,
      responseBody: null,
    });

    await expect(service.begin('key-1', 'user-1', 'hash-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects reusing the same key for a genuinely different request', async () => {
    create.mockRejectedValue(uniqueViolation());
    findUnique.mockResolvedValue({
      requestHash: 'hash-1',
      status: IdempotencyKeyStatus.COMPLETED,
      responseStatus: 200,
      responseBody: {},
    });

    await expect(
      service.begin('key-1', 'user-1', 'hash-DIFFERENT'),
    ).rejects.toThrow(ConflictException);
  });

  it('complete() stores the response and marks the key COMPLETED', async () => {
    await service.complete('key-1', 'user-1', 201, { id: 'order-1' });

    expect(update).toHaveBeenCalledWith({
      where: { key_userId: { key: 'key-1', userId: 'user-1' } },
      data: expect.objectContaining({
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus: 201,
        responseBody: { id: 'order-1' },
      }),
    });
  });

  it('release() clears the PROCESSING marker so a failed attempt can be retried', async () => {
    await service.release('key-1', 'user-1');

    expect(del).toHaveBeenCalledWith({
      where: { key_userId: { key: 'key-1', userId: 'user-1' } },
    });
  });
});
