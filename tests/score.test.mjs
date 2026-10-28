import test from "node:test";
import assert from "node:assert/strict";
import { scoreClaim, summarize } from "../eval/score.js";
import { CLAIMS, goldFacts } from "../public/claims/samples.js";
import { screenInjections } from "../public/lib/core.js";

function perfect(c) {
  return { facts: goldFacts(c), rejected: [], injections: screenInjections(c.docs, []), latencyMs: 1000, usage: { input_tokens: 2000, output_tokens: 800 }, costUsd: 0.0006 };
}

test("a perfect extraction scores 100% and every decision is right", () => {
  const rows = CLAIMS.map((c) => scoreClaim(c, perfect(c)));
  const s = summarize(rows);
  assert.equal(s.precision, 100);
  assert.equal(s.recall, 100);
  assert.equal(s.decisionsCorrect, CLAIMS.length);
  assert.equal(s.injectionsCaught, 2);
  assert.equal(s.falseInjectionFlags, 0);
  assert.deepEqual(s.scans, { recall: 100, precision: 100, tp: 7, fp: 0, fn: 0 });
});

test("a fact missed on a scan lowers recall on scans", () => {
  const c = CLAIMS.find((x) => x.id === "CL-2026-02755");
  const r = perfect(c);
  r.facts = r.facts.filter((f) => !(f.doc_id === "dpn" && f.kind === "sick_leave_end"));
  const s = summarize([scoreClaim(c, r)]);
  assert.equal(s.scans.fn, 1);
  assert.equal(s.scans.recall, 85.7);
});

test("a missed date and an invented one are counted, and the decision changes", () => {
  const c = CLAIMS.find((x) => x.id === "CL-2026-01187");
  const r = perfect(c);
  r.facts = r.facts.filter((f) => !(f.doc_id === "er" && f.kind === "injury_date"));
  r.facts.push({ id: "z", doc_id: "dpn", kind: "injury_date", value: "2026-03-03", confidence: 0.4 });
  const s = scoreClaim(c, r);
  assert.equal(s.fn.length, 1);
  assert.equal(s.fp.length, 1);
  assert.equal(s.decisionOk, false, "without the conflicting date the claim would wrongly look payable");
});
