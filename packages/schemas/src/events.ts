import { z } from "zod";

// ---------------------------------------------------------------------------
// ServiceEvent — canonical observability event (spec S 16)
// ---------------------------------------------------------------------------

export interface ServiceEvent {
  timestamp: string;
  correlation_id: string;
  claim_id?: string;
  workflow_id?: string;
  stage: string;
  status: "success" | "failure" | "pending";
  metadata: Record<string, unknown>;
}

export const ServiceEventSchema = z.object({
  timestamp: z.string().min(1),
  correlation_id: z.string().min(1),
  claim_id: z.string().optional(),
  workflow_id: z.string().optional(),
  stage: z.string().min(1),
  status: z.enum(["success", "failure", "pending"]),
  metadata: z.record(z.unknown()),
});
