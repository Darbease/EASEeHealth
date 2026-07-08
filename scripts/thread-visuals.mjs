#!/usr/bin/env node
// Generates the 15 tweet-card SVGs (1600x900) for docs/content/prior-auth-on-cre-thread.md
// into docs/content/visuals/, plus an HTML wrapper per card for headless-Chrome rasterizing.
// Zero dependencies. Deterministic output.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "content", "visuals");
mkdirSync(OUT, { recursive: true });

const W = 1600, H = 900;
const C = {
  bg: "#0B1120",
  panel: "#111A2E",
  panelLine: "#1E2A44",
  blue: "#375BD2",     // Chainlink brand blue
  blueSoft: "#5C7CE8",
  teal: "#2DD4BF",
  green: "#34D399",
  red: "#F87171",
  amber: "#FBBF24",
  text: "#F1F5F9",
  dim: "#8FA3C4",
  faint: "#5B6C8C",
};
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── shared primitives ───────────────────────────────────────────────
const txt = (x, y, s, { size = 30, fill = C.text, weight = 400, anchor = "start", spacing = 0, family = FONT } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(s)}</text>`;

const lines = (x, y, arr, lh, opts) => arr.map((s, i) => txt(x, y + i * lh, s, opts)).join("");

const panel = (x, y, w, h, { r = 22, fill = C.panel, stroke = C.panelLine, sw = 2 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

const chip = (x, y, label, color) =>
  `<rect x="${x}" y="${y}" width="${label.length * 15.6 + 48}" height="44" rx="22" fill="none" stroke="${color}" stroke-width="2.5"/>` +
  txt(x + 24, y + 30, label, { size: 22, fill: color, weight: 700, spacing: 2 });

const arrow = (x1, y1, x2, y2, color = C.dim, w = 3.5) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>` +
  `<polygon points="${x2},${y2} ${x2 - 14},${y2 - 7} ${x2 - 14},${y2 + 7}" fill="${color}" transform="rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI},${x2},${y2})"/>`;

function domino(x, y, w, h, angle, color, dots = 6) {
  const cx = x + w / 2, cy = y + h / 2;
  let d = `<g transform="rotate(${angle},${cx},${cy})">`;
  d += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.panel}" stroke="${color}" stroke-width="3.5"/>`;
  d += `<line x1="${x + 10}" y1="${y + h / 2}" x2="${x + w - 10}" y2="${y + h / 2}" stroke="${color}" stroke-width="2.5"/>`;
  const positions = { top: [[0.3, 0.18], [0.7, 0.32], [0.3, 0.32], [0.7, 0.18]], bot: [[0.3, 0.68], [0.7, 0.82], [0.5, 0.75]] };
  const pts = [...positions.top.slice(0, Math.min(4, Math.ceil(dots / 2))), ...positions.bot.slice(0, Math.floor(dots / 2))];
  for (const [fx, fy] of pts.slice(0, dots)) d += `<circle cx="${x + fx * w}" cy="${y + fy * h}" r="7" fill="${color}"/>`;
  return d + "</g>";
}

const lock = (x, y, s, color) =>
  `<rect x="${x}" y="${y + s * 0.42}" width="${s}" height="${s * 0.58}" rx="${s * 0.12}" fill="${color}"/>` +
  `<path d="M ${x + s * 0.22} ${y + s * 0.45} v ${-s * 0.18} a ${s * 0.28} ${s * 0.28} 0 0 1 ${s * 0.56} 0 v ${s * 0.18}" fill="none" stroke="${color}" stroke-width="${s * 0.11}"/>` +
  `<circle cx="${x + s / 2}" cy="${y + s * 0.68}" r="${s * 0.08}" fill="${C.bg}"/>`;

const hexagon = (cx, cy, r, color, sw = 4) => {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
};

