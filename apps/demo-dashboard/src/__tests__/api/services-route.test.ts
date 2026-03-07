import { describe, it, expect } from "vitest";
import { parseTarget } from "@/app/api/services/[...path]/route";

describe("parseTarget — healthz mode", () => {
  it("returns {url}/healthz when target param present", () => {
    const params = new URLSearchParams({ target: "http://localhost:3001" });
    const result = parseTarget(["healthz"], params);
    expect(result).toEqual({ url: "http://localhost:3001/healthz" });
  });

  it("returns null when target param missing", () => {
    const result = parseTarget(["healthz"], new URLSearchParams());
    expect(result).toBeNull();
  });
});

describe("parseTarget — proxy mode", () => {
  it("accepts port 3001", () => {
    const result = parseTarget(["3001", "v1", "policies"], new URLSearchParams());
    expect(result).toEqual({ url: "http://localhost:3001/v1/policies" });
  });

  it("accepts port 3006", () => {
    const result = parseTarget(["3006", "v1", "callbacks"], new URLSearchParams());
    expect(result).toEqual({ url: "http://localhost:3006/v1/callbacks" });
  });

  it("rejects port 3000 (below range)", () => {
    const result = parseTarget(["3000", "v1", "test"], new URLSearchParams());
    expect(result).toBeNull();
  });

  it("rejects port 3007 (above range)", () => {
    const result = parseTarget(["3007", "v1", "test"], new URLSearchParams());
    expect(result).toBeNull();
  });

  it("rejects NaN port", () => {
    const result = parseTarget(["abc", "v1", "test"], new URLSearchParams());
    expect(result).toBeNull();
  });

  it("joins single path segment", () => {
    const result = parseTarget(["3003", "healthz"], new URLSearchParams());
    expect(result).toEqual({ url: "http://localhost:3003/healthz" });
  });

  it("joins multi-segment path", () => {
    const result = parseTarget(
      ["3005", "v1", "prior-auth", "submit"],
      new URLSearchParams()
    );
    expect(result).toEqual({
      url: "http://localhost:3005/v1/prior-auth/submit",
    });
  });

  it("handles empty path after port", () => {
    const result = parseTarget(["3003"], new URLSearchParams());
    expect(result).toEqual({ url: "http://localhost:3003/" });
  });
});
