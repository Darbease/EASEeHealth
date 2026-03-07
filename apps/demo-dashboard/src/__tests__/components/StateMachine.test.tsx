import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { getNodeColor } from "@/components/StateMachine";
import { StateMachine } from "@/components/StateMachine";

describe("getNodeColor", () => {
  it("returns green for active PAID", () => {
    const c = getNodeColor("PAID", "PAID");
    expect(c.stroke).toBe("#22c55e");
  });

  it("returns red for active DENIED", () => {
    const c = getNodeColor("DENIED", "DENIED");
    expect(c.stroke).toBe("#ef4444");
  });

  it("returns amber for active CHALLENGED", () => {
    const c = getNodeColor("CHALLENGED", "CHALLENGED");
    expect(c.stroke).toBe("#f59e0b");
  });

  it("returns indigo for other active states", () => {
    const c = getNodeColor("SUBMITTED", "SUBMITTED");
    expect(c.stroke).toBe("#6366f1");
  });

  it("returns dim colors for inactive node", () => {
    const c = getNodeColor("PAID", "SUBMITTED");
    expect(c.stroke).toBe("#2a2a3e");
    expect(c.text).toBe("#8888a0");
  });
});

describe("StateMachine component", () => {
  it("renders all 7 state labels", () => {
    const { container } = render(<StateMachine />);
    const labels = ["NONE", "SUBMITTED", "PROOF_PENDING", "APPROVED", "DENIED", "CHALLENGED", "PAID"];
    for (const label of labels) {
      expect(container.querySelector("svg")!.textContent).toContain(label);
    }
  });

  it('shows "Current: STATE" when currentState provided', () => {
    render(<StateMachine currentState={3} />);
    expect(screen.getByText("Current:")).toBeInTheDocument();
    // "APPROVED" appears in both SVG label and "Current:" section
    const matches = screen.getAllByText("APPROVED");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("hides current state text when currentState is null", () => {
    render(<StateMachine currentState={null} />);
    expect(screen.queryByText("Current:")).not.toBeInTheDocument();
  });
});