// ── frame: header / footer shared by every card ─────────────────────
function frame(n, kicker, kickerColor = C.blueSoft) {
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  // subtle top glow
  s += `<rect width="${W}" height="6" fill="${kickerColor}" opacity="0.9"/>`;
  // header
  s += hexagon(74, 74, 26, C.blue, 4.5);
  s += hexagon(74, 74, 12, C.blueSoft, 3);
  s += txt(116, 66, "EASE eHealth", { size: 26, weight: 700 });
  s += txt(116, 94, "on Chainlink CRE", { size: 20, fill: C.dim });
  s += txt(W - 60, 80, `${n} / 15`, { size: 26, fill: C.faint, weight: 700, anchor: "end" });
  if (kicker) s += chip(60, 132, kicker, kickerColor);
  // footer
  s += `<line x1="60" y1="${H - 64}" x2="${W - 60}" y2="${H - 64}" stroke="${C.panelLine}" stroke-width="2"/>`;
  return s;
}
// (footer text added per-card via foot())
const foot = (left, right = "github.com/Darbease/EASEeHealth") =>
  txt(60, H - 26, left, { size: 20, fill: C.faint }) +
  txt(W - 60, H - 26, right, { size: 20, fill: C.faint, anchor: "end" });

const cards = {};

// ── 1: hook ─────────────────────────────────────────────────────────
cards[1] = () => {
  let s = frame(1, "THE SETUP");
  s += txt(60, 270, "One of the biggest problems", { size: 60, weight: 800 });
  s += txt(60, 345, "in American healthcare.", { size: 60, weight: 800 });
  s += txt(60, 520, "$265B", { size: 140, weight: 800, fill: C.red });
  s += txt(60, 575, "per year in administrative waste  (JAMA, 2019)", { size: 30, fill: C.dim });
  s += txt(60, 690, "A few dominoes had to fall first.", { size: 36, fill: C.text, weight: 600 });
  s += txt(60, 738, "They're falling now.", { size: 36, fill: C.teal, weight: 700 });
  s += domino(1130, 300, 120, 260, -8, C.blueSoft, 5);
  s += domino(1290, 330, 120, 260, 14, C.teal, 4);
  s += domino(1420, 400, 120, 260, 38, C.amber, 3);
  s += foot("Prior authorization, rebuilt end-to-end");
  return s;
};

// ── 2: domino 1 — the data ──────────────────────────────────────────
cards[2] = () => {
  let s = frame(2, "DOMINO 1 — THE DATA", C.teal);
  s += domino(1360, 240, 130, 290, -6, C.teal, 4);
  s += panel(60, 230, 1220, 170);
  s += txt(100, 300, "21st Century Cures Act", { size: 40, weight: 700, fill: C.teal });
  s += txt(100, 356, "Blocking health data is illegal.", { size: 30, fill: C.dim });
  s += arrow(660, 430, 660, 480, C.teal);
  s += panel(60, 500, 1220, 200);
  s += txt(100, 570, "CMS-0057-F", { size: 40, weight: 700, fill: C.teal });
  s += txt(100, 622, "By Jan 2027, insurers MUST expose prior auth, eligibility,", { size: 30, fill: C.dim });
  s += txt(100, 662, "and patient data over standard FHIR APIs.", { size: 30, fill: C.dim });
  s += txt(60, 790, "Health data moving over APIs isn't a trend. It's signed law.", { size: 34, weight: 700 });
  s += foot("Domino 1 of 3");
  return s;
};

