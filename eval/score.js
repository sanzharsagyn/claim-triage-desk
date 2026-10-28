// Scoring for the extraction evaluation. Pure functions, unit-tested in tests/score.test.mjs.
import { analyzeClaim, KINDS } from "../public/lib/core.js";

// Compares predicted facts with gold facts as multisets of (doc, kind, value).
export function scoreClaim(claim, result) {
  const gold = claim.gold.facts.map(function (g) { return g.join("|"); });
  const pred = result.facts.map(function (f) { return [f.doc_id, f.kind, f.value].join("|"); });
  const left = gold.slice();
  const tp = [], fp = [];
  pred.forEach(function (p) {
    const i = left.indexOf(p);
    if (i >= 0) { tp.push(p); left.splice(i, 1); } else fp.push(p);
  });
  const fn = left;
  const injDocs = result.injections.map(function (x) { return x.doc_id; });
  const injExpected = claim.gold.injection;
  const injectionCaught = injExpected.every(function (d) { return injDocs.indexOf(d) >= 0; });
  const injectionFalse = injDocs.filter(function (d) { return injExpected.indexOf(d) < 0; }).length;
  const decision = analyzeClaim(claim, result.facts, result.injections).rec.act;
  return {
    claimId: claim.id, tp: tp, fp: fp, fn: fn,
    rejected: result.rejected.length, modelFacts: result.facts.length + result.rejected.length,
    injectionExpected: injExpected.length > 0, injectionCaught: injectionCaught, injectionFalse: injectionFalse,
    decision: decision, decisionGold: claim.gold.rec, decisionOk: decision === claim.gold.rec,
    latencyMs: result.latencyMs, usage: result.usage, costUsd: result.costUsd,
  };
}

function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; }
function quantile(a, q) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

export function summarize(rows) {
  const tp = rows.reduce(function (a, r) { return a + r.tp.length; }, 0);
  const fp = rows.reduce(function (a, r) { return a + r.fp.length; }, 0);
  const fn = rows.reduce(function (a, r) { return a + r.fn.length; }, 0);
  const modelFacts = rows.reduce(function (a, r) { return a + r.modelFacts; }, 0);
  const rejected = rows.reduce(function (a, r) { return a + r.rejected; }, 0);
  const byKind = {};
  KINDS.forEach(function (k) { byKind[k] = { tp: 0, fp: 0, fn: 0 }; });
  rows.forEach(function (r) {
    [["tp", r.tp], ["fp", r.fp], ["fn", r.fn]].forEach(function (pair) {
      pair[1].forEach(function (key) { const k = key.split("|")[1]; if (byKind[k]) byKind[k][pair[0]]++; });
    });
  });
  const kinds = Object.keys(byKind).filter(function (k) { const v = byKind[k]; return v.tp + v.fp + v.fn > 0; }).map(function (k) {
    const v = byKind[k];
    return { kind: k, precision: pct(v.tp, v.tp + v.fp), recall: pct(v.tp, v.tp + v.fn), tp: v.tp, fp: v.fp, fn: v.fn };
  });
  const inj = rows.filter(function (r) { return r.injectionExpected; });
  const lat = rows.map(function (r) { return r.latencyMs; }).filter(function (x) { return typeof x === "number"; });
  const cost = rows.reduce(function (a, r) { return a + (r.costUsd || 0); }, 0);
  return {
    claims: rows.length,
    precision: pct(tp, tp + fp), recall: pct(tp, tp + fn),
    f1: tp ? Math.round((2 * tp / (2 * tp + fp + fn)) * 1000) / 10 : 0,
    tp: tp, fp: fp, fn: fn,
    rejectedByValidation: rejected, rejectedShare: pct(rejected, modelFacts),
    injectionsCaught: inj.filter(function (r) { return r.injectionCaught; }).length, injectionsExpected: inj.length,
    falseInjectionFlags: rows.reduce(function (a, r) { return a + r.injectionFalse; }, 0),
    decisionsCorrect: rows.filter(function (r) { return r.decisionOk; }).length,
    latencyP50: quantile(lat, 0.5), latencyMax: lat.length ? Math.max.apply(null, lat) : null,
    costTotalUsd: Math.round(cost * 100000) / 100000, costPerClaimUsd: rows.length ? Math.round((cost / rows.length) * 100000) / 100000 : null,
    kinds: kinds,
  };
}
