import { randomUUID } from "node:crypto"
import type { Request, Response, NextFunction } from "express"

export const CORRELATION_HEADER = "x-correlation-id"

export function createCorrelationId(): string {
  return `corr_${randomUUID().replace(/-/g, "")}`
}

// Augment Express Request
declare global {
  namespace Express {
    interface Request {
      correlationId: string
    }
  }
}

export function correlationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.correlationId = (req.headers[CORRELATION_HEADER] as string) ?? createCorrelationId()
  next()
}
