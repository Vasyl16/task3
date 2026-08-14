import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { EventIdempotencyService } from '../src/infrastructure/idempotency/event-idempotency.service';
import { closeApp } from './support/close-app';
import { uniqueSuffix } from './support/fixtures';

// At-least-once delivery is a fact of the outbox -> BullMQ pipeline: the
// publisher can republish after a crash, and BullMQ redelivers a job that
// timed out. So "the handler runs twice" is not a hypothetical to design
// against — it WILL happen, and the side effect must still land once.
//
// This can only be proven against a real database. The guarantee is not
// application logic ("check whether we've seen this event") — that check
// is itself racy, since two workers can both read "not processed yet"
// before either writes. The guarantee is a unique constraint on
// ProcessedEvent(eventId, consumerName), and only real Postgres actually
// enforces it under a genuine race.
describe('Event consumer idempotency (e2e, real database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let eventIdempotency: EventIdempotencyService;
  const run = uniqueSuffix();

  const CONSUMER = `test-consumer-${run}`;
  const createdUserIds: string[] = [];
  const usedEventIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    eventIdempotency = app.get(EventIdempotencyService);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.processedEvent.deleteMany({
      where: { eventId: { in: usedEventIds } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { id: { in: usedEventIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await closeApp(app);
  });

  // A real recipient, so the side effect under test is a genuine row
  // with a foreign key — not a bare counter.
  async function makeRecipient(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${run}@example.com`,
        name: 'Idempotency Recipient',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  // ProcessedEvent.eventId is a real foreign key to OutboxEvent, so the
  // marker can only ever point at an event that genuinely exists — a
  // constraint worth keeping, and worth honouring here rather than
  // testing against ids that could never occur in production.
  //
  // Created already PUBLISHED, which matters: every e2e suite boots its
  // own AppModule, so several OutboxPublishers poll this same database
  // concurrently. A PENDING row here would be claimed and genuinely
  // dispatched by whichever suite's publisher saw it first, and its
  // consumers would then race this suite's teardown — writing a
  // ProcessedEvent against an OutboxEvent already deleted, which the
  // foreign key correctly refuses. A terminal status makes the row
  // invisible to every publisher, so it stays inert scaffolding for the
  // constraint under test.
  async function newEventId(): Promise<string> {
    const event = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'SellerOrder',
        aggregateId: randomUUID(),
        eventType: 'SellerOrderCreated',
        payload: {},
        correlationId: randomUUID(),
        status: 'PUBLISHED',
        processedAt: new Date(),
      },
    });
    usedEventIds.push(event.id);
    return event.id;
  }

  it('runs the side effect once when the same event is delivered twice in sequence', async () => {
    const userId = await makeRecipient('seq');
    const eventId = await newEventId();

    const work = (
      tx: Parameters<Parameters<typeof eventIdempotency.run>[2]>[0],
    ) =>
      tx.notification
        .create({
          data: {
            userId,
            type: 'SELLER_ORDER_CREATED',
            title: 'New order received',
            body: 'You have a new order.',
          },
        })
        .then(() => undefined);

    const first = await eventIdempotency.run(CONSUMER, eventId, work);
    const second = await eventIdempotency.run(CONSUMER, eventId, work);

    expect(first).toBe('processed');
    expect(second).toBe('skipped');

    const notifications = await prisma.notification.findMany({
      where: { userId },
    });
    expect(notifications).toHaveLength(1);
  });

  // The case an application-level "have we seen this?" check cannot
  // survive: both deliveries read the marker table before either writes.
  it('runs the side effect once under genuinely CONCURRENT duplicate delivery', async () => {
    const userId = await makeRecipient('concurrent');
    const eventId = await newEventId();

    const work = (
      tx: Parameters<Parameters<typeof eventIdempotency.run>[2]>[0],
    ) =>
      tx.notification
        .create({
          data: {
            userId,
            type: 'SELLER_ORDER_CREATED',
            title: 'New order received',
            body: 'You have a new order.',
          },
        })
        .then(() => undefined);

    const results = await Promise.all([
      eventIdempotency.run(CONSUMER, eventId, work),
      eventIdempotency.run(CONSUMER, eventId, work),
      eventIdempotency.run(CONSUMER, eventId, work),
    ]);

    expect(results.filter((r) => r === 'processed')).toHaveLength(1);
    expect(results.filter((r) => r === 'skipped')).toHaveLength(2);

    const notifications = await prisma.notification.findMany({
      where: { userId },
    });
    expect(notifications).toHaveLength(1);
  });

  // The marker and the side effect share one transaction, so a handler
  // that throws must leave NEITHER behind — otherwise a transient
  // failure would permanently suppress the retry that fixes it.
  it('leaves no marker behind when the handler fails, so a retry can still succeed', async () => {
    const userId = await makeRecipient('rollback');
    const eventId = await newEventId();

    await expect(
      eventIdempotency.run(CONSUMER, eventId, async (tx) => {
        await tx.notification.create({
          data: {
            userId,
            type: 'SELLER_ORDER_CREATED',
            title: 'Doomed',
            body: 'This must be rolled back.',
          },
        });
        throw new Error('handler exploded after writing');
      }),
    ).rejects.toThrow('handler exploded after writing');

    // Neither the notification nor the marker survived.
    await expect(
      prisma.notification.count({ where: { userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.processedEvent.count({
        where: { eventId, consumerName: CONSUMER },
      }),
    ).resolves.toBe(0);

    // And the retry genuinely works — the failure did not poison the id.
    const retry = await eventIdempotency.run(CONSUMER, eventId, async (tx) => {
      await tx.notification.create({
        data: {
          userId,
          type: 'SELLER_ORDER_CREATED',
          title: 'Retried',
          body: 'This one sticks.',
        },
      });
    });
    expect(retry).toBe('processed');
    await expect(
      prisma.notification.count({ where: { userId } }),
    ).resolves.toBe(1);
  });

  // Dedupe is per (eventId, consumerName): one event fans out to several
  // consumers, and each must get its own crack at it. Keying on eventId
  // alone would let the first consumer to process an event silently
  // starve every other subscriber.
  it('lets a DIFFERENT consumer process the same event id', async () => {
    const userId = await makeRecipient('fanout');
    const eventId = await newEventId();

    const write =
      (title: string) =>
      async (tx: Parameters<Parameters<typeof eventIdempotency.run>[2]>[0]) => {
        await tx.notification.create({
          data: { userId, type: 'SELLER_ORDER_CREATED', title, body: 'b' },
        });
      };

    const a = await eventIdempotency.run(
      `${CONSUMER}-a`,
      eventId,
      write('consumer a'),
    );
    const b = await eventIdempotency.run(
      `${CONSUMER}-b`,
      eventId,
      write('consumer b'),
    );

    expect([a, b]).toEqual(['processed', 'processed']);
    await expect(
      prisma.notification.count({ where: { userId } }),
    ).resolves.toBe(2);
  });
});