// ── 3: domino 2 — the money ─────────────────────────────────────────
cards[3] = () => {
  let s = frame(3, "DOMINO 2 — THE MONEY", C.amber);
  s += domino(1360, 240, 130, 290, 10, C.amber, 4);
  s += panel(60, 230, 1220, 170);
  s += txt(100, 300, "GENIUS Act", { size: 40, weight: 700, fill: C.amber });
  s += txt(100, 356, "A federal framework for stablecoins.", { size: 30, fill: C.dim });
  // rails diagram
  const y = 520;
  s += panel(60, y, 340, 130); s += txt(230, y + 60, "Financial", { size: 30, weight: 700, anchor: "middle" }); s += txt(230, y + 98, "institutions", { size: 30, weight: 700, anchor: "middle" });
  s += arrow(410, y + 65, 520, y + 65, C.amber);
  s += panel(530, y, 340, 130); s += txt(700, y + 60, "Tokenized", { size: 30, weight: 700, anchor: "middle" }); s += txt(700, y + 98, "rails", { size: 30, weight: 700, anchor: "middle" });
  s += arrow(880, y + 65, 990, y + 65, C.amber);
  s += panel(1000, y, 340, 130); s += txt(1170, y + 60, "Smart-contract", { size: 30, weight: 700, anchor: "middle" }); s += txt(1170, y + 98, "settlement", { size: 30, weight: 700, anchor: "middle" });
  s += txt(60, 790, "Programmable money is becoming boring, regulated infrastructure.", { size: 34, weight: 700 });
  s += foot("Domino 2 of 3");
  return s;
};

// ── 4: domino 3 — the middleman failed ──────────────────────────────
cards[4] = () => {
  let s = frame(4, "DOMINO 3 — THE MIDDLEMAN FAILED", C.red);
  s += domino(1380, 500, 130, 290, 82, C.red, 3);
  s += txt(60, 330, "~50%", { size: 140, weight: 800, fill: C.red });
  s += txt(60, 390, "of US medical claims flow through ONE clearinghouse", { size: 32, fill: C.dim });
  s += panel(60, 460, 600, 180);
  s += txt(90, 530, "Feb 2024", { size: 28, fill: C.faint, weight: 700 });
  s += txt(90, 580, "1 missing MFA control", { size: 36, weight: 700, fill: C.red });
  s += txt(90, 618, "froze the nation's claims", { size: 28, fill: C.dim });
  s += arrow(680, 550, 760, 550, C.red);
  s += panel(780, 460, 520, 180);
  s += txt(810, 545, "$8.9B", { size: 64, weight: 800, fill: C.amber });
  s += txt(810, 600, "in emergency loans to keep clinics alive", { size: 26, fill: C.dim });
  s += txt(60, 780, "The industry is actively looking for what's next.", { size: 34, weight: 700 });
  s += foot("Domino 3 of 3 — US v. UnitedHealth/Change (2022); Senate Finance testimony");
  return s;
};

// ── 5: the pivot — CRE between APIs and contracts ───────────────────
cards[5] = () => {
  let s = frame(5, "THE PIVOT", C.blueSoft);
  s += lines(60, 250, [
    "Health data legally must move over APIs.",
    "Money is moving to smart contracts.",
    "The centralized middleman is a proven single point of failure.",
  ], 52, { size: 32, fill: C.dim });
  const y = 480;
  s += panel(60, y, 380, 160); s += txt(250, y + 72, "FHIR APIs", { size: 36, weight: 700, anchor: "middle" }); s += txt(250, y + 116, "health data in", { size: 24, fill: C.dim, anchor: "middle" });
  s += arrow(450, y + 80, 560, y + 80, C.blueSoft); s += arrow(560, y + 108, 450, y + 108, C.blueSoft);
  s += `<g>${hexagon(800, y + 80, 92, C.blue, 6)}${hexagon(800, y + 80, 64, C.blueSoft, 3)}</g>`;
  s += txt(800, y + 72, "CRE", { size: 42, weight: 800, anchor: "middle" });
  s += txt(800, y + 112, "no owner", { size: 22, fill: C.teal, anchor: "middle", weight: 700 });
  s += arrow(1040, y + 80, 1150, y + 80, C.blueSoft); s += arrow(1150, y + 108, 1040, y + 108, C.blueSoft);
  s += panel(1160, y, 380, 160); s += txt(1350, y + 72, "Smart contracts", { size: 34, weight: 700, anchor: "middle" }); s += txt(1350, y + 116, "verification + settlement", { size: 24, fill: C.dim, anchor: "middle" });
  s += txt(60, 780, "The use case: prior authorization.", { size: 38, weight: 800, fill: C.teal });
  s += foot("Sitting between APIs and smart contracts, with no owner in the middle, is exactly what CRE is");
  return s;
};

