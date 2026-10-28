// Claim Triage Desk: the deterministic core.
// Runs in the browser and in the Cloudflare Worker. No model is involved here:
// this file decides what counts as a valid extracted fact and what the policy allows.

export const KINDS = [
  "injury_date", "exam_date", "admission_date", "discharge_date",
  "sick_leave_start", "sick_leave_end", "diagnosis_code",
  "invoice_item", "invoice_total", "benefit_requested",
];
export const DATE_KINDS = ["injury_date", "exam_date", "admission_date", "discharge_date", "sick_leave_start", "sick_leave_end"];
export const MONEY_KINDS = ["invoice_item", "invoice_total"];
export const BENEFITS = ["hospital", "sick_leave", "treatment_abroad", "other"];

// Sample policy terms (fictional). In production they come from the policy administration system.
export const TERMS = {
  hospitalRate: 600,          // CZK per day in hospital
  sickRate: 400,              // CZK per day of sick leave
  sickFromDay: 15,            // sick leave is paid from this day on
  covered: ["hospital", "sick_leave"],
};

export const LABELS = {
  injury_date: "Date of injury", exam_date: "Examined on", admission_date: "Admitted to hospital",
  discharge_date: "Discharged", sick_leave_start: "Sick leave from", sick_leave_end: "Sick leave until",
  diagnosis_code: "Diagnosis (ICD-10)", invoice_item: "Invoice item", invoice_total: "Invoice total",
  benefit_requested: "Benefit requested",
};
export const BENEFIT_LABELS = { hospital: "Hospital stay", sick_leave: "Sick leave", treatment_abroad: "Medical treatment abroad", other: "Other benefit" };

// ---------- text helpers ----------
const WS = /[\s   ]+/g;
export function norm(s) {
  return String(s == null ? "" : s).normalize("NFC")
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]/g, "-").replace(WS, " ").trim();
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Finds a quote in the original text, tolerant only of whitespace, quote-mark and dash differences.
// Returns [start, end] in the original text or null. This is how a model's citation is verified.
export function findQuote(text, quote) {
  const q = norm(quote);
  if (q.length < 2) return null;
  const src = String(text).normalize("NFC");
  const parts = q.split(" ").map(function (w) {
    return escRe(w).replace(/'/g, "['‘’‚‛]").replace(/"/g, '["“”„‟«»]').replace(/-/g, "[-‐-―−]");
  });
  const re = new RegExp(parts.join("[\\s\\u00a0\\u2007\\u202f]+"), "u");
  const m = re.exec(src);
  return m ? [m.index, m.index + m[0].length] : null;
}

// For a model's own transcription of a scan, punctuation and layout are the model's guess
// (a table cell becomes "Label: value" or "Label | value"). So for transcribed documents only,
// a quote may also match ignoring everything except letters and digits. Letters and digits must still match in order.
export function findQuoteLoose(text, quote) {
  const src = String(text).normalize("NFC"), keep = /[\p{L}\p{N}]/u;
  let canon = "";
  const map = [];
  for (let i = 0; i < src.length; i++) if (keep.test(src[i])) { canon += src[i].toLowerCase(); map.push(i); }
  const q = [...String(quote || "").normalize("NFC")].filter((c) => keep.test(c)).join("").toLowerCase();
  if (q.length < 4) return null;
  const at = canon.indexOf(q);
  return at < 0 ? null : [map[at], map[at + q.length - 1] + 1];
}

export function isIsoDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1990 && y <= 2100;
}
export const ICD10 = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?$/;

