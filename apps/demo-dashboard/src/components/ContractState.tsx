"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, formatUnits } from "viem";
import { foundry } from "viem/chains";
import { CONTRACTS, claimDecisionRegistryAbi, claimEscrowAbi, consentRegistryAbi, CLAIM_STATES, PAYOUT_STATUSES, DENIAL_BITS } from "@/config/contracts";
import { Address } from "./Address";

const client = createPublicClient({
  chain: foundry,
  transport: http("http://127.0.0.1:8545"),
});

const CONSENT_STATUSES = ["ACTIVE", "REVOKED", "EXPIRED"] as const;

interface ContractStateProps {
  claimId?: `0x${string}` | null;
  consentId?: `0x${string}` | null;
}

export function ContractState({ claimId, consentId }: ContractStateProps) {
  const { data: decision, isLoading: loadingDecision } = useQuery({
    queryKey: ["decision", claimId],
    queryFn: async () => {
      if (!claimId) return null;
      const result = await client.readContract({
        address: CONTRACTS.ClaimDecisionRegistry as `0x${string}`,
        abi: claimDecisionRegistryAbi,
        functionName: "getDecision",
        args: [claimId],
      });
      return result;
    },
    enabled: !!claimId,
    refetchInterval: 2_000,
  });

  const { data: payout, isLoading: loadingPayout } = useQuery({
    queryKey: ["payout", claimId],
    queryFn: async () => {
      if (!claimId) return null;
      const result = await client.readContract({
        address: CONTRACTS.ClaimEscrow as `0x${string}`,
        abi: claimEscrowAbi,
        functionName: "getPayout",
        args: [claimId],
      });
      return result;
    },
    enabled: !!claimId,
    refetchInterval: 2_000,
  });

  const { data: consent, isLoading: loadingConsent } = useQuery({
    queryKey: ["consent", consentId],
    queryFn: async () => {
      if (!consentId) return null;
      const result = await client.readContract({
        address: CONTRACTS.ConsentRegistry as `0x${string}`,
        abi: consentRegistryAbi,
        functionName: "getConsent",
        args: [consentId],
      });
      return result;
    },
    enabled: !!consentId,
    refetchInterval: 2_000,
  });

  if (!claimId && !consentId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center text-sm text-[var(--text-muted)]">
        Run a scenario to see on-chain state
      </div>
    );
  }

  const isLoading = loadingDecision || loadingPayout || loadingConsent;
  const state = decision ? Number(decision.state) : 0;
  const bitmap = decision ? Number(decision.reasonBitmap) : 0;
  const payoutStatus = payout ? Number(payout.status) : 0;
  const payoutAmount = payout ? formatUnits(payout.amount, 6) : "0";
  const consentStatus = consent ? Number(consent.status) : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        On-Chain State
      </h3>
      {isLoading ? (
        <div className="text-sm text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-3">
          {/* Claim & Payout state (when claimId provided) */}
          {claimId && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Claim State</div>
                <div className="mt-1 font-semibold">
                  {CLAIM_STATES[state] ?? "UNKNOWN"}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Payout Status</div>
                <div className="mt-1 font-semibold">
                  {PAYOUT_STATUSES[payoutStatus] ?? "UNKNOWN"}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Payout Amount</div>
                <div className="mt-1 font-semibold">{payoutAmount} USDC</div>
              </div>
              {payout && payout.recipient !== "0x0000000000000000000000000000000000000000" && (
                <div className="rounded-lg bg-[var(--bg)] p-3">
                  <div className="text-xs text-[var(--text-muted)]">Recipient</div>
                  <div className="mt-1">
                    <Address address={payout.recipient as `0x${string}`} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Consent state (when consentId provided) */}
          {consentId && consentStatus !== null && (
            <div className="rounded-lg bg-[var(--bg)] p-3">
              <div className="text-xs text-[var(--text-muted)]">Consent Status</div>
              <div className={`mt-1 font-semibold ${
                consentStatus === 1
                  ? "text-[var(--error)]"
                  : consentStatus === 2
                  ? "text-[var(--warning)]"
                  : "text-[var(--success)]"
              }`}>
                {CONSENT_STATUSES[consentStatus] ?? "UNKNOWN"}
              </div>
              {consent && Number(consent.issuedAt) > 0 && (
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  Issued: {new Date(Number(consent.issuedAt) * 1000).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* Denial bitmap */}
          {bitmap > 0 && (
            <div className="rounded-lg bg-[var(--bg)] p-3">
              <div className="mb-2 text-xs text-[var(--text-muted)]">
                Denial Bitmap ({bitmap})
              </div>
              <div className="space-y-1">
                {DENIAL_BITS.map((bit) => {
                  const isSet = (bitmap & bit.mask) !== 0;
                  return (
                    <div key={bit.bit} className="flex items-center gap-2 text-xs">
                      <span
                        className={`inline-block h-3 w-3 rounded border ${
                          isSet
                            ? "border-[var(--error)] bg-[var(--error)]"
                            : "border-[var(--border)] bg-transparent"
                        }`}
                      />
                      <span className={isSet ? "text-[var(--error)]" : "text-[var(--text-muted)]"}>
                        Bit {bit.bit}: {bit.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
