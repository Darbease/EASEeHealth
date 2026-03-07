import { describe, it, expect } from "vitest";
import { colorize, type LogLine } from "@/lib/useWorkflowStream";

function makeLine(overrides: Partial<LogLine> = {}): LogLine {
  return {
    type: "log",
    text: "normal text",
    timestamp: "12:00:00",
    ...overrides,
  };
}

describe("colorize", () => {
  it("returns error class for error type", () => {
    expect(colorize(makeLine({ type: "error" }))).toContain("error");
  });

  it("returns success + bold for done type", () => {
    const cls = colorize(makeLine({ type: "done" }));
    expect(cls).toContain("success");
    expect(cls).toContain("font-semibold");
  });

  it("returns green for [USER LOG] text", () => {
    expect(colorize(makeLine({ text: "[USER LOG] hello" }))).toContain(
      "success"
    );
  });

  it("returns blue for [SIMULATION] text", () => {
    expect(colorize(makeLine({ text: "[SIMULATION] running" }))).toContain(
      "info"
    );
  });
});