// ── 6: the thesis ───────────────────────────────────────────────────
cards[6] = () => {
  let s = frame(6, "THE THESIS", C.teal);
  s += txt(60, 280, "Healthcare payments should be two questions:", { size: 42, weight: 700 });
  s += panel(60, 330, 1480, 130);
  s += txt(100, 410, "1", { size: 64, weight: 800, fill: C.teal });
  s += txt(170, 410, "Does the patient medically require this care?", { size: 40, weight: 600 });
  s += panel(60, 490, 1480, 130);
  s += txt(100, 570, "2", { size: 64, weight: 800, fill: C.teal });
  s += txt(170, 570, "Is the patient in the network, on the plan?", { size: 40, weight: 600 });
  s += arrow(800, 650, 800, 700, C.green, 5);
  s += txt(800, 760, "If both are true, funds release to cover the care.", { size: 42, weight: 800, fill: C.green, anchor: "middle" });
  s += txt(800, 810, "Everything else is overhead.", { size: 30, fill: C.dim, anchor: "middle" });
  s += foot("The whole transaction");
  return s;
};

// ── 7: prior auth today — stat grid ─────────────────────────────────
cards[7] = () => {
  let s = frame(7, "PRIOR AUTH TODAY", C.red);
  const cell = (x, y, big, sub1, sub2, color) => {
    let c = panel(x, y, 710, 230);
    c += txt(x + 40, y + 110, big, { size: 72, weight: 800, fill: color });
    c += txt(x + 40, y + 160, sub1, { size: 28, fill: C.dim });
    if (sub2) c += txt(x + 40, y + 196, sub2, { size: 28, fill: C.dim });
    return c;
  };
  s += cell(60, 230, "37%", "still runs on fax,", "phone, and mail", C.red);
  s += cell(830, 230, "$6 + 11 min", "per request —", "even electronically", C.amber);
  s += cell(60, 490, "13 hrs / week", "per physician,", "spent on prior auth", C.amber);
  s += cell(830, 490, "80.7%", "of appealed denials", "get OVERTURNED", C.red);
  s += txt(60, 800, "95% of doctors say it delays care.  26% report a serious adverse event.", { size: 32, weight: 700 });
  s += foot("CAQH Index 2023 · AMA 2025 survey · KFF / CMS 2024");
  return s;
};

// ── 8: today's flow ─────────────────────────────────────────────────
cards[8] = () => {
  let s = frame(8, "HOW IT WORKS TODAY", C.red);
  const y = 300;
  s += panel(60, y, 300, 150); s += txt(210, y + 68, "Doctor's", { size: 30, weight: 700, anchor: "middle" }); s += txt(210, y + 106, "EHR", { size: 30, weight: 700, anchor: "middle" });
  s += arrow(370, y + 75, 470, y + 75, C.dim);
  s += panel(480, y - 30, 400, 210, { stroke: C.red, sw: 3 });
  s += txt(680, y + 40, "Clearinghouse", { size: 32, weight: 700, anchor: "middle", fill: C.red });
  s += txt(680, y + 82, "translates to X12 278", { size: 25, fill: C.dim, anchor: "middle" });
  s += txt(680, y + 116, "(a 1990s EDI format)", { size: 25, fill: C.dim, anchor: "middle" });
  s += txt(680, y + 152, "~50% of US claims", { size: 24, fill: C.red, anchor: "middle", weight: 700 });
  s += arrow(890, y + 75, 990, y + 75, C.dim);
  s += panel(1000, y, 300, 150); s += txt(1150, y + 68, "Payer's", { size: 30, weight: 700, anchor: "middle" }); s += txt(1150, y + 106, "system", { size: 30, weight: 700, anchor: "middle" });
  // return path
  s += `<path d="M 1150 ${y + 170} v 70 H 210 v -70" fill="none" stroke="${C.faint}" stroke-width="3" stroke-dasharray="10 8"/>`;
  s += `<polygon points="210,${y + 170} 203,${y + 184} 217,${y + 184}" fill="${C.faint}"/>`;
  s += txt(680, y + 275, "…and back through the middleman again.  Days to weeks.", { size: 30, fill: C.dim, anchor: "middle" });
  s += panel(60, 660, 1480, 120, { fill: "#160F1B", stroke: C.red });
  s += txt(100, 732, "Every payer keeps its own private copy of plans, eligibility, and directories.", { size: 32, weight: 700, fill: C.red });
  s += foot(">80% of provider-directory listings are inaccurate (Senate Finance, 2023)");
  return s;
};

