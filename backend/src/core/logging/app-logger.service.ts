import { Injectable, Scope, type LoggerService } from '@nestjs/common';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CorrelationIdService } from '../correlation-id/correlation-id.service';
import { serializeError, type LogFields } from './log-fields.interface';

export type LogLevelName = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const LEVEL_SEVERITY: Record<LogLevelName, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

export interface AppLoggerOptions {
  level: LogLevelName;
  // Absolute or cwd-relative path to mirror JSON lines into, for
  // Promtail to tail. Empty/undefined disables the file sink (stdout
  // only) — which is what tests and any container-logging setup want.
  filePath?: string;
}

// One JSON object per line, on stdout and (optionally) into a file
// Promtail tails. Installed via app.useLogger() in main.ts, which means
// EVERY existing `new Logger(Something.name)` call in the codebase —
// and Nest's own framework logs — flows through here and comes out
// structured, without touching those call sites.
//
// correlationId is never passed in by callers. It is read from
// CorrelationIdService's AsyncLocalStorage at write time, so any log
// emitted anywhere inside a request (or inside a worker's job context —
// see DomainEventConsumer) is automatically tagged with the id of the
// operation that caused it. That is what makes the chain
// HTTP → service → outbox → queue → worker → handler traceable on a
// single field, with nothing threaded through method signatures.
@Injectable({ scope: Scope.DEFAULT })
export class AppLogger implements LoggerService {
  private readonly threshold: number;
  private readonly fileStream?: WriteStream;

  constructor(
    private readonly correlationIdService: CorrelationIdService,
    options: AppLoggerOptions,
  ) {
    this.threshold = LEVEL_SEVERITY[options.level];
    if (options.filePath) {
      const absolute = resolve(options.filePath);
      mkdirSync(dirname(absolute), { recursive: true });
      this.fileStream = createWriteStream(absolute, { flags: 'a' });
    }
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  // Convenience for call sites that want the structured shape
  // explicitly, rather than relying on the object-message form.
  event(level: LogLevelName, fields: LogFields): void {
    this.write(level, fields, []);
  }

  private write(
    level: LogLevelName,
    message: unknown,
    params: unknown[],
  ): void {
    if (LEVEL_SEVERITY[level] > this.threshold) {
      return;
    }

    const rest = [...params];
    // Nest appends the logger's context as the final argument, and for
    // .error() also passes a stack string before it.
    const context =
      rest.length > 0 && typeof rest[rest.length - 1] === 'string'
        ? (rest.pop() as string)
        : undefined;

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event: 'log',
    };

    if (message instanceof Error) {
      entry.message = message.message;
      entry.error = serializeError(message);
    } else if (typeof message === 'object' && message !== null) {
      const fields = { ...(message as Record<string, unknown>) };
      // `msg` is accepted as an alias for `message` so the object-form
      // call sites that predate this logger keep working unchanged.
      if (fields.msg !== undefined && fields.message === undefined) {
        fields.message = fields.msg;
        delete fields.msg;
      }
      if (fields.error !== undefined) {
        fields.error = serializeError(fields.error);
      }
      Object.assign(entry, fields);
    } else {
      entry.message = message;
    }

    if (context) {
      entry.context = context;
    }
    // A leftover param on .error() is Nest's stack string.
    const stack = rest.find((p) => typeof p === 'string');
    if (stack && !entry.error) {
      entry.error = { name: 'Error', message: entry.message, stack };
    }

    const correlationId = this.correlationIdService.getId();
    if (correlationId) {
      entry.correlationId = correlationId;
    }

    this.emit(entry);
  }

  private emit(entry: Record<string, unknown>): void {
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      // A circular or otherwise unserializable field must never take
      // down the thing being logged about.
      line = JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        event: entry.event,
        message: 'log entry could not be serialized',
      });
    }
    process.stdout.write(`${line}\n`);
    this.fileStream?.write(`${line}\n`);
  }
}
