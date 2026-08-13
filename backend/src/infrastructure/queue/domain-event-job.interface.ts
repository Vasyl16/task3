// The BullMQ job payload for a domain event, one-to-one with an
// OutboxEvent row. eventId and correlationId are always carried through
// so a worker can (a) dedupe via ProcessedEvent keyed on eventId, and
// (b) log/trace using the same correlationId the originating HTTP
// request had — see CorrelationIdService.
export interface DomainEventJob {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}
