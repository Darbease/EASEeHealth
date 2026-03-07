import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepLog, type StepEntry } from "@/components/StepLog";

function makeStep(overrides: Partial<StepEntry> = {}): StepEntry {
  return {
    id: "test-1",
    title: "Test Step",
    status: "pending",
    ...overrides,
  };
}

describe("StepLog component", () => {
  it("renders step numbers and titles", () => {
    const steps = [
      makeStep({ id: "s1", title: "First Step" }),
      makeStep({ id: "s2", title: "Second Step" }),
    ];
    render(<StepLog steps={steps} />);
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("First Step")).toBeInTheDocument();
    expect(screen.getByText("Second Step")).toBeInTheDocument();
  });

  it("shows spinner for running status", () => {
    const { container } = render(
      <StepLog steps={[makeStep({ status: "running" })]} />
    );
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("shows checkmark SVG for success status", () => {
    const { container } = render(
      <StepLog steps={[makeStep({ status: "success" })]} />
    );
    // Success icon uses a path with fillRule="evenodd" containing the checkmark
    const svgs = container.querySelectorAll("svg");
    const checkmark = Array.from(svgs).find(
      (svg) => svg.querySelector('path[fill-rule="evenodd"]') !== null
    );
    expect(checkmark).toBeTruthy();
  });

  it("shows X SVG for error status", () => {
    const { container } = render(
      <StepLog steps={[makeStep({ status: "error" })]} />
    );
    const svgs = container.querySelectorAll("svg");
    const xIcon = Array.from(svgs).find(
      (svg) => svg.querySelector('path[fill-rule="evenodd"]') !== null
    );
    expect(xIcon).toBeTruthy();
  });

  it("displays error message text", () => {
    render(
      <StepLog
        steps={[makeStep({ status: "error", error: "Connection refused" })]}
      />
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("shows method and URL", () => {
    render(
      <StepLog
        steps={[
          makeStep({ method: "POST", url: "/v1/prior-auth/submit" }),
        ]}
      />
    );
    expect(screen.getByText("POST")).toBeInTheDocument();
    expect(screen.getByText("/v1/prior-auth/submit")).toBeInTheDocument();
  });
});
