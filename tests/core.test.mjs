import test from "node:test";
import assert from "node:assert/strict";
import { findQuote, validateExtraction, screenInjections, analyzeClaim, isIsoDate, daysBetween } from "../public/lib/core.js";
import { CLAIMS, goldFacts } from "../public/claims/samples.js";
import { RAW_CLAIM1, RAW_BAD } from "./fixtures.mjs";

const c1 = CLAIMS[0];

test("findQuote tolerates whitespace and quote marks, nothing else", () => {
  assert.ok(findQuote("Přijata: 12. 1. 2026     Propuštěna", "Přijata: 12. 1. 2026 Propuštěna"));
  assert.ok(findQuote("Klinika «Alatau Med»", 'Klinika "Alatau Med"'));
  assert.equal(findQuote("Datum úrazu: 12. 1. 2026", "Datum úrazu: 13. 1. 2026"), null);
  assert.equal(findQuote("abc", "a"), null);
});

test("dates", () => {
  assert.ok(isIsoDate("2026-02-28"));
  assert.ok(!isIsoDate("2026-02-29"));
  assert.ok(!isIsoDate("12. 1. 2026"));
  assert.equal(daysBetween("2026-02-28", "2026-04-10"), 41);
});

test("validator keeps grounded facts and spans point at the quote", () => {
  const v = validateExtraction(c1.docs, RAW_CLAIM1);
  assert.equal(v.facts.length, 10);
  assert.equal(v.rejected.length, 0);
  const f = v.facts.find((x) => x.kind === "discharge_date");
  const doc = c1.docs.find((d) => d.id === f.doc_id);
  assert.equal(doc.text.slice(f.span[0], f.span[1]), "Propuštěna: 14. 1. 2026");
});

test("validator rejects invented quotes, bad formats, unknown docs and kinds", () => {
  const v = validateExtraction(c1.docs, RAW_BAD);
  assert.equal(v.facts.length, 0);
  assert.equal(v.rejected.length, RAW_BAD.facts.length);
  assert.match(v.rejected[0].reasons.join(), /quote not found/);
  assert.match(v.rejected[1].reasons.join(), /YYYY-MM-DD/);
  assert.match(v.rejected[2].reasons.join(), /unknown document/);
  assert.match(v.rejected[3].reasons.join(), /ICD-10/);
  assert.match(v.rejected[4].reasons.join(), /unknown field type/);
  assert.match(v.rejected[5].reasons.join(), /unknown benefit/);
  assert.match(v.rejected[6].reasons.join(), /YYYY-MM-DD/);
});

test("transcribed scans: a quote may differ only in punctuation and layout", () => {
  const docs = [{ id: "dpn", text: "Den vzniku DPN: 14. 8. 2026\nDiagnóza: S42.0", transcribed: true }];
  const v = validateExtraction(docs, { facts: [
    { doc_id: "dpn", kind: "sick_leave_start", value: "2026-08-14", quote: "Den vzniku DPN | 14.8.2026", confidence: 0.9 },
    { doc_id: "dpn", kind: "sick_leave_end", value: "2026-09-25", quote: "Den ukončení DPN 25. 9. 2026", confidence: 0.9 },
  ] });
  assert.equal(v.facts.length, 1);
  assert.equal(v.facts[0].quote, "Den vzniku DPN: 14. 8. 2026");
  assert.equal(v.facts[0].match, "ignoring punctuation");
  assert.equal(v.rejected.length, 1, "different letters or digits are still rejected");
  const typed = validateExtraction([{ id: "dpn", text: "Den vzniku DPN: 14. 8. 2026" }], { facts: [{ doc_id: "dpn", kind: "sick_leave_start", value: "2026-08-14", quote: "Den vzniku DPN | 14.8.2026", confidence: 0.9 }] });
  assert.equal(typed.facts.length, 0, "typed documents stay strict");
});

test("validator survives garbage", () => {
  assert.deepEqual(validateExtraction(c1.docs, null), { facts: [], rejected: [] });
  assert.deepEqual(validateExtraction(c1.docs, { facts: "x" }), { facts: [], rejected: [] });
});

test("rule-based injection screen: catches both planted injections, no false alarms on the clean documents", () => {
  let flagged = 0;
  for (const c of CLAIMS) {
    const hits = screenInjections(c.docs, []);
    assert.deepEqual([...new Set(hits.map((h) => h.doc_id))].sort(), [...c.gold.injection].sort(), c.id);
    flagged += hits.length;
  }
  assert.equal(flagged, 2);
});

test("model-reported injection counts only with a real quote", () => {
  const hits = screenInjections(c1.docs, [{ doc_id: "form", quote: "this text is not in the document" }]);
  assert.equal(hits.length, 0);
  const ok = screenInjections(c1.docs, [{ doc_id: "form", quote: "Při bruslení jsem upadla", why: "test" }]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].source, "model");
});

test("gold labels and the rules agree on every decision", () => {
  for (const c of CLAIMS) {
    const r = analyzeClaim(c, goldFacts(c), screenInjections(c.docs, []));
    assert.equal(r.rec.act, c.gold.rec, c.id);
  }
});

test("payouts follow the policy terms", () => {
  const pay = (id) => { const c = CLAIMS.find((x) => x.id === id); return analyzeClaim(c, goldFacts(c), screenInjections(c.docs, [])); };
  assert.equal(pay("CL-2026-01042").total, 2 * 600 + 28 * 400);          // 2 hospital days, 42 sick days paid from day 15
  assert.equal(pay("CL-2026-00418").total, 3 * 600 + 26 * 400);          // 40 sick days
  assert.equal(pay("CL-2026-01688").total, 7 * 400);                     // 21 sick days
  assert.equal(pay("CL-2026-02310").total, 5 * 400);                     // 19 sick days, treatment abroad not covered
  assert.equal(pay("CL-2026-01187").total, 0);                           // on hold: date conflict
  assert.equal(pay("CL-2026-01187").proposed, 28 * 400);
  assert.equal(pay("CL-2026-02391").rec.act, "info");                    // sick leave for back pain after a knee injury
  assert.equal(pay("CL-2026-02755").total, 2 * 600 + 29 * 400);          // scanned claim: 43 sick days
  assert.equal(pay("CL-2026-02840").total, 8 * 400);                     // 22 sick days; the 2019 diagnosis is history, not this claim
  assert.equal(pay("CL-2026-02902").total, 3 * 600);                     // Austrian hospital stay; treatment abroad not covered
});

test("an old diagnosis from the medical history would wrongly hold the claim", () => {
  const c = CLAIMS.find((x) => x.id === "CL-2026-02840");
  const facts = goldFacts(c).concat([{ id: "x", doc_id: "er", kind: "diagnosis_code", value: "S82.6", confidence: 0.6 }]);
  assert.equal(analyzeClaim(c, facts, []).rec.act, "info");
});

test("scan documents have no text of their own until the model transcribes them", () => {
  const c = CLAIMS.find((x) => x.id === "CL-2026-02755");
  assert.equal(c.docs.filter((d) => d.scan).length, 2);
  assert.deepEqual(screenInjections(c.docs, [{ doc_id: "disch", quote: "anything" }]), []);
});

test("a cover date after the injury holds the payment", () => {
  const c = Object.assign({}, c1, { coverFrom: "2026-02-01" });
  const r = analyzeClaim(c, goldFacts(c1), []);
  assert.equal(r.rec.act, "info");
  assert.equal(r.total, 0);
});
