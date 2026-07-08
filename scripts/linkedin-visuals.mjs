#!/usr/bin/env node
// Generates the LinkedIn-article visuals (cover 1920x1080, in-article 1600x900)
// into docs/content/visuals/. Shares the thread-visuals design system.
// Zero dependencies. Deterministic output.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "content", "visuals");
mkdirSync(OUT, { recursive: true });

const C = {
  bg: "#0B1120", panel: "#111A2E", panelLine: "#1E2A44",
  blue: "#375BD2", blueSoft: "#5C7CE8", teal: "#2DD4BF", green: "#34D399",
  red: "#F87171", amber: "#FBBF24", text: "#F1F5F9", dim: "#8FA3C4", faint: "#5B6C8C",
};
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const txt = (x, y, s, { size = 30, fill = C.text, weight = 400, anchor = "start", spacing = 0, family = FONT } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(s)}</text>`;
const panel = (x, y, w, h, { r = 22, fill = C.panel, stroke = C.panelLine, sw = 2 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const arrow = (x1, y1, x2, y2, color = C.dim, w = 3.5) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>` +
  `<polygon points="${x2},${y2} ${x2 - 14},${y2 - 7} ${x2 - 14},${y2 + 7}" fill="${color}" transform="rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI},${x2},${y2})"/>`;
const hexagon = (cx, cy, r, color, sw = 4) => {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
};
function domino(x, y, w, h, angle, color) {
  const cx = x + w / 2, cy = y + h / 2;
  let d = `<g transform="rotate(${angle},${cx},${cy})">`;
  d += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.panel}" stroke="${color}" stroke-width="3.5"/>`;
  d += `<line x1="${x + 10}" y1="${y + h / 2}" x2="${x + w - 10}" y2="${y + h / 2}" stroke="${color}" stroke-width="2.5"/>`;
  for (const [fx, fy] of [[0.3, 0.22], [0.7, 0.3], [0.35, 0.72], [0.65, 0.8]]) d += `<circle cx="${x + fx * w}" cy="${y + fy * h}" r="7" fill="${color}"/>`;
  return d + "</g>";
}
const brand = (W) =>
  hexagon(74, 74, 26, C.blue, 4.5) + hexagon(74, 74, 12, C.blueSoft, 3) +
  txt(116, 66, "EASE eHealth", { size: 26, weight: 700 }) +
  txt(116, 94, "on Chainlink CRE", { size: 20, fill: C.dim });

const images = {};

// ── cover (1920x1080) ───────────────────────────────────────────────
images["linkedin-cover"] = () => {
  const W = 1920, H = 1080;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  s += `<rect width="${W}" height="8" fill="${C.blue}"/>`;
  s += brand(W);
  s += txt(96, 400, "Two questions", { size: 110, weight: 800 });
  s += txt(96, 530, "and a payment.", { size: 110, weight: 800 });
  s += txt(96, 640, "Rebuilding US prior authorization on rails no one owns —", { size: 40, fill: C.dim });
  s += txt(96, 696, "FHIR APIs in, smart-contract verification, instant settlement out.", { size: 40, fill: C.dim });
  s += txt(96, 830, "Decisions measured in milliseconds.", { size: 36, fill: C.teal, weight: 700 });
  s += txt(96, 882, "The regulatory ceiling is 72 hours.", { size: 36, fill: C.amber, weight: 700 });
  s += domino(1380, 380, 150, 330, -8, C.teal);
  s += domino(1560, 420, 150, 330, 16, C.amber);
  s += domino(1700, 520, 150, 330, 44, C.red);
  s += `<line x1="96" y1="${H - 90}" x2="${W - 96}" y2="${H - 90}" stroke="${C.panelLine}" stroke-width="2"/>`;
  s += txt(96, H - 40, "github.com/Darbease/EASEeHealth", { size: 26, fill: C.faint });
  return { svg: s, W, H };
};

// ── timeline: why now ───────────────────────────────────────────────
images["linkedin-timeline"] = () => {
  const W = 1600, H = 900;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  s += `<rect width="${W}" height="6" fill="${C.blueSoft}"/>`;
  s += brand(W);
  s += txt(W - 60, 80, "WHY NOW", { size: 24, fill: C.faint, weight: 700, anchor: "end", spacing: 3 });
  s += txt(60, 190, "The dominoes fell in order", { size: 48, weight: 800 });
  const y = 520;
  s += `<line x1="100" y1="${y}" x2="${W - 100}" y2="${y}" stroke="${C.panelLine}" stroke-width="4"/>`;
  const stop = (x, year, title, sub1, sub2, color, above) => {
    let r = `<circle cx="${x}" cy="${y}" r="16" fill="${C.bg}" stroke="${color}" stroke-width="5"/>`;
    const py = above ? y - 250 : y + 60;
    r += `<line x1="${x}" y1="${above ? y - 20 : y + 20}" x2="${x}" y2="${above ? py + 190 : py - 10}" stroke="${color}" stroke-width="2.5" stroke-dasharray="6 6"/>`;
    r += panel(x - 170, py, 340, 180, { stroke: color, sw: 2.5 });
    r += txt(x, py + 46, year, { size: 30, weight: 800, fill: color, anchor: "middle" });
    r += txt(x, py + 92, title, { size: 27, weight: 700, anchor: "middle" });
    r += txt(x, py + 126, sub1, { size: 22, fill: C.dim, anchor: "middle" });
    r += txt(x, py + 156, sub2, { size: 22, fill: C.dim, anchor: "middle" });
    return r;
  };
  s += stop(300, "2016", "21st Century Cures Act", "Blocking health data", "becomes illegal", C.teal, true);
  s += stop(660, "Feb 2024", "Change Healthcare falls", "1 missing MFA control →", "~50% of claims frozen", C.red, false);
  s += stop(1020, "Jul 2025", "GENIUS Act", "Federal framework", "for stablecoins", C.amber, true);
  s += stop(1380, "Jan 2027", "CMS-0057-F deadline", "FHIR prior-auth APIs", "mandatory for payers", C.blueSoft, false);
  s += txt(60, H - 40, "Data must move over APIs. Money is moving on-chain. The middleman already failed.", { size: 28, fill: C.dim });
  return { svg: s, W, H };
};

