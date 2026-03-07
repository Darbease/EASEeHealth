import { describe, it, expect } from "vitest";

// The workflow name regex from src/app/api/simulate/route.ts
const WORKFLOW_RE = /^wf-\d{3}-[\w-]+$/;

describe("workflow name regex", () => {
  it("accepts wf-001-prior-auth-decision", () => {
    expect(WORKFLOW_RE.test("wf-001-prior-auth-decision")).toBe(true);
  });

  it("accepts wf-002-consent-revocation", () => {
    expect(WORKFLOW_RE.test("wf-002-consent-revocation")).toBe(true);
  });

  it("accepts wf-003-challenge-resolution", () => {
    expect(WORKFLOW_RE.test("wf-003-challenge-resolution")).toBe(true);
  });

  it("accepts wf-004-reconciliation-monitor", () => {
    expect(WORKFLOW_RE.test("wf-004-reconciliation-monitor")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(WORKFLOW_RE.test("")).toBe(false);
  });

  it("rejects missing wf- prefix", () => {
    expect(WORKFLOW_RE.test("001-prior-auth-decision")).toBe(false);
  });

  it("rejects wrong digit count (2 digits)", () => {
    expect(WORKFLOW_RE.test("wf-01-prior-auth-decision")).toBe(false);
  });

  it("rejects path traversal attempt", () => {
    expect(WORKFLOW_RE.test("wf-001-../../etc/passwd")).toBe(false);
  });
});
