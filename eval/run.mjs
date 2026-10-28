// Runs the evaluation against a deployed Worker and writes the results the site shows.
//   node eval/run.mjs https://sanzhar.<your-subdomain>.workers.dev
// Every sample claim is sent once per model through the same /api/extract path visitors use,
// then compared with the gold labels in public/claims/samples.js.
// Results: public/claims/eval-results.json (shown on the site) and eval/RESULTS.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, SAMPLES_VERSION } from "../public/claims/samples.js";
import { scoreClaim, summarize } from "./score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node eval/run.mjs https://sanzhar.<your-subdomain>.workers.dev");
  process.exit(1);
}
const MODELS = ["haiku", "sonnet"];
const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base);
if (local && !process.argv.includes("--publish-local")) {
  console.error("This is a local server, probably with the mock model. Results are not written to the site.\nAdd --publish-local only for testing the page.");
}

async function call(claimId, model) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    const res = await fetch(base + "/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId, model }) });
    const body = await res.json().catch(function () { return {}; });
    if (res.ok) { body.roundTripMs = Date.now() - t0; return body; }
    console.error("  " + claimId + " " + model + ": " + res.status + " " + (body.message || body.error || "") + (body.upstream ? "\n    Anthropic: " + body.upstream : ""));
    if (res.status === 503 || res.status === 429) throw new Error(body.message || body.error);
    if (body.upstream && /not_found|permission|authentication|invalid_request/.test(body.upstream)) throw new Error(body.upstream);
    await new Promise(function (r) { setTimeout(r, 3000 * attempt); });
  }
  throw new Error("failed after 3 attempts: " + claimId + " " + model);
}

const out = { ranAt: new Date().toISOString(), samplesVersion: SAMPLES_VERSION, documents: CLAIMS.reduce(function (a, c) { return a + c.docs.length; }, 0), models: {} };
const failed = {};
for (const model of MODELS) {
  console.log("Model: " + model);
  const rows = [];
  let modelId = null, promptVersion = null;
  for (const claim of CLAIMS) {
    let r;
    try { r = await call(claim.id, model); }
    catch (e) { failed[model] = e.message; console.error("  Skipping " + model + ": " + e.message); break; }
    modelId = r.model; promptVersion = r.promptVersion;
    const s = scoreClaim(claim, r);
    s.cached = !!r.cached;
    rows.push(s);
    console.log("  " + claim.id + "  facts " + s.tp.length + "/" + (s.tp.length + s.fn.length) + "  extra " + s.fp.length + "  rejected " + s.rejected + "  decision " + s.decision + (s.decisionOk ? " ok" : " (expected " + s.decisionGold + ")") + (s.cached ? "  [cached]" : ""));
  }
  if (!failed[model]) out.models[model] = { modelId: modelId, promptVersion: promptVersion, summary: summarize(rows), claims: rows };
}
const done = MODELS.filter(function (m) { return out.models[m]; });
if (!done.length) { console.error("No model finished. Nothing written."); process.exit(1); }

out.endpoint = local ? "local" : base;
if (!local || process.argv.includes("--publish-local")) fs.writeFileSync(path.join(here, "../public/claims/eval-results.json"), JSON.stringify(out, null, 1));

const lines = ["# Evaluation results", "", "Run " + out.ranAt + " on " + out.documents + " documents in " + CLAIMS.length + " claims (samples " + SAMPLES_VERSION + ").", "",
  "| Model | Precision | Recall | F1 | Quotes rejected | Injections caught | False flags | Decisions correct | Median latency | Cost per claim |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
for (const m of done) {
  const s = out.models[m].summary;
  lines.push("| " + out.models[m].modelId + " | " + s.precision + "% | " + s.recall + "% | " + s.f1 + "% | " + s.rejectedByValidation + " | " + s.injectionsCaught + "/" + s.injectionsExpected + " | " + s.falseInjectionFlags + " | " + s.decisionsCorrect + "/" + s.claims + " | " + (s.latencyP50 / 1000).toFixed(1) + " s | $" + s.costPerClaimUsd + " |");
}
lines.push("", "## Misses and extra facts", "");
for (const m of done) {
  for (const row of out.models[m].claims) {
    if (row.fn.length || row.fp.length) lines.push("- " + m + " · " + row.claimId + ": missed " + (row.fn.join(", ") || "none") + "; extra " + (row.fp.join(", ") || "none"));
  }
}
fs.writeFileSync(path.join(here, local ? "RESULTS.local.md" : "RESULTS.md"), lines.join("\n") + "\n");
if (Object.keys(failed).length) console.log("\nNot evaluated: " + Object.keys(failed).map(function (m) { return m + " (" + failed[m] + ")"; }).join(", "));
console.log("\nWrote public/claims/eval-results.json and eval/RESULTS.md. Deploy again to publish them: npx wrangler deploy");
