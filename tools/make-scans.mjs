// Renders the two fictional scans used by claim CL-2026-02755.
//   node tools/make-scans.mjs        (needs Playwright and Python with Pillow)
// Step 1: the text in tests/scan-texts.mjs is laid out as a paper document and rendered to PNG.
// Step 2: tools/degrade.py turns it into a flatbed scan (tilt, noise, blur) or a phone photo (perspective, shadow).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCAN_TEXTS } from "../tests/scan-texts.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../public/claims/scans");
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "scans-"));
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const lab = (line) => { const i = line.indexOf(":"); return i > 0 && i < 24 ? "<b>" + esc(line.slice(0, i + 1)) + "</b>" + esc(line.slice(i + 1)) : esc(line); };

const SIGN = '<svg width="260" height="70" viewBox="0 0 260 70"><path d="M8 48 C 30 10, 42 62, 60 30 S 92 20, 98 44 C 104 60, 124 12, 140 38 S 170 54, 186 30 C 196 18, 214 50, 252 22" fill="none" stroke="#1d3b8a" stroke-width="3" stroke-linecap="round"/></svg>';
const STAMP = '<svg width="210" height="210" viewBox="0 0 210 210" style="opacity:.62"><defs><path id="c" d="M105 105 m -78 0 a 78 78 0 1 1 156 0 a 78 78 0 1 1 -156 0"/></defs><circle cx="105" cy="105" r="98" fill="none" stroke="#3a4fb0" stroke-width="4"/><circle cx="105" cy="105" r="60" fill="none" stroke="#3a4fb0" stroke-width="2"/><text font-family="DejaVu Sans" font-size="19" font-weight="700" fill="#3a4fb0" letter-spacing="2"><textPath href="#c">NEMOCNICE PODJEŠTĚDÍ · TRAUMATOLOGIE ·</textPath></text><text x="105" y="112" text-anchor="middle" font-family="DejaVu Sans" font-size="22" font-weight="700" fill="#3a4fb0">VZOR</text></svg>';

function dischHtml(t) {
  const L = t.split("\n");
  return `<html><head><meta charset="utf-8"><style>
  body{margin:0;width:1240px;height:1754px;background:#fff;font-family:'DejaVu Serif',serif;color:#111;font-size:27px;line-height:1.5}
  .p{padding:90px 100px;position:relative;height:100%;box-sizing:border-box}
  .hd{display:flex;gap:28px;align-items:center;border-bottom:3px solid #111;padding-bottom:22px}
  .logo{width:96px;height:96px;border:5px solid #111;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 38px 'DejaVu Sans'}
  .hd .a{font:700 34px 'DejaVu Sans';letter-spacing:2px}.hd .b{font-size:26px}.hd .c{font-size:21px;color:#333}
  h1{font:700 38px 'DejaVu Sans';text-align:center;letter-spacing:4px;margin:56px 0 34px}
  .box{border:2px solid #111;padding:16px 22px;margin-bottom:34px}
  p{margin:0 0 16px}
  .sig{margin-top:64px;position:relative}.sig .stamp{position:absolute;left:470px;top:-40px;transform:rotate(-14deg)}
  </style></head><body><div class="p">
  <div class="hd"><div class="logo">NP</div><div><div class="a">${esc(L[0])}</div><div class="b">${esc(L[1])}</div><div class="c">${esc(L[2])}</div></div></div>
  <h1>${esc(L[4])}</h1>
  <div class="box"><p>${lab(L[6])}</p><p style="margin:0">${lab(L[7])}</p></div>
  ${L.slice(9, 15).map((l) => "<p>" + lab(l) + "</p>").join("")}
  <div class="sig"><p>${esc(L[16])}</p>${SIGN}<p>${esc(L[17])}</p><div class="stamp">${STAMP}</div></div>
  </div></body></html>`;
}

function dpnHtml(t) {
  const L = t.split("\n");
  const rows = L.slice(3).map((l) => { const i = l.indexOf(":"); return `<tr><td class="k">${esc(l.slice(0, i))}</td><td class="v">${esc(l.slice(i + 1).trim())}</td></tr>`; }).join("");
  return `<html><head><meta charset="utf-8"><style>
  body{margin:0;width:1100px;height:1400px;background:#fbfaf5;font-family:'DejaVu Sans',sans-serif;color:#1a1a1a}
  .p{padding:80px 80px}
  .t{font-weight:700;font-size:36px;letter-spacing:1px;line-height:1.3;border:3px solid #7a1f1f;color:#7a1f1f;padding:18px 22px}
  .s{font-size:22px;color:#7a1f1f;margin:12px 0 44px}
  table{width:100%;border-collapse:collapse}
  td{border:2px solid #7a1f1f;padding:22px 18px;font-size:27px;vertical-align:top}
  td.k{width:40%;color:#7a1f1f;font-size:23px}
  td.v{font-family:'DejaVu Sans Mono',monospace;font-size:30px}
  .sg{margin-top:70px;display:flex;justify-content:flex-end}
  </style></head><body><div class="p">
  <div class="t">${esc(L[0])}</div><div class="s">${esc(L[1])}</div>
  <table>${rows}</table>
  <div class="sg">${SIGN}</div>
  </div></body></html>`;
}

const b = await chromium.launch();
const jobs = [
  { key: "CL-2026-02755/disch", html: dischHtml, w: 1240, h: 1754, file: "CL-2026-02755-discharge.jpg", mode: "scan" },
  { key: "CL-2026-02755/dpn", html: dpnHtml, w: 1100, h: 1400, file: "CL-2026-02755-sick-leave.jpg", mode: "photo" },
];
for (const j of jobs) {
  const p = await b.newPage({ viewport: { width: j.w, height: j.h } });
  await p.setContent(j.html(SCAN_TEXTS[j.key]));
  const png = path.join(tmp, j.file.replace(".jpg", ".png"));
  await p.screenshot({ path: png });
  await p.close();
  execFileSync("python3", [path.join(here, "degrade.py"), j.mode, png, path.join(out, j.file)], { stdio: "inherit" });
}
await b.close();
console.log("Wrote", jobs.map((j) => j.file).join(", "));
