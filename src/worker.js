// Cloudflare Worker: serves the site and the extraction API.
//   GET  /api/v1/health     -> is live mode configured, which models
//   POST /api/v1/extract    -> { claimId, model } for a sample claim, or { docs:[{id,title,text} | {id,title,file:{mime,data}}] }
//   POST /api/v1/feedback   -> { claimId, ai, decision }: the handler's decision, for the override rate
//   GET  /api/v1/metrics    -> daily counters for the monitoring page
//   GET  /api/openapi.json  -> OpenAPI 3.1 description of the above
// The unversioned /api/health and /api/extract are kept for the first version of the page.
// Spending is capped three ways: sample runs are cached forever, own runs are rate-limited per IP,
// and a global daily limit stops all model calls once reached.

import { extract, MODELS, PROMPT_VERSION, FILE_TYPES } from "./extract.js";
import { openapi } from "./openapi.js";
import { CLAIMS, SAMPLES_VERSION } from "../public/claims/samples.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
// Files are capped at 1.5 MB: parsing a much larger JSON body would not fit the Worker's CPU budget.
// The page resizes photos to 1568 px before upload, which is also the largest size the model uses.
export const LIMITS = { docs: 3, files: 2, charsPerDoc: 6000, charsTotal: 12000, fileBytes: 1.5 * 1024 * 1024, perIpPerDay: 8, feedbackPerIpPerDay: 60 };
const ACTS = ["approve", "info", "escalate"];

function json(data, status, extra) { return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({}, JSON_HEADERS, extra || {}) }); }
const today = () => new Date().toISOString().slice(0, 10);

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}

async function bump(env, key, limit, ttl) {
  const cur = parseInt((await env.KV.get(key)) || "0", 10);
  if (cur >= limit) return false;
  await env.KV.put(key, String(cur + 1), { expirationTtl: ttl });
  return true;
}

function clean(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max); }

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- monitoring ----------
// One JSON document per day in KV. Read-modify-write, so parallel requests can lose an increment:
// good enough for a demo dashboard. In production this would be a metrics store (Analytics Engine, Azure Monitor).
const LAT_BUCKETS = [2000, 4000, 8000, 16000];
function emptyDay(day) {
  return { day: day, runs: 0, errors: 0, limited: 0, byModel: {}, files: 0, latencyMs: 0, latency: [0, 0, 0, 0, 0],
    costUsd: 0, inputTokens: 0, outputTokens: 0, facts: 0, rejected: 0, injections: 0, decisions: 0, overrides: 0, byDecision: {} };
}
async function record(env, fn) {
  try {
    const k = "m:" + today();
    const cur = JSON.parse((await env.KV.get(k)) || "null") || emptyDay(today());
    fn(cur);
    await env.KV.put(k, JSON.stringify(cur), { expirationTtl: 90 * 86400 });
  } catch (e) { /* monitoring must never break a request */ }
}
function recordRun(m, r) {
  m.runs++;
  m.byModel[r.modelKey] = (m.byModel[r.modelKey] || 0) + 1;
  m.latencyMs += r.latencyMs || 0;
  let b = LAT_BUCKETS.findIndex(function (x) { return (r.latencyMs || 0) < x; });
  if (b < 0) b = LAT_BUCKETS.length;
  m.latency[b]++;
  m.costUsd = Math.round((m.costUsd + (r.costUsd || 0)) * 1e6) / 1e6;
  m.inputTokens += (r.usage && r.usage.input_tokens) || 0;
  m.outputTokens += (r.usage && r.usage.output_tokens) || 0;
  m.facts += r.facts.length; m.rejected += r.rejected.length; m.injections += r.injections.length;
  m.files += (r.transcripts || []).length;
}

async function handleMetrics(url, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  const n = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days") || "14", 10) || 14));
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const v = JSON.parse((await env.KV.get("m:" + d)) || "null");
    days.push(v || emptyDay(d));
  }
  return json({ days: days, latencyBuckets: LAT_BUCKETS, dailyLimit: parseInt(env.DAILY_LIMIT || "200", 10), prompt: PROMPT_VERSION, samples: SAMPLES_VERSION }, 200, { "cache-control": "public, max-age=30" });
}

async function handleFeedback(request, env) {
  if (!env.KV) return json({ error: "not_configured" }, 503);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  if (!b || ACTS.indexOf(b.ai) < 0 || ACTS.indexOf(b.decision) < 0) return json({ error: "bad_input", message: "ai and decision must be one of " + ACTS.join(", ") + "." }, 400);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await bump(env, "rl:fb:" + ip + ":" + today(), LIMITS.feedbackPerIpPerDay, 172800))) return json({ error: "rate_limited", message: "Too many decisions today." }, 429);
  await record(env, function (m) {
    m.decisions++;
    if (b.ai !== b.decision) m.overrides++;
    m.byDecision[b.decision] = (m.byDecision[b.decision] || 0) + 1;
  });
  return json({ ok: true });
}

// ---------- extraction ----------
async function sampleDocs(sample, request, env) {
  return Promise.all(sample.docs.map(async function (d) {
    if (!d.scan) return { id: d.id, title: d.title, text: d.text };
    const res = await env.ASSETS.fetch(new Request(new URL(d.scan, request.url)));
    if (!res.ok) throw new Error("scan_missing");
    return { id: d.id, title: d.title, file: { mime: d.mime, data: toBase64(await res.arrayBuffer()) } };
  }));
}

