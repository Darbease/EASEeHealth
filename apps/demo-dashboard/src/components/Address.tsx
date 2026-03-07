"use client";

import { useState } from "react";

interface AddressProps {
  address: `0x${string}`;
}

export function Address({ address }: AddressProps) {
  const [copied, setCopied] = useState(false);
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  // Simple blockie-like color from address
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const bgColor = `hsl(${hue}, 60%, 25%)`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg)] px-2 py-1 text-xs font-mono transition-colors hover:bg-[var(--bg-card-hover)]"
      title={address}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full"
        style={{ backgroundColor: bgColor }}
      />
      <span>{copied ? "Copied!" : truncated}</span>
    </button>
  );
}
