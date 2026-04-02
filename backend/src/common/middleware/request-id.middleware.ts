import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export type RequestWithRequestId = Request & { requestId?: string };

export function requestIdMiddleware(
  req: RequestWithRequestId,
  res: Response,
  next: NextFunction,
) {
  const incoming = typeof req.headers[REQUEST_ID_HEADER] === 'string'
    ? (req.headers[REQUEST_ID_HEADER] as string)
    : undefined;

  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