// ---------- validation of the model's output ----------
// raw = the tool input the model returned: { facts:[...], instructions_found:[...], translations:[...] }
// docs = [{ id, title, text }]
export function validateExtraction(docs, raw) {
  const byId = {};
  docs.forEach(function (d) { byId[d.id] = d; });
  const facts = [], rejected = [], seen = {};
  const list = raw && Array.isArray(raw.facts) ? raw.facts : [];
  list.forEach(function (f, i) {
    const why = [];
    const doc = byId[f && f.doc_id];
    const kind = f && f.kind;
    let value = f && f.value != null ? String(f.value).trim() : "";
    if (!doc) why.push("unknown document");
    if (KINDS.indexOf(kind) < 0) why.push("unknown field type");
    if (DATE_KINDS.indexOf(kind) >= 0 && !isIsoDate(value)) why.push("date is not a valid YYYY-MM-DD");
    if (kind === "diagnosis_code") { value = value.toUpperCase().replace(/\s/g, ""); if (!ICD10.test(value)) why.push("not an ICD-10 code"); }
    if (MONEY_KINDS.indexOf(kind) >= 0) {
      const n = Number(value.replace(/[\s ,]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 1e8 || Math.round(n) !== n) why.push("amount is not a whole number");
      else value = String(n);
    }
    if (kind === "benefit_requested" && BENEFITS.indexOf(value) < 0) why.push("unknown benefit");
    let span = doc ? findQuote(doc.text, f.quote) : null, loose = false;
    if (doc && !span && doc.transcribed) { span = findQuoteLoose(doc.text, f.quote); loose = !!span; }
    if (doc && !span) why.push("quote not found in the document");
    let conf = Number(f && f.confidence);
    if (!Number.isFinite(conf)) conf = 0.5;
    conf = Math.max(0, Math.min(1, conf));
    if (why.length) { rejected.push({ index: i, fact: f, reasons: why }); return; }
    const key = [f.doc_id, kind, value, span[0]].join("|");
    if (seen[key]) return;
    seen[key] = true;
    const out = { id: "f" + (facts.length + 1), doc_id: f.doc_id, kind: kind, value: value, quote: doc.text.slice(span[0], span[1]), span: span, confidence: conf };
    if (f.currency) out.currency = String(f.currency).toUpperCase().slice(0, 3);
    if (f.note) out.note = String(f.note).slice(0, 300);
    if (loose) out.match = "ignoring punctuation";
    facts.push(out);
  });
  return { facts: facts, rejected: rejected };
}

// ---------- prompt-injection screening (code, in addition to the model's own report) ----------
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)/i,
  /\b(system|admin|developer)\s+(note|prompt|message|instruction)/i,
  /\b(ai|llm|gpt|model|assistant|chatbot|automated?\s+(system|review|processing))\b[^.\n]{0,60}\b(approve|pay|accept|ignore|override|mark)/i,
  /approve[^.\n]{0,60}without[^.\n]{0,30}(manual\s+)?(review|check)/i,
  /ignorujte|ignoruj\s+(předchozí|všechny)|pokyny\s+pro\s+(ai|um[eě]lou|automat)/i,
  /automatick[éeéý]\w*\s+zpracov[áa]n[íi][^.\n]{0,80}(schv[áa]l|vyplat|uhra)/i,
  /(schv[áa]l|vyplat|uhra)\w*[^.\n]{0,60}bez\s+(kontrol|ov[ěe][řr]|p[řr]ezkum)/i,
  /(ігноруй|игнорируй|не\s+перевіряй|не\s+проверяй|без\s+перевірки|без\s+проверки)/i,
  /<\/?\s*(system|instructions?|prompt)\s*>/i,
];
export function screenInjections(docs, modelFound) {
  const hits = [];
  docs.forEach(function (d) {
    const lines = String(d.text || "").split(/\n/);
    let pos = 0;
    lines.forEach(function (line) {
      if (INJECTION_PATTERNS.some(function (re) { return re.test(line); }) && line.trim()) {
        hits.push({ doc_id: d.id, quote: line.trim(), span: [pos + line.indexOf(line.trim()), pos + line.indexOf(line.trim()) + line.trim().length], source: "rule" });
      }
      pos += line.length + 1;
    });
  });
  (Array.isArray(modelFound) ? modelFound : []).forEach(function (m) {
    const d = docs.find(function (x) { return x.id === m.doc_id; });
    const span = d && d.text ? findQuote(d.text, m.quote) : null;
    if (!span) return; // the model must quote it too
    const same = hits.find(function (h) { return h.doc_id === m.doc_id && h.span[0] <= span[1] && span[0] <= h.span[1]; });
    if (same) { same.source = "rule+model"; if (m.why) same.why = String(m.why).slice(0, 200); }
    else hits.push({ doc_id: m.doc_id, quote: d.text.slice(span[0], span[1]), span: span, source: "model", why: m.why ? String(m.why).slice(0, 200) : "" });
  });
  return hits;
}

