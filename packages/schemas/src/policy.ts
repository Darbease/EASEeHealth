import { z } from "zod";
import type { Bytes32 } from "./common.js";
import { Bytes32Schema } from "./common.js";

// ---------------------------------------------------------------------------
// PolicyVersion — on-chain policy version record
// ---------------------------------------------------------------------------

export interface PolicyVersion {
  policy_hash: Bytes32;
  verifier_key_hash: Bytes32;
  effective_from: bigint;
  effective_to: bigint;
  active: boolean;
}

export const PolicyVersionSchema = z.object({
  policy_hash: Bytes32Schema,
  verifier_key_hash: Bytes32Schema,
  effective_from: z.bigint(),
  effective_to: z.bigint(),
  active: z.boolean(),
});
