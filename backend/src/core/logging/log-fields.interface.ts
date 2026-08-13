// The structured shape every log line follows. `event` is the stable,
// machine-queryable name of what happened (`checkout.completed`,
// `outbox.publish_failed`) — message text may be reworded freely,
// `event` may not, because dashboards and alerts key on it.
//
// Anything not listed here is passed through as-is, so a call site can
// attach whatever context is genuinely useful without this interface
// growing a field per feature.
export interface LogFields {
  event: string;
  // Who triggered it, when the request is authenticated. Never a
  // client-supplied id — it comes from the verified JWT.
  userId?: string;
  // The primary domain row this line is about (orderId, auctionId,
  // productId, ...). One field rather than one per entity type keeps
  // Loki/Grafana queries uniform; `entityType` says what it points at.
  entityId?: string;
  entityType?: string;
  [key: string]: unknown;
}

// Errors are logged as a nested object rather than a flattened string so
// the stack stays intact and the message stays queryable on its own.
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  // Idempotent: an already-serialized error passes through unchanged.
  // Without this, serializing twice yields
  // { name: 'UnknownError', message: '[object Object]' } — the original
  // message silently lost, which is exactly when you most need it.
  if (isSerializedError(err)) {
    return err;
  }
  return { name: 'UnknownError', message: String(err) };
}

function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SerializedError>;
  return (
    typeof candidate.name === 'string' && typeof candidate.message === 'string'
  );
}
