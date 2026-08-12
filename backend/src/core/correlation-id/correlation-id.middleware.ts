import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { CorrelationIdService } from './correlation-id.service';

const HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly correlationIdService: CorrelationIdService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header(HEADER);
    const correlationId =
      incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader(HEADER, correlationId);
    this.correlationIdService.run(correlationId, next);
  }
}
