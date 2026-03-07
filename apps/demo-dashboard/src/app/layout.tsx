import type { Metadata } from "next";
import { Providers } from "./providers";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofPA Demo Dashboard",
  description:
    "Interactive demo dashboard for ProofPA — privacy-preserving prior authorization",
};

function Nav() {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-card)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
            PA
          </div>
          <span className="text-lg font-semibold">ProofPA</span>
          <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]">
            Demo
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-[var(--text-muted)]">
          <Link href="/" className="hover:text-[var(--text)]">
            Dashboard
          </Link>
          <Link href="/contracts" className="hover:text-[var(--text)]">
            Contracts
          </Link>
          <Link href="/simulate" className="hover:text-[var(--text)]">
            Simulate
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