// ── before / after flow ─────────────────────────────────────────────
images["linkedin-before-after"] = () => {
  const W = 1600, H = 900;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  s += `<rect width="${W}" height="6" fill="${C.blueSoft}"/>`;
  s += brand(W);
  s += txt(W - 60, 80, "BEFORE / AFTER", { size: 24, fill: C.faint, weight: 700, anchor: "end", spacing: 3 });

  const box = (x, y, w, label1, label2, color = C.panelLine, tcolor = C.text) =>
    panel(x, y, w, 120, { stroke: color, sw: 2.5 }) +
    txt(x + w / 2, y + (label2 ? 52 : 70), label1, { size: 26, weight: 700, anchor: "middle", fill: tcolor }) +
    (label2 ? txt(x + w / 2, y + 88, label2, { size: 22, fill: C.dim, anchor: "middle" }) : "");

  // BEFORE
  s += txt(60, 200, "TODAY", { size: 30, weight: 800, fill: C.red, spacing: 2 });
  let y = 240;
  s += box(60, y, 280, "Doctor's EHR", "");
  s += arrow(350, y + 60, 420, y + 60, C.dim);
  s += box(430, y, 340, "Clearinghouse", "FHIR → X12 278", C.red, C.red);
  s += arrow(780, y + 60, 850, y + 60, C.dim);
  s += box(860, y, 280, "Payer system", "manual review");
  s += arrow(1150, y + 60, 1220, y + 60, C.dim);
  s += box(1230, y, 310, "Days to weeks", "then 837/835 remit", C.red, C.red);

  s += `<line x1="60" y1="440" x2="${W - 60}" y2="440" stroke="${C.panelLine}" stroke-width="2"/>`;

  // AFTER
  s += txt(60, 500, "EASE eHEALTH", { size: 30, weight: 800, fill: C.teal, spacing: 2 });
  y = 540;
  s += box(60, y, 280, "FHIR", "ServiceRequest");
  s += arrow(350, y + 60, 420, y + 60, C.blueSoft);
  s += panel(430, y - 10, 340, 140, { stroke: C.blue, sw: 3 });
  s += hexagon(520, y + 60, 44, C.blueSoft, 3.5);
  s += txt(660, y + 48, "CRE", { size: 30, weight: 800, anchor: "middle" });
  s += txt(660, y + 84, "no owner", { size: 22, fill: C.teal, anchor: "middle", weight: 700 });
  s += arrow(780, y + 60, 850, y + 60, C.blueSoft);
  s += box(860, y, 280, "3 contract reads", "network · plan · gates");
  s += arrow(1150, y + 60, 1220, y + 60, C.blueSoft);
  s += box(1230, y, 310, "Escrow releases", "gated on APPROVED", C.green, C.green);

  s += txt(60, 790, "Same transaction. 328 ms, measured — with a machine-readable reason on every denial.", { size: 30, weight: 700 });
  s += txt(60, H - 40, "The clearinghouse translation layer and the weeks-long remit cycle simply disappear.", { size: 26, fill: C.dim });
  return { svg: s, W, H };
};

// ── design choices table ────────────────────────────────────────────
images["linkedin-choices"] = () => {
  const W = 1600, H = 900;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  s += `<rect width="${W}" height="6" fill="${C.blueSoft}"/>`;
  s += brand(W);
  s += txt(W - 60, 80, "DESIGN CHOICES", { size: 24, fill: C.faint, weight: 700, anchor: "end", spacing: 3 });
  const rows = [
    ["Shared registries, no owner", "A fix written once propagates to every payer — no chokepoint to freeze", C.blueSoft],
    ["FHIR / Da Vinci shapes, not custom JSON", "Conform to the 2027 mandate — payers recognize every model", C.teal],
    ["Hybrid plan: gates on-chain, design by hash", "Payer-signed (EIP-712), verifiable by anyone, gas stays sane", C.amber],
    ["Necessity judged from the EHR record", "Diagnosis + treatment history vs. plan criteria — how payers actually adjudicate", C.green],
    ["Enforcement in the contract, not the workflow", "Escrow reverts on DENIED — even a buggy orchestrator can't move funds", C.red],
  ];
  let y = 160;
  for (const [choice, why, color] of rows) {
    s += panel(60, y, 1480, 128);
    s += `<rect x="60" y="${y}" width="14" height="128" rx="7" fill="${color}"/>`;
    s += txt(110, y + 55, choice, { size: 31, weight: 800, fill: color });
    s += txt(110, y + 100, why, { size: 27, fill: C.dim });
    y += 144;
  }
  return { svg: s, W, H };
};

for (const [name, fn] of Object.entries(images)) {
  const { svg, W, H } = fn();
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  writeFileSync(join(OUT, `${name}.svg`), doc);
  writeFileSync(join(OUT, `${name}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${doc}</body></html>`);
  console.log(`wrote ${name} (${W}x${H})`);
}
