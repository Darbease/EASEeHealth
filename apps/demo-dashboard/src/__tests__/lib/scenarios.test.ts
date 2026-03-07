import { describe, it, expect } from "vitest";
import { scenarios } from "@/lib/scenarios";

describe("scenario definitions", () => {
  it("has 3 scenarios (a, b, c)", () => {
    expect(Object.keys(scenarios)).toEqual(["a", "b", "c"]);
  });

  it("each scenario has a valid CRE workflow ID", () => {
    for (const s of Object.values(scenarios)) {
      expect(s.workflow).toMatch(/^wf-\d{3}-[\w-]+$/);
    }
  });

  it("each scenario has expected steps", () => {
    expect(scenarios.a.expectedSteps).toHaveLength(10);
    expect(scenarios.b.expectedSteps).toHaveLength(4);
    expect(scenarios.c.expectedSteps).toHaveLength(6);
  });

  it("step numbers are sequential", () => {
    for (const s of Object.values(scenarios)) {
      s.expectedSteps.forEach((step, i) => {
        expect(step.step).toBe(i + 1);
      });
    }
  });

  it("scenario A targets WF-001 and expects PAID outcome", () => {
    expect(scenarios.a.workflow).toBe("wf-001-prior-auth-decision");
    expect(scenarios.a.expectedOutcome.claimState).toBe("PAID");
    expect(scenarios.a.expectedOutcome.payoutStatus).toBe("RELEASED");
    expect(scenarios.a.claimId).toBeDefined();
  });

  it("scenario B targets WF-002 and expects REVOKED consent", () => {
    expect(scenarios.b.workflow).toBe("wf-002-consent-revocation");
    expect(scenarios.b.expectedOutcome.consentStatus).toBe("REVOKED");
    expect(scenarios.b.consentId).toBeDefined();
    expect(scenarios.b.setupSteps).toHaveLength(1);
  });

  it("scenario C targets WF-003 and expects APPROVED resolution", () => {
    expect(scenarios.c.workflow).toBe("wf-003-challenge-resolution");
    expect(scenarios.c.expectedOutcome.claimState).toBe("APPROVED");
    expect(scenarios.c.claimId).toBeDefined();
  });

  it("all expected steps have valid capabilities", () => {
    const validCaps = ["HTTP", "EVM_READ", "EVM_WRITE", "ENCRYPTED"];
    for (const s of Object.values(scenarios)) {
      for (const step of s.expectedSteps) {
        expect(validCaps).toContain(step.capability);
      }
    }
  });

  it("EVM_WRITE steps have contract and functionName", () => {
    for (const s of Object.values(scenarios)) {
      for (const step of s.expectedSteps) {
        if (step.capability === "EVM_WRITE") {
          expect(step.contract).toBeDefined();
          expect(step.functionName).toBeDefined();
          expect(step.onchainEffect).toBeDefined();
        }
      }
    }
  });

  it("scenario A has 5 EVM_WRITE steps", () => {
    const writes = scenarios.a.expectedSteps.filter(
      (s) => s.capability === "EVM_WRITE"
    );
    expect(writes).toHaveLength(5);
  });

  it("scenario B setup step targets consent service", () => {
    const setup = scenarios.b.setupSteps![0];
    expect(setup.request.method).toBe("POST");
    expect(setup.request.url).toContain("3004");
    expect(setup.request.url).toContain("/v1/consents/revoke");
  });

  it("user stories are non-empty arrays", () => {
    for (const s of Object.values(scenarios)) {
      expect(s.userStories.length).toBeGreaterThan(0);
      for (const story of s.userStories) {
        expect(story.length).toBeGreaterThan(10);
      }
    }
  });
});
