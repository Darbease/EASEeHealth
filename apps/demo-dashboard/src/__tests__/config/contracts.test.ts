import { describe, it, expect } from "vitest";
import { CLAIM_STATES, PAYOUT_STATUSES, DENIAL_BITS } from "@/config/contracts";

describe("CLAIM_STATES", () => {
  it("has exactly 7 entries", () => {
    expect(CLAIM_STATES).toHaveLength(7);
  });

  it("lists states in correct order", () => {
    expect([...CLAIM_STATES]).toEqual([
      "NONE",
      "SUBMITTED",
      "PROOF_PENDING",
      "APPROVED",
      "DENIED",
      "CHALLENGED",
      "PAID",
    ]);
  });
});

describe("PAYOUT_STATUSES", () => {
  it("has exactly 4 entries", () => {
    expect(PAYOUT_STATUSES).toHaveLength(4);
  });

  it("lists statuses in correct order", () => {
    expect([...PAYOUT_STATUSES]).toEqual([
      "NONE",
      "SCHEDULED",
      "RELEASED",
      "CANCELED",
    ]);
  });
});

describe("DENIAL_BITS", () => {
  it("has exactly 6 entries", () => {
    expect(DENIAL_BITS).toHaveLength(6);
  });

  it("each mask equals 2^bit", () => {
    for (const entry of DENIAL_BITS) {
      expect(entry.mask).toBe(2 ** entry.bit);
    }
  });

  it("bit 3 is consent invalid/revoked", () => {
    const bit3 = DENIAL_BITS.find((d) => d.bit === 3);
    expect(bit3).toBeDefined();
    expect(bit3!.mask).toBe(8);
    expect(bit3!.label).toMatch(/consent/i);
  });
});
