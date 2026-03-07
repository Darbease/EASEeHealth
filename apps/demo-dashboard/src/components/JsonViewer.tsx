"use client";

import { useState } from "react";

export function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "json-key" : "json-string";
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

export function JsonViewer({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text)] group-hover:opacity-100"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre
        className="overflow-x-auto rounded-lg bg-[var(--bg)] p-3 text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: syntaxHighlight(json) }}
      />
    </div>
  );
}
