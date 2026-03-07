import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioCard } from "@/components/ScenarioCard";

// Mock next/link to render a plain anchor
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const PROPS = {
  id: "a",
  title: "Happy Path",
  description: "Full prior auth flow",
  services: ["Policy Service", "Proof Service"],
  contracts: ["ClaimDecisionRegistry", "ClaimEscrow"],
  color: "#22c55e",
};

describe("ScenarioCard component", () => {
  it("renders title and description", () => {
    render(<ScenarioCard {...PROPS} />);
    expect(screen.getByText("Happy Path")).toBeInTheDocument();
    expect(screen.getByText("Full prior auth flow")).toBeInTheDocument();
  });

  it("renders services list", () => {
    render(<ScenarioCard {...PROPS} />);
    expect(screen.getByText("Policy Service, Proof Service")).toBeInTheDocument();
  });

  it("links to /scenarios/{id}", () => {
    render(<ScenarioCard {...PROPS} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/scenarios/a");
  });

  it("color dot has correct backgroundColor", () => {
    const { container } = render(<ScenarioCard {...PROPS} />);
    const dot = container.querySelector("span.rounded-full");
    expect(dot).toBeInTheDocument();
    const style = dot!.getAttribute("style") ?? "";
    // jsdom may render as hex or rgb
    expect(
      style.includes("#22c55e") || style.includes("rgb(34, 197, 94)")
    ).toBe(true);
  });
});