function ownDocs(list) {
  if (!Array.isArray(list) || !list.length) return { err: ["bad_input", "Add at least one document."] };
  if (list.length > LIMITS.docs) return { err: ["too_many_docs", "Up to " + LIMITS.docs + " documents at a time."] };
  const docs = [];
  let files = 0, chars = 0;
  for (let i = 0; i < list.length; i++) {
    const d = list[i] || {};
    const id = /^[a-z0-9_-]{1,20}$/i.test(String(d.id || "")) ? String(d.id) : "doc" + (i + 1);
    const title = clean(d.title, 120);
    if (d.file) {
      files++;
      const mime = String(d.file.mime || "");
      const data = String(d.file.data || "");
      if (FILE_TYPES.indexOf(mime) < 0) return { err: ["bad_file", "Files can be JPEG, PNG, WebP or PDF."] };
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { err: ["bad_file", "The file is not valid base64."] };
      if (data.length * 0.75 > LIMITS.fileBytes) return { err: ["file_too_large", "Each file can be up to 1.5 MB."] };
      docs.push({ id: id, title: title, file: { mime: mime, data: data } });
    } else {
      const text = clean(d.text, LIMITS.charsPerDoc + 1);
      if (!text.trim()) return { err: ["empty_doc", "One of the documents is empty."] };
      if (text.length > LIMITS.charsPerDoc) return { err: ["doc_too_long", "Each document can have up to " + LIMITS.charsPerDoc + " characters."] };
      chars += text.length;
      docs.push({ id: id, title: title, text: text });
    }
  }
  if (files > LIMITS.files) return { err: ["too_many_files", "Up to " + LIMITS.files + " files at a time."] };
  if (chars > LIMITS.charsTotal) return { err: ["too_long", "Up to " + LIMITS.charsTotal + " characters in total."] };
  return { docs: docs, files: files };
}

async function handleExtract(request, env) {
  if (!env.KV) return json({ error: "not_configured", message: "Storage is not configured." }, 503);
  const len = parseInt(request.headers.get("content-length") || "0", 10);
  if (len > 3.5 * 1024 * 1024) return json({ error: "too_large", message: "The request is too large." }, 413);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad_input", message: "Nothing to extract." }, 400);

  let docs, modelKey, cacheKey = null, cacheTtl = null, sample = null;
  if (b.claimId) {
    sample = CLAIMS.find(function (c) { return c.id === b.claimId; });
    if (!sample) return json({ error: "unknown_claim", message: "Unknown sample claim." }, 404);
    modelKey = MODELS[b.model] ? b.model : "haiku";
    cacheKey = "x:sample:" + SAMPLES_VERSION + ":" + PROMPT_VERSION + ":" + modelKey + ":" + sample.id;
    // samples never change for a given version: keep forever
  } else {
    const o = ownDocs(b.docs);
    if (o.err) return json({ error: o.err[0], message: o.err[1] }, 400);
    docs = o.docs;
    modelKey = "haiku"; // own documents always run on the low-cost model
    // Text results are cached for a week. Uploaded files are never stored: no cache, nothing kept.
    if (!o.files) { cacheKey = "x:own:" + PROMPT_VERSION + ":" + (await sha256(JSON.stringify(docs))); cacheTtl = 7 * 24 * 3600; }
  }

  if (cacheKey) {
    const hit = await env.KV.get(cacheKey);
    if (hit) {
      const r = JSON.parse(hit);
      r.cached = true; // not counted in the metrics: every page view replays cached samples, and KV writes are limited
      return json(r);
    }
  }
  if (!env.ANTHROPIC_API_KEY) return json({ error: "live_off", message: "Live mode is switched off on this deployment." }, 503);

  const day = today();
  const dailyLimit = parseInt(env.DAILY_LIMIT || "200", 10);
  if (!sample) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await bump(env, "rl:ip:" + ip + ":" + day, LIMITS.perIpPerDay, 172800))) {
      await record(env, function (m) { m.limited++; });
      return json({ error: "rate_limited", message: "You have reached today's limit of " + LIMITS.perIpPerDay + " live runs. The sample claims still work." }, 429);
    }
  }
  if (!(await bump(env, "rl:day:" + day, dailyLimit, 172800))) {
    await record(env, function (m) { m.limited++; });
    return json({ error: "budget", message: "Today's live budget is used up. Recorded results are shown instead." }, 429);
  }

  let r;
  try {
    if (sample) docs = await sampleDocs(sample, request, env);
    r = await extract({ apiKey: env.ANTHROPIC_API_KEY, docs: docs, modelKey: modelKey });
  } catch (e) {
    await record(env, function (m) { m.errors++; });
    // The upstream error type and message help diagnose access, quota or parameter problems. They never contain the key.
    return json({ error: "model_error", message: "The model call failed. Please try again in a minute.", status: e.status || 0, upstream: e.detail || "" }, 502);
  }
  r.ranAt = new Date().toISOString();
  r.cached = false;
  await record(env, function (m) { recordRun(m, r); });
  if (cacheKey) await env.KV.put(cacheKey, JSON.stringify(r), cacheTtl ? { expirationTtl: cacheTtl } : undefined);
  return json(r);
}

function health(env) {
  return json({ ok: true, live: !!env.ANTHROPIC_API_KEY, version: "v1",
    models: Object.keys(MODELS).map(function (k) { return { key: k, id: MODELS[k].id, label: MODELS[k].label }; }),
    prompt: PROMPT_VERSION, samples: SAMPLES_VERSION, fileTypes: FILE_TYPES, limits: LIMITS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/^\/api\/v1\//, "/api/");
    if (url.pathname === "/api/openapi.json") return json(openapi(url.origin), 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
    if (p === "/api/health") return health(env);
    if (p === "/api/metrics") return request.method === "GET" ? handleMetrics(url, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/extract") return request.method === "POST" ? handleExtract(request, env) : json({ error: "method_not_allowed" }, 405);
    if (p === "/api/feedback") return request.method === "POST" ? handleFeedback(request, env) : json({ error: "method_not_allowed" }, 405);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
