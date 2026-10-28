// Local development server: the real Worker code, in-memory KV, static files from public/.
//   node tests/dev-server.mjs            -> mock model (no key, no cost), answers derived from the reference labels
//   ANTHROPIC_API_KEY=... node tests/dev-server.mjs --live   -> real model calls
// Open http://localhost:8790/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";
import { CLAIMS } from "../public/claims/samples.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(here, "../public");
const PORT = Number(process.env.PORT || 8790);
const live = process.argv.includes("--live");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

// ---- mock model: finds a plausible quote for each reference fact, like a well-behaved model would ----
const pad = (n) => String(n).padStart(2, "0");
function dateQuotes(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const ocr = (s) => [s, s.replace(/1/g, "l")];
  return [...ocr(d + ". " + m + ". " + y), ...ocr(pad(d) + "." + pad(m) + "." + y)];
}
function findIn(text, cands) { for (const c of cands) { const i = text.indexOf(c); if (i >= 0) return c; } return null; }
function mockAnswer(docs) {
  const facts = [], instructions = [], translations = [];
  for (const d of docs) {
    const claim = CLAIMS.find((c) => c.docs.some((x) => x.id === d.id && x.text === d.text));
    const gold = claim ? claim.gold.facts.filter((g) => g[0] === d.id) : [];
    for (const [, kind, value] of gold) {
      let quote = null;
      if (/date|start|end/.test(kind)) {
        quote = findIn(d.text, dateQuotes(value));
        if (!quote || kind === "injury_date" && /Anamn|Анамн|Скарги/.test(d.text) && !d.text.includes("Datum úrazu")) {
          const line = d.text.split("\n").find((l) => /Anamn|Анамн|Скарги/.test(l));
          if (line && kind === "injury_date") quote = line.slice(0, 40);
        }
      } else if (kind === "diagnosis_code") quote = findIn(d.text, [value, value.replace("0", "O")]);
      else if (kind === "benefit_requested") quote = findIn(d.text, { hospital: ["pobyt v nemocnici"], sick_leave: ["pracovní neschopnost"], treatment_abroad: ["náklady na ošetření v zahraničí"] }[value] || []);
      else if (kind === "invoice_item" || kind === "invoice_total") quote = findIn(d.text, [Number(value).toLocaleString("cs-CZ").replace(/ /g, " ") + " грн", value + " грн"]);
      if (quote) facts.push({ doc_id: d.id, kind, value, quote, confidence: 0.93, currency: /грн/.test(quote) ? "UAH" : undefined });
    }
    if (!claim) { // own text: pick obvious dates and codes
      const m = /(\d{1,2})\. ?(\d{1,2})\. ?(20\d\d)/.exec(d.text);
      if (m) facts.push({ doc_id: d.id, kind: "exam_date", value: m[3] + "-" + pad(m[2]) + "-" + pad(m[1]), quote: m[0], confidence: 0.8 });
      const dx = /\b([A-TV-Z]\d\d\.\d)\b/.exec(d.text);
      if (dx) facts.push({ doc_id: d.id, kind: "diagnosis_code", value: dx[1], quote: dx[1], confidence: 0.9 });
    }
    d.text.split("\n").forEach((l) => { if (/AI REVIEW|AI assistant|automatické zpracování/i.test(l)) instructions.push({ doc_id: d.id, quote: l.trim(), why: "Addresses the AI or the review process" }); });
    if (/[Ѐ-ӿ]{4}/.test(d.text)) translations.push({ doc_id: d.id, english: "[mock translation] " + d.text.split("\n")[0] });
  }
  return { facts, instructions_found: instructions, translations };
}
if (!live) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(init.body);
      const docs = [...body.messages[0].content.matchAll(/<document id="([^"]+)" title="[^"]*">\n([\s\S]*?)\n<\/document>/g)].map((m) => ({ id: m[1], text: m[2] }));
      await new Promise((r) => setTimeout(r, 250));
      const input = mockAnswer(docs);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_extraction", input }], usage: { input_tokens: 2100 + body.messages[0].content.length / 4 | 0, output_tokens: 700 }, stop_reason: "tool_use" }), { status: 200 });
    }
    return realFetch(url, init);
  };
}

const store = new Map();
const env = {
  ANTHROPIC_API_KEY: live ? process.env.ANTHROPIC_API_KEY : "mock",
  DAILY_LIMIT: "500",
  KV: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
  ASSETS: { fetch: async (req) => {
    const u = new URL(req.url);
    let f = path.join(PUB, decodeURIComponent(u.pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!f.startsWith(PUB) || !fs.existsSync(f)) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { "content-type": types[path.extname(f)] || "application/octet-stream" } });
  } },
};

http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const r = await worker.fetch(new Request("http://localhost:" + PORT + req.url, { method: req.method, headers: { "content-type": req.headers["content-type"] || "text/plain", "cf-connecting-ip": "127.0.0.1" }, body: req.method === "POST" ? body : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log("Claim Triage Desk on http://localhost:" + PORT + (live ? " (live model)" : " (mock model)")));
