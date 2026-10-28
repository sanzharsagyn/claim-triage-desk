// Browser test against the local dev server (node tests/dev-server.mjs must be running).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }
const U = process.env.URL || "http://localhost:8790";
const b = await chromium.launch();
let ok = 0, bad = 0; const t = (n, c, x) => { c ? ok++ : bad++; console.log((c ? "OK  " : "FAIL") + " " + n + (!c && x !== undefined ? " -> " + JSON.stringify(x) : "")); };
const errs = [];
async function page(opts) {
  const p = await b.newPage(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return p;
}
const nbsp = (s) => s.replace(/ /g, " ");
const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// ---- claims desk ----
let p = await page();
await p.goto(U + "/claims/");
await p.waitForSelector("#rec h3", { timeout: 10000 });
t("live badge on", (await p.getAttribute("#live", "class")).includes("on"));
t("claim 1 approve 12 400", nbsp(await p.textContent("#rec")).includes("12 400 CZK") && (await p.textContent("#rec")).includes("Ready to approve"));
t("reference 10 of 10", (await p.textContent("#ref")).includes("10 of 10 found"));
t("run meta shows tokens and cost", /tokens · \$0\.\d{4}/.test(await p.textContent("#runmeta")), await p.textContent("#runmeta"));
t("10 facts in table", (await p.$$("#fields tbody tr")).length === 10);
t("quotes highlighted in document", (await p.$$("#sheet mark.f")).length >= 3);
await p.click('#fields tbody tr:nth-child(4)');
t("click fact -> its document and highlight", !!(await p.$("#sheet mark.f.hl")));
// claim 2
await p.click('.qcard[data-claim="CL-2026-01187"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && document.querySelector("#rec h3").textContent.includes("Hold"));
t("claim 2 on hold", nbsp(await p.textContent("#rec")).includes("on hold"));
t("claim 2 bad marks", (await p.$$("#sheet mark.f.bad")).length >= 1);
// claim 3
await p.click('.qcard[data-claim="CL-2026-02310"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && /escalate/i.test(document.querySelector("#rec h3").textContent));
t("claim 3 escalate, sick leave 2 000", nbsp(await p.textContent("#rec")).includes("2 000 CZK"));
await p.click('.tab[data-doc="inv"]');
t("hidden text marked", !!(await p.$("#sheet .hid")) && (await p.textContent("#sheet")).includes("Hidden white-on-white"));
t("injection listed", (await p.textContent("#rejected")).includes("not followed"));
t("translation toggle offered", !!(await p.$("#tr")));
await p.click("#tr");
t("translation shown", (await p.textContent("#sheet")).includes("English translation returned by the model"));
// model switch
await p.click('#modelSeg button[data-model="sonnet"]');
await p.waitForFunction(() => /Sonnet/.test(document.getElementById("runmeta").textContent));
t("sonnet run meta", (await p.textContent("#runmeta")).includes("Claude Sonnet 5.5"));
// scanned claim
await p.click('#modelSeg button[data-model="haiku"]');
await p.click('.qcard[data-claim="CL-2026-02755"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && /approve/i.test(document.querySelector("#rec h3").textContent));
t("scan claim approve 12 800", nbsp(await p.textContent("#rec")).includes("12 800 CZK"));
t("pipeline counts 2 scans", (await p.textContent("#pipe")).includes("2 scans"));
await p.click('.tab[data-doc="disch"]');
t("scan tab tagged", (await p.textContent('.tab[data-doc="disch"]')).includes("SCAN"));
t("transcription shown with highlights", (await p.textContent("#sheet")).includes("Text the model read from the image") && (await p.$$("#sheet mark.f")).length >= 3);
t("thumbnail of the scan", !!(await p.$("#thumb img")));
await p.click("#scanToggle");
await p.waitForFunction(() => { const i = document.querySelector("#sheet img.scanimg"); return i && i.complete && i.naturalWidth > 1000; });
t("scan image shown", true);
await p.click("#scanToggle");
await p.click('#fields tbody tr:nth-child(9)');
t("fact on a scan -> transcription highlight", !!(await p.$("#sheet mark.f.hl")));
// more claims
await p.click("#moreWrap summary");
t("more claims count", (await p.textContent("#moreSum")).startsWith("7 more"));
await p.click('.qcard[data-claim="CL-2026-02391"]');
await p.waitForFunction(() => document.querySelector("#rec h3") && /Hold/.test(document.querySelector("#rec h3").textContent));
t("claim 8 dx mismatch -> info", (await p.textContent("#checks")).includes("Different codes"));
// decision + override
await p.click('[data-act="approve"]');
t("override logged", (await p.textContent("#audit")).includes("override logged"));
// own document
await p.click('[data-ex="inject"]');
await p.click("#ownRun");
await p.waitForFunction(() => document.getElementById("ownMsg").textContent.startsWith("Done"), null, { timeout: 10000 });
t("own claim card", (await p.textContent("#queue")).includes("Your documents"));
t("own injection flagged", (await p.textContent("#rejected")).includes("not followed"));
t("own recommendation escalate", /Escalate/.test(await p.textContent("#rec")));
// own upload: a photo
await p.click('[data-rm="0"]').catch(() => {});
await p.setInputFiles('input[data-file="0"]', new URL("../public/claims/scans/CL-2026-02755-sick-leave.jpg", import.meta.url).pathname);
await p.waitForSelector(".ownfile img");
t("upload preview after resizing", (await p.textContent(".ownfile")).includes("after resizing"));
await p.click("#ownRun");
await p.waitForFunction(() => document.getElementById("ownMsg").textContent.startsWith("Done"), null, { timeout: 10000 });
t("upload: scan tab and transcription", (await p.textContent("#tabs")).includes("SCAN") && (await p.textContent("#sheet")).includes("MOCK TRANSCRIPTION"));
const m = await p.evaluate(async () => (await (await fetch("/api/v1/metrics?days=1")).json()).days[0]);
t("metrics: runs, scans and the logged override", m.runs >= 5 && m.files >= 3 && m.overrides >= 1, m);
// evaluation
t("eval section visible", await p.isVisible("#evalSec"));
t("eval table has both models", (await p.textContent("#evalTable")).includes("Claude Sonnet 5.5"));
t("mock eval warning shown", (await p.textContent("#evalSec")).includes("local mock"));
t("no h-scroll desktop", await noH(p));
await p.close();
// phone + dark
p = await page({ viewport: { width: 375, height: 800 }, colorScheme: "dark", isMobile: true });
await p.goto(U + "/claims/");
await p.waitForSelector("#rec h3");
t("phone no h-scroll", await noH(p));
await p.screenshot({ path: process.env.SHOTS + "/claims_phone_dark.png", fullPage: false });
await p.close();
// portfolio
p = await page();
await p.goto(U + "/");
await p.waitForFunction(() => !document.getElementById("featStats").hidden);
t("portfolio featured stats", nbsp(await p.textContent("#featStats")).includes("11 of 11"));
t("portfolio links API and monitoring", (await p.$$('a[href="/claims/api.html"]')).length >= 1 && (await p.$$('a[href="/claims/ops.html"]')).length >= 1);
t("portfolio links to /claims/", (await p.$$('a[href="/claims/"]')).length >= 2);
t("no claude.ai links", !(await p.content()).includes("claude.ai/artifact"));
t("calculator works", nbsp(await p.textContent("#oNeed")).includes("33 670"));
t("portfolio no h-scroll", await noH(p));
await p.screenshot({ path: process.env.SHOTS + "/portfolio_desk.png", fullPage: false });
const pp = await page({ viewport: { width: 375, height: 800 }, isMobile: true });
await pp.goto(U + "/");
t("portfolio phone no h-scroll", await noH(pp));
t("no page errors", errs.length === 0, errs);
// API docs and monitoring pages
p = await page();
await p.goto(U + "/claims/api.html");
await p.click("#run");
await p.waitForFunction(() => /HTTP 200/.test(document.getElementById("runMsg").textContent));
t("API page: live request returns facts", (await p.textContent("#runMsg")).includes("10 facts"));
t("API page: curl uses this host", (await p.textContent("#curl1")).includes(U));
t("API page no h-scroll", await noH(p));
await p.goto(U + "/claims/ops.html");
await p.waitForSelector("#tiles .tile .v");
t("ops: model runs tile", Number(await p.textContent("#tiles .tile .v")) >= 5);
t("ops: three charts with bars", (await p.$$("#charts .chart")).length === 3 && (await p.$$("#charts path.bar")).length >= 2);
t("ops: alerts rendered", (await p.$$("#alerts .alert")).length === 5);
await p.click('#period button[data-days="7"]');
await p.waitForFunction(() => document.getElementById("sub").textContent.includes("7 days"));
t("ops: period switch", true);
t("ops no h-scroll", await noH(p));
const po = await page({ viewport: { width: 375, height: 800 }, isMobile: true, colorScheme: "dark" });
await po.goto(U + "/claims/ops.html");
await po.waitForSelector("#tiles .tile");
t("ops phone no h-scroll", await noH(po));
console.log("PASS " + ok + " FAIL " + bad);
await b.close();
process.exit(bad ? 1 : 0);