// ── 9: our flow — entry ─────────────────────────────────────────────
cards[9] = () => {
  let s = frame(9, "HOW WE REBUILT IT", C.blueSoft);
  s += txt(60, 270, "Shared facts move on-chain. CRE sits in the middle", { size: 40, weight: 700 });
  s += txt(60, 322, "of the API calls — instead of a clearinghouse.", { size: 40, weight: 700 });
  const y = 430;
  s += panel(60, y, 430, 190);
  s += txt(90, y + 66, "FHIR ServiceRequest", { size: 32, weight: 700, fill: C.teal });
  s += txt(90, y + 110, "the exact shape the", { size: 25, fill: C.dim });
  s += txt(90, y + 144, "2027 mandate requires", { size: 25, fill: C.dim });
  s += arrow(500, y + 95, 620, y + 95, C.blueSoft, 4.5);
  s += txt(560, y + 70, "signed", { size: 21, fill: C.dim, anchor: "middle" });
  s += txt(560, y + 132, "HTTP", { size: 21, fill: C.dim, anchor: "middle" });
  s += `<g>${hexagon(760, y + 95, 96, C.blue, 6)}${hexagon(760, y + 95, 66, C.blueSoft, 3)}</g>`;
  s += txt(760, y + 84, "CRE", { size: 40, weight: 800, anchor: "middle" });
  s += txt(760, y + 124, "workflow fires", { size: 21, fill: C.teal, anchor: "middle", weight: 700 });
  s += panel(940, y, 600, 190);
  s += txt(970, y + 62, "No cron.", { size: 34, weight: 700 });
  s += txt(970, y + 110, "No queue.", { size: 34, weight: 700 });
  s += txt(970, y + 158, "No intermediary inbox.", { size: 34, weight: 700, fill: C.teal });
  s += foot("HTTP trigger — the workflow fires the moment the provider submits");
  return s;
};

// ── 10: confidential fetch ──────────────────────────────────────────
cards[10] = () => {
  let s = frame(10, "CONFIDENTIAL BY CONSTRUCTION", C.teal);
  const y = 300;
  s += panel(60, y, 400, 170); s += txt(260, y + 78, "Clinical record", { size: 32, weight: 700, anchor: "middle" }); s += txt(260, y + 120, "(FHIR source)", { size: 25, fill: C.dim, anchor: "middle" });
  // encrypted pipe
  s += `<rect x="470" y="${y + 55}" width="620" height="60" rx="30" fill="none" stroke="${C.teal}" stroke-width="3.5" stroke-dasharray="14 10"/>`;
  s += lock(750, y + 62, 46, C.teal);
  s += txt(780, y + 150, "confidential HTTP — DON nodes relay ciphertext", { size: 24, fill: C.teal, anchor: "middle", weight: 700 });
  s += arrow(1090, y + 85, 1130, y + 85, C.teal);
  s += `<g>${hexagon(1290, y + 85, 92, C.blue, 6)}</g>`;
  s += txt(1290, y + 76, "CRE", { size: 38, weight: 800, anchor: "middle" });
  s += txt(1290, y + 116, "cross-checks", { size: 21, fill: C.dim, anchor: "middle" });
  s += panel(60, 560, 1480, 190, { fill: "#0D1A22", stroke: C.teal });
  s += txt(100, 640, "No PHI ever touches the chain.", { size: 44, weight: 800, fill: C.teal });
  s += txt(100, 700, "On-chain: hashes, state transitions, and payout events. Nothing else.", { size: 30, fill: C.dim });
  s += foot("The submission is verified against the source — the workflow doesn't trust the caller");
  return s;
};

