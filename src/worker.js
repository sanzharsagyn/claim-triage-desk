// Cloudflare Worker: serves the site and the live extraction API.
//   GET  /api/health   -> is live mode configured
//   POST /api/extract  -> { claimId, model } for a sample claim, or { docs:[{id,title,text}] } for your own text
// Spending is capped three ways: sample runs are cached forever, own-text runs are rate-limited per IP,
// and a global daily limit stops all model calls once reached.

import { extract, MODELS, PROMPT_VERSION } from "./extract.js";
import { CLAIMS, SAMPLES_VERSION } from "../public/claims/samples.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const LIMITS = { docs: 3, charsPerDoc: 6000, charsTotal: 12000, perIpPerDay: 8 };

function json(data, status) { return new Response(JSON.stringify(data), { status: status || 200, headers: JSON_HEADERS }); }

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

async function handleExtract(request, env) {
  if (!env.KV) return json({ error: "not_configured", message: "Storage is not configured." }, 503);
  const len = parseInt(request.headers.get("content-length") || "0", 10);
  if (len > 40000) return json({ error: "too_large", message: "The request is too large." }, 413);
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "bad_json", message: "The request is not valid JSON." }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad_input", message: "Nothing to extract." }, 400);

  let docs, modelKey, cacheKey, cacheTtl, sample = null;
  if (b.claimId) {
    sample = CLAIMS.find(function (c) { return c.id === b.claimId; });
    if (!sample) return json({ error: "unknown_claim", message: "Unknown sample claim." }, 404);
    docs = sample.docs.map(function (d) { return { id: d.id, title: d.title, text: d.text }; });
    modelKey = MODELS[b.model] ? b.model : "haiku";
    cacheKey = "x:sample:" + SAMPLES_VERSION + ":" + PROMPT_VERSION + ":" + modelKey + ":" + sample.id;
    cacheTtl = null; // samples never change for a given version: keep forever
  } else {
    if (!Array.isArray(b.docs) || !b.docs.length) return json({ error: "bad_input", message: "Add at least one document." }, 400);
    if (b.docs.length > LIMITS.docs) return json({ error: "too_many_docs", message: "Up to " + LIMITS.docs + " documents at a time." }, 400);
    docs = b.docs.map(function (d, i) {
      return { id: /^[a-z0-9_-]{1,20}$/i.test(String(d.id || "")) ? String(d.id) : "doc" + (i + 1), title: clean(d.title, 120), text: clean(d.text, LIMITS.charsPerDoc + 1) };
    });
    if (docs.some(function (d) { return !d.text.trim(); })) return json({ error: "empty_doc", message: "One of the documents is empty." }, 400);
    if (docs.some(function (d) { return d.text.length > LIMITS.charsPerDoc; })) return json({ error: "doc_too_long", message: "Each document can have up to " + LIMITS.charsPerDoc + " characters." }, 400);
    if (docs.reduce(function (a, d) { return a + d.text.length; }, 0) > LIMITS.charsTotal) return json({ error: "too_long", message: "Up to " + LIMITS.charsTotal + " characters in total." }, 400);
    modelKey = "haiku"; // own text always runs on the low-cost model
    cacheKey = "x:own:" + PROMPT_VERSION + ":" + (await sha256(JSON.stringify(docs)));
    cacheTtl = 7 * 24 * 3600;
  }

  const hit = await env.KV.get(cacheKey);
  if (hit) {
    const r = JSON.parse(hit);
    r.cached = true;
    return json(r);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ error: "live_off", message: "Live mode is switched off on this deployment." }, 503);

  const day = new Date().toISOString().slice(0, 10);
  const dailyLimit = parseInt(env.DAILY_LIMIT || "200", 10);
  if (!sample) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (!(await bump(env, "rl:ip:" + ip + ":" + day, LIMITS.perIpPerDay, 172800))) {
      return json({ error: "rate_limited", message: "You have reached today's limit of " + LIMITS.perIpPerDay + " live runs. The sample claims still work." }, 429);
    }
  }
  if (!(await bump(env, "rl:day:" + day, dailyLimit, 172800))) {
    return json({ error: "budget", message: "Today's live budget is used up. Recorded results are shown instead." }, 429);
  }

  let r;
  try {
    r = await extract({ apiKey: env.ANTHROPIC_API_KEY, docs: docs, modelKey: modelKey });
  } catch (e) {
    // The upstream error type and message help diagnose access, quota or parameter problems. They never contain the key.
    return json({ error: "model_error", message: "The model call failed. Please try again in a minute.", status: e.status || 0, upstream: e.detail || "" }, 502);
  }
  r.ranAt = new Date().toISOString();
  r.cached = false;
  const put = cacheTtl ? { expirationTtl: cacheTtl } : undefined;
  await env.KV.put(cacheKey, JSON.stringify(r), put);
  return json(r);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, live: !!env.ANTHROPIC_API_KEY, models: Object.keys(MODELS).map(function (k) { return { key: k, id: MODELS[k].id, label: MODELS[k].label }; }), prompt: PROMPT_VERSION, samples: SAMPLES_VERSION });
    }
    if (url.pathname === "/api/extract") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return handleExtract(request, env);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
