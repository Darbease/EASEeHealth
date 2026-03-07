import { keccak256, encodePacked } from "viem";
import type { Bytes32 } from "./common.js";

/**
 * Computes the deterministic claim ID.
 *
 * ```
 * claim_id = keccak256(
 *   encodePacked(
 *     ['string','bytes32','bytes32','string','string'],
 *     [payer_id, provider_id_hash, encounter_ref_hash, procedure_bucket, service_date]
 *   )
 * )
 * ```
 *
 * This MUST match the on-chain computation in `ClaimDecisionRegistry`.
 */
export function computeClaimId(
  payer_id: string,
  provider_id_hash: Bytes32,
  encounter_ref_hash: Bytes32,
  procedure_bucket: string,
  service_date: string,
): Bytes32 {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "bytes32", "string", "string"],
      [payer_id, provider_id_hash, encounter_ref_hash, procedure_bucket, service_date],
    ),
  );
}