// ── 11: three contract reads ────────────────────────────────────────
cards[11] = () => {
  let s = frame(11, "THEN CRE CHECKS THE SMART CONTRACTS", C.blueSoft);
  const reg = (y, name, q, color) => {
    let r = panel(60, y, 1480, 150);
    r += `<rect x="60" y="${y}" width="14" height="150" rx="7" fill="${color}"/>`;
    r += txt(110, y + 62, name, { size: 32, weight: 800, fill: color });
    r += txt(110, y + 112, q, { size: 34, fill: C.text });
    return r;
  };
  s += reg(240, "OrganizationRegistry", "Is this provider in-network for the plan?", C.blueSoft);
  s += reg(420, "CoverageRegistry", "Is this patient actually ON the plan, right now?", C.teal);
  s += reg(600, "PolicyRegistry", "Is the procedure covered — and under the cap?", C.amber);
  s += txt(60, 810, "Three reads against shared registries — the same state every payer and provider sees.", { size: 30, fill: C.dim });
  s += foot("EVM reads with DON consensus");
  return s;
};

// ── 12: payer-signed rules + TEE necessity ──────────────────────────
cards[12] = () => {
  let s = frame(12, "WHOSE RULES? THE INSURER'S.", C.amber);
  s += panel(60, 240, 720, 420);
  s += txt(100, 310, "The payer-signed plan", { size: 34, weight: 800, fill: C.amber });
  s += lines(100, 370, [
    "Plan gates live on-chain",
    "Signed by the payer — EIP-712",
    "Full benefit design pinned by hash",
    "Verified before trusting a byte",
  ], 56, { size: 29, fill: C.dim });
  s += txt(100, 618, "PlanCommitment ✓ signature verified", { size: 26, fill: C.green, weight: 700, family: "Menlo, monospace" });
  s += panel(820, 240, 720, 420);
  s += txt(860, 310, "Medical necessity — from the EHR", { size: 34, weight: 800, fill: C.teal });
  s += lines(860, 370, [
    "Diagnosis + reason codes",
    "Documented treatment history",
    "Physician's letter on file",
    "Checked against the plan's criteria",
  ], 56, { size: 29, fill: C.dim });
  s += lock(1460, 290, 54, C.teal);
  s += txt(60, 760, "Question 2 is the smart contracts. Question 1 is the EHR record itself.", { size: 32, weight: 700 });
  s += foot("The clinical record travels over confidential HTTP — verified, never exposed");
  return s;
};

// ── 13: escrow gate ─────────────────────────────────────────────────
cards[13] = () => {
  let s = frame(13, "THE MONEY CAN'T MISBEHAVE", C.green);
  s += txt(60, 270, "Decision written on-chain via DON-signed reports.", { size: 34, weight: 700 });
  s += txt(60, 320, "If APPROVED — stablecoin funds release from escrow in the same flow.", { size: 34, weight: 700 });
  // code panel
  s += panel(60, 380, 1480, 260, { fill: "#0A0F1C", stroke: C.panelLine });
  const mono = { size: 32, family: "Menlo, Consolas, monospace" };
  s += txt(100, 460, "function releasePayout(bytes32 claimId) {", { ...mono, fill: C.dim });
  s += txt(140, 515, 'require(decisions.isApproved(claimId),', { ...mono, fill: C.text });
  s += txt(140, 570, '"ClaimEscrow: claim not approved");  // REVERTS', { ...mono, fill: C.red });
  s += txt(100, 620, "}", { ...mono, fill: C.dim });
  s += txt(60, 740, "A denied claim cannot be paid.", { size: 48, weight: 800, fill: C.green });
  s += txt(60, 790, "Enforced by the contract itself — not by the workflow.", { size: 28, fill: C.dim });
  s += foot("Even a buggy or malicious orchestrator can't move funds for a denied claim");
  return s;
};

