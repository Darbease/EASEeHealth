import { logger } from "./logger.js"

export interface ServiceEvent {
  timestamp: string
  correlation_id: string
  claim_id?: string
  workflow_id?: string
  stage: string
  status: "success" | "failure" | "pending"
  metadata: Record<string, unknown>
}

export function emitEvent(event: Omit<ServiceEvent, "timestamp">): void {
  const fullEvent: ServiceEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  }
  logger.info(fullEvent, `[${event.stage}] ${event.status}`)
}
