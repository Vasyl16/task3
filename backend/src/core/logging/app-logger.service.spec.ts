import { CorrelationIdService } from '../correlation-id/correlation-id.service';
import { AppLogger } from './app-logger.service';

describe('AppLogger', () => {
  let correlationIdService: CorrelationIdService;
  let written: string[];
  let writeSpy: jest.SpyInstance;

  function build(level: 'error' | 'warn' | 'info' | 'debug' = 'debug') {
    // No filePath — stdout only, so tests never touch the filesystem.
    return new AppLogger(correlationIdService, { level });
  }

  function lines(): Array<Record<string, unknown>> {
    return written.map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  beforeEach(() => {
    correlationIdService = new CorrelationIdService();
    written = [];
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        written.push(String(chunk).trim());
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('emits one JSON object per line with the required structured fields', () => {
    const logger = build();

    logger.log(
      { event: 'checkout.completed', userId: 'user-1' },
      'OrdersService',
    );

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 'info',
      event: 'checkout.completed',
      userId: 'user-1',
      context: 'OrdersService',
    });
    expect(typeof lines()[0].timestamp).toBe('string');
  });

  // The whole point of the AsyncLocalStorage approach: no call site
  // passes correlationId, yet every line inside the context carries it.
  it('stamps the ambient correlationId onto lines logged inside a context', () => {
    const logger = build();

    correlationIdService.run('corr-abc', () => {
      logger.log({ event: 'order.created' });
    });

    expect(lines()[0].correlationId).toBe('corr-abc');
  });

  it('omits correlationId entirely outside any context, rather than inventing one', () => {
    const logger = build();

    logger.log({ event: 'app.started' });

    expect(lines()[0]).not.toHaveProperty('correlationId');
  });

  it('keeps the correlationId across awaits inside the same context', async () => {
    const logger = build();

    await correlationIdService.run('corr-async', async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      logger.log({ event: 'deep.async.step' });
    });

    expect(lines()[0].correlationId).toBe('corr-async');
  });

  it('serializes an Error into name/message/stack rather than flattening it', () => {
    const logger = build();

    logger.error({ event: 'checkout.failed', error: new Error('boom') });

    const error = lines()[0].error as Record<string, unknown>;
    expect(error).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof error.stack).toBe('string');
  });

  // Regression: an already-serialized error used to be re-serialized
  // into { name: 'UnknownError', message: '[object Object]' }, silently
  // destroying the real message at the exact moment it mattered.
  it('passes an already-serialized error through unchanged', () => {
    const logger = build();

    logger.error({
      event: 'http.request',
      error: { name: 'NotFoundException', message: 'Product x not found' },
    });

    expect(lines()[0].error).toMatchObject({
      name: 'NotFoundException',
      message: 'Product x not found',
    });
  });

  it('handles a bare Error argument, as Nest itself logs them', () => {
    const logger = build();

    logger.error(new Error('unhandled'), 'ExceptionsHandler');

    expect(lines()[0]).toMatchObject({
      level: 'error',
      message: 'unhandled',
      context: 'ExceptionsHandler',
    });
  });

  it('accepts a plain string message, as framework logs do', () => {
    const logger = build();

    logger.log('Nest application successfully started', 'NestApplication');

    expect(lines()[0]).toMatchObject({
      level: 'info',
      event: 'log',
      message: 'Nest application successfully started',
      context: 'NestApplication',
    });
  });

  // Call sites written before this logger existed use { msg: ... }.
  it('treats msg as an alias for message so pre-existing call sites keep working', () => {
    const logger = build();

    logger.log({ msg: 'legacy shape', eventId: 'e1' });

    expect(lines()[0]).toMatchObject({
      message: 'legacy shape',
      eventId: 'e1',
    });
    expect(lines()[0]).not.toHaveProperty('msg');
  });

  it('drops lines below the configured level', () => {
    const logger = build('warn');

    logger.debug({ event: 'noisy' });
    logger.log({ event: 'also.noisy' });
    logger.warn({ event: 'kept' });
    logger.error({ event: 'kept.too' });

    expect(lines().map((l) => l.event)).toEqual(['kept', 'kept.too']);
  });

  // A circular reference in a payload must not take down the request
  // that was merely trying to log about it.
  it('never throws on an unserializable payload', () => {
    const logger = build();
    const circular: Record<string, unknown> = { event: 'weird' };
    circular.self = circular;

    expect(() => logger.log(circular)).not.toThrow();
    expect(lines()[0]).toMatchObject({
      event: 'weird',
      message: 'log entry could not be serialized',
    });
  });
});