// ── 14: measured results ────────────────────────────────────────────
cards[14] = () => {
  let s = frame(14, "MEASURED, END-TO-END", C.green);
  const row = (y, label, outcome, detail, ms, color) => {
    let r = panel(60, y, 1480, 108);
    r += txt(95, y + 66, label, { size: 30, weight: 600 });
    r += txt(830, y + 66, outcome, { size: 30, weight: 800, fill: color });
    r += txt(1090, y + 66, detail, { size: 26, fill: C.dim });
    r += txt(1505, y + 66, ms, { size: 32, weight: 800, fill: color, anchor: "end" });
    return r;
  };
  s += row(230, "Knee MRI · $850 · in-network · on plan", "APPROVED → PAID", "", "328 ms", C.green);
  s += row(352, "Acupuncture — not covered", "DENIED", "bitmap 2", "139 ms", C.red);
  s += row(474, "Out-of-network provider", "DENIED", "bitmap 256", "139 ms", C.red);
  s += row(596, "Coverage lapsed — not on plan", "DENIED", "bitmap 512", "140 ms", C.red);
  s += txt(60, 790, "The regulatory ceiling for these decisions:", { size: 34, weight: 600 });
  s += txt(790, 790, "72 hours.", { size: 44, weight: 800, fill: C.amber });
  s += foot("Every denial carries a machine-readable reason — what CMS-0057-F requires");
  return s;
};

// ── 15: closing ─────────────────────────────────────────────────────
cards[15] = () => {
  let s = frame(15, "THE DOMINOES ARE FALLING", C.blueSoft);
  s += domino(120, 560, 110, 240, 84, C.teal, 4);
  s += domino(400, 560, 110, 240, 84, C.amber, 4);
  s += domino(680, 560, 110, 240, 84, C.red, 3);
  s += txt(60, 270, "Data must move over APIs by 2027", { size: 36, weight: 700, fill: C.teal });
  s += txt(60, 322, "(only ~47% of providers will be ready)", { size: 26, fill: C.dim });
  s += txt(60, 400, "Money is moving on-chain", { size: 36, weight: 700, fill: C.amber });
  s += txt(60, 478, "The middleman failed", { size: 36, weight: 700, fill: C.red });
  s += panel(960, 250, 580, 420, { stroke: C.blue, sw: 3 });
  s += txt(1250, 330, "CRE connects all three", { size: 34, weight: 800, anchor: "middle" });
  s += txt(1250, 410, "FHIR APIs in", { size: 30, fill: C.teal, anchor: "middle", weight: 700 });
  s += arrow(1250, 435, 1250, 470, C.dim);
  s += txt(1250, 510, "smart-contract verification", { size: 30, fill: C.blueSoft, anchor: "middle", weight: 700 });
  s += arrow(1250, 535, 1250, 570, C.dim);
  s += txt(1250, 610, "stablecoin settlement out", { size: 30, fill: C.green, anchor: "middle", weight: 700 });
  s += txt(60, 810, "Code + evidence:  github.com/Darbease/EASEeHealth", { size: 34, weight: 800, fill: C.text });
  s += foot("EASE eHealth — prior authorization on Chainlink CRE", "");
  return s;
};

// ── emit ────────────────────────────────────────────────────────────
for (let n = 1; n <= 15; n++) {
  const body = cards[n]();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const name = `tweet-${String(n).padStart(2, "0")}`;
  writeFileSync(join(OUT, `${name}.svg`), svg);
  writeFileSync(
    join(OUT, `${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${svg}</body></html>`
  );
  console.log(`wrote ${name}.svg`);
}
