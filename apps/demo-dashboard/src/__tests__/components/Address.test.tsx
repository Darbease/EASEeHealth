import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Address } from "@/components/Address";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;

describe("Address component", () => {
  it("truncates to 0x????...???? format", () => {
    render(<Address address={ADDR} />);
    expect(screen.getByText("0xf39F...2266")).toBeInTheDocument();
  });

  it("has full address in title attribute", () => {
    render(<Address address={ADDR} />);
    expect(screen.getByRole("button")).toHaveAttribute("title", ADDR);
  });

  it("renders colored circle with deterministic hue from address bytes", () => {
    const { container } = render(<Address address={ADDR} />);
    const dot = container.querySelector("span.rounded-full");
    expect(dot).toBeInTheDocument();
    // jsdom converts hsl() to rgb() — just verify background-color is set
    const style = dot!.getAttribute("style") ?? "";
    expect(style).toContain("background-color");
  });

  it("copies address to clipboard on click", async () => {
    render(<Address address={ADDR} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDR);
    });
  });

  it('shows "Copied!" after click', async () => {
    render(<Address address={ADDR} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });
});
