import "@testing-library/jest-dom/vitest";

// jsdom may not provide crypto.randomUUID
if (typeof globalThis.crypto?.randomUUID !== "function") {
  const orig = globalThis.crypto ?? ({} as Crypto);
  globalThis.crypto = {
    ...orig,
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
  } as Crypto;
}

// Stub navigator.clipboard for copy tests
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
  writable: true,
  configurable: true,
});
