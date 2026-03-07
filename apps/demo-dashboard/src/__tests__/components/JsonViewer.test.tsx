import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { syntaxHighlight } from "@/components/JsonViewer";
import { JsonViewer } from "@/components/JsonViewer";

describe("syntaxHighlight", () => {
  it("wraps keys with json-key class", () => {
    const result = syntaxHighlight('"name":');
    expect(result).toContain('class="json-key"');
  });

  it("wraps strings with json-string class", () => {
    const result = syntaxHighlight('"hello"');
    expect(result).toContain('class="json-string"');
  });

  it("wraps numbers with json-number class", () => {
    const result = syntaxHighlight("42");
    expect(result).toContain('class="json-number"');
  });

  it("wraps booleans with json-boolean class", () => {
    const result = syntaxHighlight("true");
    expect(result).toContain('class="json-boolean"');
  });

  it("wraps null with json-null class", () => {
    const result = syntaxHighlight("null");
    expect(result).toContain('class="json-null"');
  });
});

describe("JsonViewer component", () => {
  it("renders JSON in a <pre> element", () => {
    const { container } = render(<JsonViewer data={{ a: 1 }} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre!.innerHTML).toContain("json-key");
  });
});
