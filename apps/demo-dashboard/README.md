# EASE eHealth Demo Dashboard

Port: **3000** | Next.js 16 + React 19 + Tailwind CSS + TanStack React Query

Interactive web dashboard for demonstrating the EASE eHealth prior authorization system.

## Features

- **Dashboard** — System health panel (6 services + Anvil chain), 3 scenario cards
- **Scenario Runner** — Step-through demo execution with live API request/response display and real-time state machine visualization
- **Contract Explorer** — Query claim decisions, payout status, consent records, and policy state directly from Anvil
- **CRE Simulator** — Trigger CRE workflow simulations and stream real-time output

## Pages

| Path | Description |
|------|-------------|
| `/` | Main dashboard with system health and scenario cards |
| `/scenarios/[id]` | Interactive scenario runner (A: happy path, B: consent denial, C: challenge) |
| `/simulate` | CRE workflow simulator (all 8 workflows) |
| `/contracts` | On-chain contract state viewer |

## Running

```bash
# Requires: Anvil running + contracts deployed + services running
make dashboard-install   # install dependencies
make dashboard           # start on :3000
```

## API Routes

| Path | Description |
|------|-------------|
| `/api/simulate` | Proxy to CRE simulate CLI |
| `/api/services/[...path]` | Proxy to backend services (ports 3001-3006) |
