import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Artificial latency injected ONLY in dev (NODE_ENV === 'dev') so the
// front-ends exercise their loading/skeleton states against a slow backend.
// Tune the bounds here — values are inclusive milliseconds.
const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 0;

@Injectable()
export class FakeDelayMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    const delay =
      MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
    setTimeout(next, delay);
  }
}