// ---------- policy rules ----------
function t(iso) { const p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
export function daysBetween(a, b) { return Math.round((t(b) - t(a)) / 86400000); }
export function fmtDate(iso) { const p = iso.split("-"); return (+p[2]) + ". " + (+p[1]) + ". " + p[0]; }
export function fmtCzk(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " CZK"; }
export function fmtMoney(n, cur) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + (cur || ""); }
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

// claim = { coverFrom: "YYYY-MM-DD" }  (from the policy system, never from documents)
export function analyzeClaim(claim, facts, injections, terms) {
  terms = terms || TERMS;
  const by = function (k) { return facts.filter(function (f) { return f.kind === k; }); };
  const checks = [], lines = [];
  const inj = by("injury_date"), dates = uniq(inj.map(function (f) { return f.value; })).sort();
  if (!dates.length) {
    checks.push({ key: "dates", s: "warn", t: "Date of injury found", p: "No document states when the injury happened.", ev: [] });
  } else {
    const ok = dates.length === 1;
    checks.push({ key: "dates", s: ok ? "ok" : "crit", t: "Injury date matches across documents",
      p: ok ? "All documents give " + fmtDate(dates[0]) + "." : inj.map(function (f) { return f.doc_id + ": " + fmtDate(f.value); }).join(" · ") + ".", ev: inj.map(function (f) { return f.id; }) });
  }
  let coverOk = true;
  if (dates.length && claim && claim.coverFrom) {
    coverOk = t(dates[0]) >= t(claim.coverFrom);
    checks.push({ key: "cover", s: coverOk ? "ok" : "crit", t: "Injury happened while the policy was in force",
      p: "Cover from " + fmtDate(claim.coverFrom) + ". " + (coverOk ? "Earliest reported injury date " + fmtDate(dates[0]) + "." : "One document puts the injury on " + fmtDate(dates[0]) + ", before cover started."),
      ev: inj.map(function (f) { return f.id; }) });
  }
  const dx = by("diagnosis_code"), codes = uniq(dx.map(function (f) { return f.value; }));
  const dxOk = codes.length <= 1;
  if (dx.length) checks.push({ key: "dx", s: dxOk ? "ok" : "crit", t: "Diagnosis matches across documents",
    p: dxOk ? "ICD-10 " + codes[0] + " in " + dx.length + (dx.length === 1 ? " document." : " documents.") : "Different codes: " + codes.join(", ") + ". The sick leave may be for a different condition.",
    ev: dx.map(function (f) { return f.id; }) });
  const ss = by("sick_leave_start")[0], se = by("sick_leave_end")[0];
  if (ss && dates.length) {
    const latest = dates[dates.length - 1], sOk = t(ss.value) >= t(latest);
    checks.push({ key: "sickstart", s: sOk ? "ok" : "warn", t: "Sick leave starts on or after the injury",
      p: sOk ? "Sick leave from " + fmtDate(ss.value) + "." : "Sick leave started on " + fmtDate(ss.value) + ", before the injury date " + fmtDate(latest) + ".",
      ev: [ss.id].concat(inj.map(function (f) { return f.id; })) });
  }
  const req = by("benefit_requested"), reqKinds = uniq(req.map(function (f) { return f.value; }));
  const unc = reqKinds.filter(function (k) { return terms.covered.indexOf(k) < 0; });
  if (req.length) checks.push({ key: "covered", s: unc.length ? "warn" : "ok", t: "Requested benefits are covered by the rider",
    p: unc.length ? unc.map(function (k) { return BENEFIT_LABELS[k]; }).join(", ") + ": not covered by this rider." : reqKinds.map(function (k) { return BENEFIT_LABELS[k]; }).join(", ") + ": covered.",
    ev: req.map(function (f) { return f.id; }) });
  const items = by("invoice_item"), totals = by("invoice_total");
  let sumOk = true;
  totals.forEach(function (tot) {
    const its = items.filter(function (f) { return f.doc_id === tot.doc_id; });
    if (!its.length) return;
    const sum = its.reduce(function (a, f) { return a + Number(f.value); }, 0);
    const ok = sum === Number(tot.value);
    if (!ok) sumOk = false;
    checks.push({ key: "sum", s: ok ? "ok" : "crit", t: "Invoice items add up to the total",
      p: ok ? "Items " + fmtMoney(sum, tot.currency) + " = total." : "Items add up to " + fmtMoney(sum, tot.currency) + ", the invoice says " + fmtMoney(Number(tot.value), tot.currency) + ".",
      ev: its.map(function (f) { return f.id; }).concat([tot.id]) });
  });
  const injs = injections || [];
  checks.push({ key: "inject", s: injs.length ? "crit" : "ok", t: "No instructions hidden in documents",
    p: injs.length ? injs.length + (injs.length === 1 ? " passage tries" : " passages try") + " to instruct the system. Ignored and reported." : "No document tries to give instructions to the system.", ev: [] });

  const hold = (dates.length > 1) || !coverOk || !dxOk;
  let total = 0;
  const adm = by("admission_date")[0], dis = by("discharge_date")[0];
  if (reqKinds.indexOf("hospital") >= 0) {
    if (adm && dis && t(dis.value) >= t(adm.value)) {
      const hd = daysBetween(adm.value, dis.value), ha = hd * terms.hospitalRate; total += ha;
      lines.push({ t: "Hospital stay", s: hd + " days × " + fmtCzk(terms.hospitalRate) + " (" + fmtDate(adm.value) + " – " + fmtDate(dis.value) + ")", a: ha });
    } else lines.push({ t: "Hospital stay", s: "Requested, but no admission and discharge dates in the documents", a: 0, none: true });
  }
  if (reqKinds.indexOf("sick_leave") >= 0) {
    if (ss && se && t(se.value) >= t(ss.value)) {
      const sd = daysBetween(ss.value, se.value) + 1, paid = Math.max(0, sd - (terms.sickFromDay - 1)), sa = paid * terms.sickRate; total += sa;
      lines.push({ t: "Sick leave", s: sd + " days in total, paid from day " + terms.sickFromDay + ": " + paid + " days × " + fmtCzk(terms.sickRate), a: sa });
    } else lines.push({ t: "Sick leave", s: "Requested, but the sick-leave dates are missing", a: 0, none: true });
  }
  unc.forEach(function (k) { lines.push({ t: BENEFIT_LABELS[k], s: "Not covered by this rider", a: 0, none: true }); });

  const integrity = !sumOk || injs.length > 0;
  let rec;
  if (hold) rec = { act: "info", s: "warn", h: "Hold payment and ask for information",
    p: dates.length > 1 || !coverOk
      ? "The documents disagree on when the injury happened, or a date falls before the cover started. Ask the client and the treating doctor to confirm before paying. Do not reject automatically: a wrong date on a claim form is a common honest mistake."
      : "The diagnosis on the sick-leave record differs from the injury diagnosis. Ask the treating doctor whether the sick leave is due to this injury." };
  else if (integrity) rec = { act: "escalate", s: "crit", h: total > 0 ? "Pay the covered benefit, escalate the documents" : "Escalate to the fraud team",
    p: (total > 0 ? "The injury and the covered benefits check out. " : "") + (!sumOk ? "An invoice does not add up. " : "") + (injs.length ? "A document contains text addressed to the AI or the reviewer. " : "") + "Send the documents to the fraud team before anything beyond the covered benefit is paid." };
  else if (!dates.length || lines.some(function (l) { return l.none && l.t !== BENEFIT_LABELS.treatment_abroad && l.t !== BENEFIT_LABELS.other; })) rec = { act: "info", s: "warn", h: "Ask for the missing documents",
    p: "Some requested benefits cannot be calculated from the documents provided." };
  else rec = { act: "approve", s: "ok", h: "Ready to approve", p: "All documents agree, the injury happened while the policy was in force and the payout follows from the policy terms." + (unc.length ? " Benefits outside this rider are declined." : "") };
  return { checks: checks, lines: lines, total: hold ? 0 : total, proposed: total, hold: hold, rec: rec };
}
