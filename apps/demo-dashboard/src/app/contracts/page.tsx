"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, formatUnits } from "viem";
import { foundry } from "viem/chains";
import Link from "next/link";
import {
  CONTRACTS,
  claimDecisionRegistryAbi,
  claimEscrowAbi,
  consentRegistryAbi,
  policyRegistryAbi,
  mockUsdcAbi,
  CLAIM_STATES,
  PAYOUT_STATUSES,
  DENIAL_BITS,
} from "@/config/contracts";
import { Address } from "@/components/Address";
import { StateMachine } from "@/components/StateMachine";
import { JsonViewer } from "@/components/JsonViewer";

const client = createPublicClient({
  chain: foundry,
  transport: http("http://127.0.0.1:8545"),
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

function ClaimLookup() {
  const [claimId, setClaimId] = useState("");
  const [submittedId, setSubmittedId] = useState<`0x${string}` | null>(null);

  const { data: decision, isLoading: loadingDecision } = useQuery({
    queryKey: ["contract-decision", submittedId],
    queryFn: async () => {
      if (!submittedId) return null;
      return await client.readContract({
        address: CONTRACTS.ClaimDecisionRegistry as `0x${string}`,
        abi: claimDecisionRegistryAbi,
        functionName: "getDecision",
        args: [submittedId],
      });
    },
    enabled: !!submittedId,
  });

  const { data: payout, isLoading: loadingPayout } = useQuery({
    queryKey: ["contract-payout", submittedId],
    queryFn: async () => {
      if (!submittedId) return null;
      return await client.readContract({
        address: CONTRACTS.ClaimEscrow as `0x${string}`,
        abi: claimEscrowAbi,
        functionName: "getPayout",
        args: [submittedId],
      });
    },
    enabled: !!submittedId,
  });

  const handleLookup = () => {
    if (claimId.startsWith("0x") && claimId.length === 66) {
      setSubmittedId(claimId as `0x${string}`);
    }
  };

  const state = decision ? Number(decision.state) : null;
  const bitmap = decision ? Number(decision.reasonBitmap) : 0;

  return (
    <Section title="Claim Lookup">
      <div className="flex gap-2">
        <input
          value={claimId}
          onChange={(e) => setClaimId(e.target.value)}
          placeholder="Enter claim ID (0x...)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={handleLookup}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Lookup
        </button>
      </div>

      {(loadingDecision || loadingPayout) && (
        <div className="mt-3 text-sm text-[var(--text-muted)]">Loading...</div>
      )}

      {decision && state !== null && (
        <div className="mt-4 space-y-4">
          <StateMachine claimId={submittedId} />

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--bg)] p-3">
              <div className="text-xs text-[var(--text-muted)]">State</div>
              <div className="mt-1 font-semibold">
                {CLAIM_STATES[state] ?? "UNKNOWN"}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg)] p-3">
              <div className="text-xs text-[var(--text-muted)]">Bitmap</div>
              <div className="mt-1 font-semibold">{bitmap}</div>
            </div>
          </div>

          {bitmap > 0 && (
            <div className="space-y-1">
              {DENIAL_BITS.map((bit) => {
                const isSet = (bitmap & bit.mask) !== 0;
                return (
                  <div
                    key={bit.bit}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded border ${
                        isSet
                          ? "border-[var(--error)] bg-[var(--error)]"
                          : "border-[var(--border)]"
                      }`}
                    />
                    <span
                      className={
                        isSet
                          ? "text-[var(--error)]"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      Bit {bit.bit}: {bit.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {payout && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text-muted)]">
                  Payout Status
                </div>
                <div className="mt-1 font-semibold">
                  {PAYOUT_STATUSES[Number(payout.status)] ?? "UNKNOWN"}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Amount</div>
                <div className="mt-1 font-semibold">
                  {formatUnits(payout.amount, 6)} USDC
                </div>
              </div>
              {payout.recipient !==
                "0x0000000000000000000000000000000000000000" && (
                <div className="col-span-2 rounded-lg bg-[var(--bg)] p-3">
                  <div className="text-xs text-[var(--text-muted)]">
                    Recipient
                  </div>
                  <div className="mt-1">
                    <Address
                      address={payout.recipient as `0x${string}`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ConsentCheck() {
  const [consentId, setConsentId] = useState("");
  const [submittedId, setSubmittedId] = useState<`0x${string}` | null>(null);

  const { data: active, isLoading } = useQuery({
    queryKey: ["consent-active", submittedId],
    queryFn: async () => {
      if (!submittedId) return null;
      const now = BigInt(Math.floor(Date.now() / 1000));
      return await client.readContract({
        address: CONTRACTS.ConsentRegistry as `0x${string}`,
        abi: consentRegistryAbi,
        functionName: "isConsentActive",
        args: [submittedId, now],
      });
    },
    enabled: !!submittedId,
  });

  const { data: consent } = useQuery({
    queryKey: ["consent-record", submittedId],
    queryFn: async () => {
      if (!submittedId) return null;
      return await client.readContract({
        address: CONTRACTS.ConsentRegistry as `0x${string}`,
        abi: consentRegistryAbi,
        functionName: "getConsent",
        args: [submittedId],
      });
    },
    enabled: !!submittedId,
  });

  return (
    <Section title="Consent Check">
      <div className="flex gap-2">
        <input
          value={consentId}
          onChange={(e) => setConsentId(e.target.value)}
          placeholder="Enter consent ID (0x...)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => {
            if (consentId.startsWith("0x") && consentId.length === 66)
              setSubmittedId(consentId as `0x${string}`);
          }}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Check
        </button>
      </div>
      {isLoading && (
        <div className="mt-3 text-sm text-[var(--text-muted)]">Loading...</div>
      )}
      {active !== null && active !== undefined && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              active ? "bg-[var(--success)]" : "bg-[var(--error)]"
            }`}
          />
          <span className="text-sm font-medium">
            {active ? "ACTIVE" : "INACTIVE"}
          </span>
        </div>
      )}
      {consent && (
        <div className="mt-3">
          <JsonViewer
            data={{
              consentId: consent.consentId,
              status: ["ACTIVE", "REVOKED", "EXPIRED"][Number(consent.status)] ?? "UNKNOWN",
              version: Number(consent.version),
              issuedAt: new Date(Number(consent.issuedAt) * 1000).toISOString(),
              expiresAt: new Date(Number(consent.expiresAt) * 1000).toISOString(),
            }}
          />
        </div>
      )}
    </Section>
  );
}

function PolicyCheck() {
  const [policyHash, setPolicyHash] = useState("");
  const [submittedHash, setSubmittedHash] = useState<`0x${string}` | null>(
    null
  );

  const { data: active, isLoading } = useQuery({
    queryKey: ["policy-active", submittedHash],
    queryFn: async () => {
      if (!submittedHash) return null;
      const now = BigInt(Math.floor(Date.now() / 1000));
      return await client.readContract({
        address: CONTRACTS.PolicyRegistry as `0x${string}`,
        abi: policyRegistryAbi,
        functionName: "isPolicyActive",
        args: [submittedHash, now],
      });
    },
    enabled: !!submittedHash,
  });

  return (
    <Section title="Policy Check">
      <div className="flex gap-2">
        <input
          value={policyHash}
          onChange={(e) => setPolicyHash(e.target.value)}
          placeholder="Enter policy hash (0x...)"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => {
            if (policyHash.startsWith("0x") && policyHash.length === 66)
              setSubmittedHash(policyHash as `0x${string}`);
          }}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Check
        </button>
      </div>
      {isLoading && (
        <div className="mt-3 text-sm text-[var(--text-muted)]">Loading...</div>
      )}
      {active !== null && active !== undefined && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              active ? "bg-[var(--success)]" : "bg-[var(--error)]"
            }`}
          />
          <span className="text-sm font-medium">
            {active ? "ACTIVE" : "INACTIVE"}
          </span>
        </div>
      )}
    </Section>
  );
}

function EscrowBalance() {
  const { data: balance } = useQuery({
    queryKey: ["escrow-balance"],
    queryFn: async () => {
      return await client.readContract({
        address: CONTRACTS.MockUSDC as `0x${string}`,
        abi: mockUsdcAbi,
        functionName: "balanceOf",
        args: [CONTRACTS.ClaimEscrow as `0x${string}`],
      });
    },
    refetchInterval: 10_000,
  });

  const { data: blockNumber } = useQuery({
    queryKey: ["block-number"],
    queryFn: async () => await client.getBlockNumber(),
    refetchInterval: 5_000,
  });

  return (
    <Section title="Escrow & Chain">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[var(--bg)] p-3">
          <div className="text-xs text-[var(--text-muted)]">Escrow USDC</div>
          <div className="mt-1 text-lg font-bold">
            {balance !== undefined ? formatUnits(balance, 6) : "—"}
          </div>
        </div>
        <div className="rounded-lg bg-[var(--bg)] p-3">
          <div className="text-xs text-[var(--text-muted)]">Block Number</div>
          <div className="mt-1 text-lg font-bold">
            {blockNumber !== undefined ? blockNumber.toString() : "—"}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
        {Object.entries(CONTRACTS).map(([name, addr]) => (
          <div key={name} className="flex items-center justify-between">
            <span>{name}</span>
            <Address address={addr as `0x${string}`} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function ContractsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          &larr; Dashboard
        </Link>
        <h1 className="mt-1 text-xl font-bold">Contract Explorer</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Read on-chain state directly from Anvil (chain ID 31337).
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ClaimLookup />
        <div className="space-y-6">
          <EscrowBalance />
          <ConsentCheck />
          <PolicyCheck />
        </div>
      </div>
    </div>
  );
}
